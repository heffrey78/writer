//! Dictation on Android (#86, D17): the page's Dictate, heard on the phone by Writer's speech crate
//! (packages/dictation) through its microphone (AAudio), with the commands and events the desktop
//! shell has (DEVELOPER.md, *Dictation*). The model is downloaded into the app's folder the first
//! time the writer wants it. The microphone is Android's to allow: until it is, `dictate_start`
//! fails with `permission`, and the page says why it's wanted before `dictation_allow_microphone`
//! shows Android's prompt. No audio is kept, and nothing heard leaves the phone.
//!
//! For the e2e, `WRITER_DICTATION_CLIP` in env.json names a WAV in the app's folder to hear in place
//! of the microphone (mic::Dictation::play).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use dictation::mic::{self, Dictation, Failure, Update};
use dictation::{download, model, Event, Listener, Options};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime};

#[derive(Default)]
pub struct Dictating {
    /// The model, opened once and kept between dictations: opening it takes seconds.
    listener: Mutex<Option<Listener>>,
    running: Mutex<Option<Running>>,
    /// Set to stop the download under way.
    cancel: Mutex<Option<Arc<AtomicBool>>>,
}

struct Running {
    dictation: Dictation,
    events: Channel<Value>,
}

fn root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn models<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    root(app).map(|dir| dir.join("models"))
}

/// Whether the microphone may be used, or (`ask`) Android's prompt for it first.
/// The screen kept on while listening (#97): set down, the phone would time out and stop it.
fn keep_screen_on<R: Runtime>(app: &AppHandle<R>, on: bool) {
    if let Some(android) = app.try_state::<writer_android::Android<R>>() {
        let _ = android.keep_screen_on(on);
    }
}

fn microphone<R: Runtime>(app: &AppHandle<R>, ask: bool) -> Result<String, String> {
    app.try_state::<writer_android::Android<R>>().ok_or("No microphone to ask for here: it's Android's.")?.microphone(ask)
}

#[tauri::command]
pub fn dictation_available() -> bool {
    true
}

/// Start hearing. Every outcome comes as events on `events`, a failure too.
#[tauri::command]
pub async fn dictate_start<R: Runtime>(app: AppHandle<R>, language: String, hints: Vec<String>, events: Channel<Value>) {
    // The book's names are put right in the page, after a phrase is settled (#81).
    let _ = hints;
    let _ = tauri::async_runtime::spawn_blocking(move || start(&app, language, events)).await;
}

fn start<R: Runtime>(app: &AppHandle<R>, language: String, events: Channel<Value>) {
    let failed = |reason: &str, message: Option<String>| drop(events.send(json!({ "kind": "failed", "reason": reason, "message": message })));
    stop_running(app);
    match microphone(app, false) {
        Ok(state) if state == "granted" => {}
        Ok(state) => return failed("permission", Some(state)),
        Err(e) => return failed("microphone", Some(e)),
    }
    let state = app.state::<Dictating>();
    let kept = state.listener.lock().unwrap().take();
    let listener = match kept {
        Some(listener) => listener,
        None => match models(app).and_then(|dir| Listener::open(&dir, &Options { language, threads: 1 }).map_err(|e| e.to_string())) {
            Ok(listener) => listener,
            Err(message) => {
                let model = models(app).map(|dir| download::State::of(&dir) != download::State::Ready).unwrap_or(false);
                return failed(if model { "model" } else { "other" }, Some(message));
            }
        },
    };
    let sender = events.clone();
    let on = move |update: Update| {
        let _ = sender.send(match update {
            Update::Event(Event::Heard(text)) => json!({ "kind": "heard", "text": text }),
            Update::Event(Event::Settled(text)) => json!({ "kind": "settled", "text": text }),
            Update::Failed(failure) => failure_event(&failure),
        });
    };
    let started = match test_clip(app) {
        Some(Ok(samples)) => Dictation::play(listener, samples, on),
        Some(Err(e)) => Err((Failure::Other(e), listener)),
        None => Dictation::start(listener, None, on),
    };
    match started {
        Ok(dictation) => {
            *state.running.lock().unwrap() = Some(Running { dictation, events });
            keep_screen_on(app, true);
        }
        Err((failure, listener)) => {
            *state.listener.lock().unwrap() = Some(listener);
            let _ = events.send(failure_event(&failure));
        }
    }
}

/// The e2e's recording, if env.json names one, to hear in place of the microphone.
fn test_clip<R: Runtime>(app: &AppHandle<R>) -> Option<Result<Vec<f32>, String>> {
    let root = root(app).ok()?;
    let env: Value = serde_json::from_str(&fs::read_to_string(root.join("env.json")).ok()?).ok()?;
    let clip = env.get("WRITER_DICTATION_CLIP")?.as_str()?;
    Some(mic::clip(&root.join(clip)))
}

fn failure_event(failure: &Failure) -> Value {
    match failure {
        Failure::NoMicrophone | Failure::NotConnected(_) => json!({ "kind": "failed", "reason": "no-microphone" }),
        Failure::Microphone(e) => json!({ "kind": "failed", "reason": "microphone", "message": format!("Writer couldn't use the microphone ({e}). Check that no other app is using it, then dictate again.") }),
        Failure::Other(e) => json!({ "kind": "failed", "reason": "other", "message": e }),
    }
}

/// Stop hearing: the phrase being heard is settled and sent, then `stopped`.
#[tauri::command]
pub async fn dictate_stop<R: Runtime>(app: AppHandle<R>) {
    let _ = tauri::async_runtime::spawn_blocking(move || stop_running(&app)).await;
}

fn stop_running<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<Dictating>();
    let running = state.running.lock().unwrap().take();
    if let Some(running) = running {
        keep_screen_on(app, false);
        *state.listener.lock().unwrap() = Some(running.dictation.stop());
        let _ = running.events.send(json!({ "kind": "stopped" }));
    }
}

/// Android's prompt for the microphone, after the page has said why it's wanted: "granted",
/// "prompt" (not allowed, and Android would ask again) or "denied" (only its settings can allow it).
#[tauri::command]
pub async fn dictation_allow_microphone<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || microphone(&app, true)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn dictation_model<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    let dir = models(&app)?;
    Ok(json!({ "state": download::State::of(&dir).as_str(), "installedBytes": model::installed_bytes(), "downloadBytes": download::left(&dir) }))
}

#[tauri::command]
pub async fn dictation_download<R: Runtime>(app: AppHandle<R>, progress: Channel<Value>) -> Result<(), String> {
    let cancel = Arc::new(AtomicBool::new(false));
    *app.state::<Dictating>().cancel.lock().unwrap() = Some(cancel.clone());
    tauri::async_runtime::spawn_blocking(move || {
        let dir = models(&app)?;
        download::download(&dir, concat!("Writer/", env!("CARGO_PKG_VERSION")), &cancel, |done, total| {
            let _ = progress.send(json!({ "done": done, "total": total }));
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn dictation_cancel_download<R: Runtime>(app: AppHandle<R>) {
    if let Some(cancel) = app.state::<Dictating>().cancel.lock().unwrap().as_ref() {
        cancel.store(true, Ordering::SeqCst);
    }
}

#[tauri::command]
pub fn dictation_remove_model<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    stop_running(&app);
    app.state::<Dictating>().listener.lock().unwrap().take();
    match fs::remove_dir_all(models(&app)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

fn settings_file(root: &Path) -> PathBuf {
    root.join("dictation.json")
}

/// The settings kept (#80), the one recognizer, and no microphones to choose from: a phone hears
/// with the one Android gives it.
#[tauri::command]
pub fn dictation_settings<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    let kept = fs::read_to_string(settings_file(&root(&app)?)).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok());
    let mut settings = json!({ "recognizer": null, "microphone": null, "silenceSeconds": 60, "announce": false });
    if let (Some(Value::Object(kept)), Value::Object(settings)) = (kept, &mut settings) {
        for (k, v) in kept {
            if settings.contains_key(&k) {
                settings.insert(k, v);
            }
        }
    }
    Ok(json!({ "settings": settings, "recognizers": [{ "id": "writer", "words": "On this phone, with Writer's speech model" }], "microphones": [] }))
}

#[tauri::command]
pub fn dictation_save_settings<R: Runtime>(app: AppHandle<R>, settings: Value) -> Result<(), String> {
    let file = settings_file(&root(&app)?);
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    // Written whole, then put in place.
    let partial = file.with_extension("json.partial");
    fs::write(&partial, text).and_then(|_| fs::rename(&partial, &file)).map_err(|e| format!("Couldn't keep dictation's settings: {e}"))
}
