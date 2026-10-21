//! D16 spike (#46): an Android app whose webview calls Writer's git port (spike/d16/git2-port) in
//! process, as an engine running in the webview would. Its page (page/) runs a sync round trip, against
//! the PC's fake GitHub when adb reverse makes it reachable, else against a remote on the device, shows
//! the result and writes it to report.json in the app's data folder.

use serde_json::{Value, json};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::Manager;

/// The app's own folder: every path the page names is inside it.
fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// One git port operation on a repository in the app's folder: `{ ok }` or `{ err: { code, message } }`.
#[tauri::command]
async fn git(app: tauri::AppHandle, op: String, dir: String, args: Value) -> Result<Value, String> {
    let dir = root(&app)?.join(dir);
    Ok(git2_port::call(&op, &dir.to_string_lossy(), &args))
}

#[tauri::command]
async fn write_file(app: tauri::AppHandle, path: String, text: String) -> Result<(), String> {
    let full = root(&app)?.join(path);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(full, text).map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    std::fs::read_to_string(root(&app)?.join(path)).map_err(|e| e.to_string())
}

/// Everything from an earlier run gone.
#[tauri::command]
async fn reset(app: tauri::AppHandle) -> Result<String, String> {
    let root = root(&app)?;
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
async fn report(app: tauri::AppHandle, json: String) -> Result<String, String> {
    let path = root(&app)?.join("report.json");
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// The certificates libgit2 trusts for https, as set up when the app started.
static TRUST: std::sync::OnceLock<Value> = std::sync::OnceLock::new();

#[tauri::command]
async fn trust() -> Value {
    TRUST.get().cloned().unwrap_or(Value::Null)
}

/// Whether something answers on this device's 127.0.0.1:`port`: the PC's fake GitHub, through adb reverse.
#[tauri::command]
async fn reachable(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(500)).is_ok()
}

/// Whether libgit2 can reach an https remote from here: the refs it lists, and how long it took.
#[tauri::command]
async fn https_probe(url: String) -> Result<Value, String> {
    let start = Instant::now();
    let mut remote = git2::Remote::create_detached(url.as_str()).map_err(|e| e.message().to_string())?;
    remote.connect(git2::Direction::Fetch).map_err(|e| e.message().to_string())?;
    let refs = remote.list().map_err(|e| e.message().to_string())?.len();
    Ok(json!({ "refs": refs, "ms": start.elapsed().as_millis() as u64 }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // The device's own trusted certificates, for libgit2's OpenSSL: Conscrypt's, which Android
            // keeps up to date, then the system's (git2_port::trust_certificates_in says why a file).
            #[cfg(target_os = "android")]
            {
                let out = app.path().app_cache_dir()?.join("cacerts.pem");
                let _ = TRUST.set(git2_port::trust_certificates_in(&["/apex/com.android.conscrypt/cacerts", "/system/etc/security/cacerts"], &out).unwrap_or_else(|e| json!({ "error": e })));
            }
            #[cfg(not(target_os = "android"))]
            let _ = (app, TRUST.set(json!({ "certificates": "the system's" })));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![git, write_file, read_file, reset, report, reachable, trust, https_probe])
        .run(tauri::generate_context!())
        .expect("the spike app couldn't start");
}
