//! Writer on Android (D16, #52): the web app, and the engine that serves it, run in the webview
//! (packages/web/src/engine). This Rust is the engine's host: it gives it git (packages/git2-port, in
//! process), the app's storage, GitHub's HTTP and the token, through three commands: `git`, `port` for
//! the rest, and `listen` for the watches' events. It also hears the writer, for the page's Dictate
//! (dictation.rs, #86), on Android only.


use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State};
use writer_mobile_ports::{files, host, secrets};

#[cfg(target_os = "android")]
mod dictation;

struct App {
    root: PathBuf,
    watches: files::Watches,
    /// Where the watches' events go: the page's channel, from `listen`.
    events: Arc<Mutex<Option<Channel<Value>>>>,
    http: reqwest::Client,
}

/// One git port operation (git2-port's `call`): its answer, or `{ code, message }`. A clone's or a
/// fetch's progress goes to `progress` as it comes.
#[tauri::command]
async fn git(op: String, dir: String, args: Value, progress: Channel<Value>) -> Result<Value, Value> {
    let answer = tauri::async_runtime::spawn_blocking(move || git2_port::call_with(&op, &dir, &args, &mut |p| drop(progress.send(p)))).await.map_err(|e| json!({ "code": "GIT", "message": e.to_string() }))?;
    match answer.get("err") {
        Some(err) => Err(err.clone()),
        None => Ok(answer.get("ok").cloned().unwrap_or(Value::Null)),
    }
}

/// The page's channel for watch events; a page that starts afresh stops the watches its last one left.
#[tauri::command]
fn listen(state: State<'_, App>, events: Channel<Value>) {
    state.watches.stop_all();
    *state.events.lock().unwrap() = Some(events);
}

/// An operation of the files, host, http or secrets port, as remote-ports.ts calls it: its answer,
/// with bytes as `{ "$bytes": base64 }`, or `{ code?, message }`.
#[tauri::command]
async fn port(app: AppHandle, state: State<'_, App>, port: String, op: String, args: Vec<Value>) -> Result<Value, Value> {
    let failed = |message: String| json!({ "message": message });
    match (port.as_str(), op.as_str()) {
        ("files", "watch") => {
            let events = Arc::clone(&state.events);
            let root = args.first().and_then(Value::as_str).unwrap_or("").to_string();
            let send = Arc::new(move |e: Value| {
                if let Some(channel) = events.lock().unwrap().as_ref() {
                    let _ = channel.send(e);
                }
            });
            state.watches.start(&root, send).map(Value::String).map_err(|e| e.to_json())
        }
        ("files", "unwatch") => {
            state.watches.stop(args.first().and_then(Value::as_str).unwrap_or(""));
            Ok(Value::Null)
        }
        ("files", _) => tauri::async_runtime::spawn_blocking(move || files::call(&op, &args).map_err(|e| e.to_json())).await.map_err(|e| failed(e.to_string()))?,
        ("host", "facts") => Ok(host::facts(&state.root)),
        ("http", "fetch") => fetch(&state.http, args.into_iter().next().unwrap_or(Value::Null)).await.map_err(failed),
        ("secrets", _) => {
            let secrets = secrets::Secrets::new(state.root.join("secrets/github"), Keystore(app.clone()));
            let token = args.first().and_then(Value::as_str).map(str::to_string);
            tauri::async_runtime::spawn_blocking(move || match op.as_str() {
                "get" => secrets.get().map(|t| t.map_or(Value::Null, Value::String)),
                "set" => secrets.set(token.as_deref().unwrap_or("")).map(|_| Value::Null),
                "delete" => secrets.delete().map(|_| Value::Null),
                _ => Err(format!("No secrets operation {op}.")),
            })
            .await
            .map_err(|e| failed(e.to_string()))?
            .map_err(failed)
        }
        _ => Err(failed(format!("No {port} operation {op}."))),
    }
}

/// A request made here, for the page (no CORS: github.com's device flow answers no browser):
/// `{ url, method, headers, body? }` to `{ status, headers, body }`.
async fn fetch(client: &reqwest::Client, r: Value) -> Result<Value, String> {
    let method = reqwest::Method::from_bytes(r["method"].as_str().unwrap_or("GET").as_bytes()).map_err(|e| e.to_string())?;
    let mut request = client.request(method, r["url"].as_str().unwrap_or(""));
    for h in r["headers"].as_array().into_iter().flatten() {
        if let (Some(k), Some(v)) = (h[0].as_str(), h[1].as_str()) {
            request = request.header(k, v);
        }
    }
    if let Some(b64) = r["body"]["$bytes"].as_str() {
        request = request.body(BASE64.decode(b64).map_err(|e| e.to_string())?);
    }
    let res = request.send().await.map_err(|e| format!("fetch failed: {e}"))?;
    let status = res.status().as_u16();
    let headers: Vec<[String; 2]> = res.headers().iter().map(|(k, v)| [k.to_string(), String::from_utf8_lossy(v.as_bytes()).to_string()]).collect();
    let body = res.bytes().await.map_err(|e| e.to_string())?;
    Ok(json!({ "status": status, "headers": headers, "body": { "$bytes": BASE64.encode(body) } }))
}

/// Android's keystore, through the writer-android plugin, as the secrets store's cipher.
struct Keystore<R: Runtime>(AppHandle<R>);

impl<R: Runtime> secrets::Cipher for Keystore<R> {
    fn seal(&self, plain: String) -> Result<String, String> {
        self.0.try_state::<writer_android::Android<R>>().ok_or("No keystore here: it's Android's.")?.seal(plain)
    }
    fn open(&self, sealed: String) -> Result<String, String> {
        self.0.try_state::<writer_android::Android<R>>().ok_or("No keystore here: it's Android's.")?.open(sealed)
    }
}

/// Writer's actions on selected text in Android's selection toolbar (#95): the page's list, as it changes.
#[tauri::command]
fn selection_actions<R: Runtime>(app: AppHandle<R>, items: Vec<writer_android::SelectionAction>) -> Result<(), String> {
    app.try_state::<writer_android::Android<R>>().map_or(Ok(()), |android| android.selection_actions(items))
}

/// The page's commands: the engine's ports, and dictation's where the phone can hear.
fn handlers() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    #[cfg(target_os = "android")]
    return tauri::generate_handler![
        git,
        listen,
        port,
        selection_actions,
        dictation::dictation_available,
        dictation::dictate_start,
        dictation::dictate_stop,
        dictation::dictation_allow_microphone,
        dictation::dictation_model,
        dictation::dictation_download,
        dictation::dictation_cancel_download,
        dictation::dictation_remove_model,
        dictation::dictation_settings,
        dictation::dictation_save_settings
    ];
    #[cfg(not(target_os = "android"))]
    return tauri::generate_handler![git, listen, port, selection_actions];
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(writer_android::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            for dir in ["config", "books"] {
                std::fs::create_dir_all(root.join(dir))?;
            }
            host::put_templates(&root.join("templates"))?;
            // The writer's name and email, git's global configuration, kept in the app's folder: an
            // app has no home folder for libgit2 to find it in.
            // libgit2 only writes to a global file that's there.
            unsafe { git2::opts::set_search_path(git2::ConfigLevel::Global, &root)? };
            let config = root.join(".gitconfig");
            if !config.exists() {
                std::fs::write(config, "")?;
            }
            // The device's own trusted certificates, for libgit2's OpenSSL, added in memory
            // (git2_port::trust_certificates_in says why): Conscrypt's, which Android keeps up to date, then the system's.
            #[cfg(target_os = "android")]
            git2_port::trust_certificates_in(&["/apex/com.android.conscrypt/cacerts", "/system/etc/security/cacerts"])?;
            #[cfg(target_os = "android")]
            app.manage(dictation::Dictating::default());
            app.manage(App { root, watches: files::Watches::default(), events: Arc::default(), http: reqwest::Client::builder().user_agent("Writer").build()? });
            Ok(())
        })
        .invoke_handler(handlers())
        .run(tauri::generate_context!())
        .expect("Writer couldn't start");
}
