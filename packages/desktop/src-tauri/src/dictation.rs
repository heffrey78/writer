//! Dictation in the desktop app (#83, D17): the page's Dictate, heard on this computer by Writer's
//! speech crate (packages/dictation) through the default microphone, or the one chosen in its
//! settings (#80, kept in the app's settings.json). The page's side, and the
//! events between them, are in DEVELOPER.md (*Dictation*). The model is downloaded the first time
//! the writer wants it, into the app's data folder, from the pinned sources the crate lists, each
//! checked against its checksum. No audio is kept, and nothing heard leaves the computer.

use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use dictation::mic::{self, Chosen, Dictation, Failure, Update};
use dictation::{model, Error, Event, Listener, Options};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::menu::MenuItem;
use tauri::{AppHandle, Manager, WebviewWindow, Wry};

#[derive(Default)]
pub struct Dictating {
    /// The model, opened once and kept between dictations: opening it takes seconds.
    listener: Mutex<Option<Listener>>,
    running: Mutex<Option<Running>>,
    /// Set to stop the download under way.
    cancel: Mutex<Option<Arc<AtomicBool>>>,
    /// Windows whose page offers Dictate (it has an editor), by label: for the Edit menu.
    offered: Mutex<HashSet<String>>,
    pub menu: Mutex<Option<MenuItem<Wry>>>,
}

struct Running {
    window: String,
    dictation: Dictation,
    events: Channel<Value>,
}

fn models(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|dir| dir.join("models")).map_err(|e| e.to_string())
}

/// Whether this app can hear: yes, through its speech crate (the model may still be to download).
#[tauri::command]
pub fn dictation_available() -> bool {
    true
}

/// Start hearing for the window's page. Every outcome comes as events on `events`: a failure too
/// (a missing model, no microphone), as the page handles them there.
#[tauri::command]
pub async fn dictate_start(window: WebviewWindow, language: String, hints: Vec<String>, events: Channel<Value>) {
    // The book's names are put right in the page, after a phrase is settled (#81).
    let _ = hints;
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    let _ = tauri::async_runtime::spawn_blocking(move || start(&app, label, language, events)).await;
}

fn start(app: &AppHandle, window: String, language: String, events: Channel<Value>) {
    let state = app.state::<Dictating>();
    // One dictation at a time: another window's stops first.
    stop_running(app, |_| true);
    let kept = state.listener.lock().unwrap().take();
    let listener = match kept {
        Some(listener) => listener,
        None => match models(app).map_err(Opened::Other).and_then(|dir| Listener::open(&dir, &Options { language, threads: 1 }).map_err(Opened::from)) {
            Ok(listener) => listener,
            Err(Opened::Model(message)) => return void(events.send(json!({ "kind": "failed", "reason": "model", "message": message }))),
            Err(Opened::Other(message)) => return void(events.send(json!({ "kind": "failed", "reason": "other", "message": message }))),
        },
    };
    let sender = events.clone();
    let on = move |update: Update| {
        let _ = sender.send(match update {
            Update::Event(Event::Heard(text)) => json!({ "kind": "heard", "text": text }),
            Update::Event(Event::Settled(text)) => json!({ "kind": "settled", "text": text }),
            Update::Failed(failure) => failed(&failure),
        });
    };
    let chosen = app.state::<crate::Shell>().settings.lock().unwrap().dictation.microphone.clone().map(|m| Chosen { id: m.id, name: m.name });
    match Dictation::start(listener, chosen, on) {
        Ok(dictation) => {
            *state.running.lock().unwrap() = Some(Running { window, dictation, events });
            set_menu(app, true);
        }
        Err((failure, listener)) => {
            *state.listener.lock().unwrap() = Some(listener);
            let _ = events.send(failed(&failure));
        }
    }
}

/// Why the listener couldn't be opened, as the page tells it.
enum Opened {
    Model(String),
    Other(String),
}

impl From<Error> for Opened {
    fn from(e: Error) -> Self {
        match e {
            Error::Model(_) => Opened::Model(e.to_string()),
            _ => Opened::Other(e.to_string()),
        }
    }
}

fn failed(failure: &Failure) -> Value {
    match failure {
        Failure::NoMicrophone => json!({ "kind": "failed", "reason": "no-microphone" }),
        Failure::NotConnected(name) => json!({ "kind": "failed", "reason": "no-microphone", "message": format!("The microphone chosen for dictation, {name}, isn't connected. Connect it, or choose another in Dictation settings.") }),
        Failure::Microphone(e) => json!({ "kind": "failed", "reason": "microphone", "message": format!("Writer couldn't use the microphone ({e}). Check it's plugged in and that the system lets Writer use it, then dictate again.") }),
        Failure::Other(e) => json!({ "kind": "failed", "reason": "other", "message": e }),
    }
}

fn void<T>(_: T) {}

/// Stop hearing: the phrase being heard is settled and sent, then `stopped`.
#[tauri::command]
pub async fn dictate_stop(app: AppHandle) {
    let _ = tauri::async_runtime::spawn_blocking(move || stop_running(&app, |_| true)).await;
}

/// Stop the dictation running in a window `which` picks, if there is one: before its window closes
/// or the app quits, so the settled phrase reaches the page before it saves.
pub fn stop_running(app: &AppHandle, which: impl Fn(&str) -> bool) {
    let state = app.state::<Dictating>();
    let running = {
        let mut running = state.running.lock().unwrap();
        if running.as_ref().is_some_and(|r| which(&r.window)) { running.take() } else { None }
    };
    if let Some(running) = running {
        *state.listener.lock().unwrap() = Some(running.dictation.stop());
        let _ = running.events.send(json!({ "kind": "stopped" }));
        set_menu(app, false);
    }
}

/// The model in the app's data folder: ready, missing (not downloaded, or only partly) or damaged;
/// what it takes on disk, and what's left to download.
#[tauri::command]
pub fn dictation_model(app: AppHandle) -> Result<Value, String> {
    let dir = models(&app)?;
    let state = match model::check(&dir) {
        Ok(()) => "ready",
        Err(model::ModelError::Damaged(_)) => "damaged",
        Err(_) => "missing",
    };
    Ok(json!({ "state": state, "installedBytes": model::installed_bytes(), "downloadBytes": wanted(&dir).iter().map(|s| s.bytes).sum::<u64>() }))
}

/// The sources whose files aren't all there at their size.
fn wanted(dir: &Path) -> Vec<&'static model::Source> {
    model::SOURCES
        .iter()
        .filter(|s| model::FILES.iter().filter(|f| f.source == s.name).any(|f| fs::metadata(dir.join(f.path)).map(|m| m.len() != f.bytes).unwrap_or(true)))
        .collect()
}

/// Download what's missing of the model, installing each source as it comes; progress on
/// `progress` as `{ done, total }` bytes. Resumes a download cut short; refuses one that isn't what
/// its source lists. Ends with the whole model checked.
#[tauri::command]
pub async fn dictation_download(app: AppHandle, progress: Channel<Value>) -> Result<(), String> {
    let cancel = Arc::new(AtomicBool::new(false));
    *app.state::<Dictating>().cancel.lock().unwrap() = Some(cancel.clone());
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let dir = models(&app)?;
        let downloads = dir.join("downloads");
        fs::create_dir_all(&downloads).map_err(|e| e.to_string())?;
        let sources = wanted(&dir);
        let total: u64 = sources.iter().map(|s| s.bytes).sum();
        let client = reqwest::blocking::Client::builder().user_agent(concat!("Writer/", env!("CARGO_PKG_VERSION"))).build().map_err(|e| e.to_string())?;
        let mut before = 0;
        for source in sources {
            let file = downloads.join(source.url.rsplit('/').next().unwrap_or(source.name));
            fetch(&client, source.url, &file, source.bytes, &cancel, |done| {
                let _ = progress.send(json!({ "done": before + done, "total": total }));
            })?;
            model::install(source, &file, &dir).map_err(|e| {
                // A download that isn't the source's is no use to resume.
                let _ = fs::remove_file(&file);
                e.to_string()
            })?;
            let _ = fs::remove_file(&file);
            before += source.bytes;
        }
        let _ = fs::remove_dir(&downloads);
        model::verify(&dir).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;
    result
}

/// Download `url` into `to`, `bytes` long, going on from what's there already; `on` hears how much
/// is done. Stops, keeping what it has, when `cancel` is set.
pub fn fetch(client: &reqwest::blocking::Client, url: &str, to: &Path, bytes: u64, cancel: &AtomicBool, mut on: impl FnMut(u64)) -> Result<(), String> {
    let have = fs::metadata(to).map(|m| m.len()).unwrap_or(0);
    if have == bytes {
        on(bytes);
        return Ok(());
    }
    let mut request = client.get(url);
    if have > 0 && have < bytes {
        request = request.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let mut response = request.send().map_err(|e| format!("couldn't download the speech model: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("couldn't download the speech model: the server answered {status}"));
    }
    // A server that ignores the range sends it all again.
    let resumed = status == reqwest::StatusCode::PARTIAL_CONTENT;
    let mut out = OpenOptions::new().create(true).write(true).append(resumed).truncate(!resumed).open(to).map_err(|e| e.to_string())?;
    let mut done = if resumed { have } else { 0 };
    let mut buf = vec![0u8; 1 << 16];
    let mut told = 0;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        // A connection that closes early is an error here, or an early end: either way, what's
        // downloaded is kept for the next try.
        let n = response.read(&mut buf).unwrap_or(0);
        if n == 0 {
            break;
        }
        out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        done += n as u64;
        if done - told >= 1 << 20 || done == bytes {
            on(done);
            told = done;
        }
    }
    out.sync_all().map_err(|e| e.to_string())?;
    if done != bytes {
        return Err(format!("the download of the speech model stopped at {done} of {bytes} bytes: try again to go on from there"));
    }
    Ok(())
}

/// Stop the download under way, keeping what's downloaded so far for the next time.
#[tauri::command]
pub fn dictation_cancel_download(app: AppHandle) {
    if let Some(cancel) = app.state::<Dictating>().cancel.lock().unwrap().as_ref() {
        cancel.store(true, Ordering::SeqCst);
    }
}

/// Remove the model from this computer (it can be downloaded again).
#[tauri::command]
pub fn dictation_remove_model(app: AppHandle) -> Result<(), String> {
    stop_running(&app, |_| true);
    app.state::<Dictating>().listener.lock().unwrap().take();
    let dir = models(&app)?;
    match fs::remove_dir_all(&dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// What dictation's settings show (#80): what's kept, the recognizers this app has (one: every one is
/// on the device, D17), and the microphones connected now, none of them opened.
#[tauri::command]
pub async fn dictation_settings(app: AppHandle) -> Value {
    let settings = app.state::<crate::Shell>().settings.lock().unwrap().dictation.clone();
    let microphones = tauri::async_runtime::spawn_blocking(mic::microphones).await.unwrap_or_default();
    json!({
        "settings": settings,
        "recognizers": [{ "id": "writer", "words": "On this computer, with Writer's speech model" }],
        "microphones": microphones.iter().map(|m| json!({ "id": m.id, "name": m.name, "bluetooth": m.bluetooth })).collect::<Vec<_>>(),
    })
}

/// Keep dictation's settings, beside the app's others. The next dictation hears with them.
#[tauri::command]
pub fn dictation_save_settings(app: AppHandle, settings: crate::settings::Dictation) -> Result<(), String> {
    let all = {
        let shell = app.state::<crate::Shell>();
        let mut kept = shell.settings.lock().unwrap();
        kept.dictation = settings;
        kept.clone()
    };
    all.save(&app.path().app_config_dir().map_err(|e| e.to_string())?)
}

/// The window's page offers Dictate (it has an editor), or no longer does: the Edit menu follows.
#[tauri::command]
pub fn dictation_offered(window: WebviewWindow, offered: bool) {
    let state = window.state::<Dictating>();
    {
        let mut windows = state.offered.lock().unwrap();
        if offered {
            windows.insert(window.label().to_string());
        } else {
            windows.remove(window.label());
        }
    }
    if window.is_focused().unwrap_or(false) {
        focused(window.app_handle(), window.label());
    }
}

/// A window came forward: Start Dictation is there if its page offers Dictate.
pub fn focused(app: &AppHandle, label: &str) {
    let state = app.state::<Dictating>();
    let offered = state.offered.lock().unwrap().contains(label);
    let listening = state.running.lock().unwrap().as_ref().is_some_and(|r| r.window == label);
    if let Some(item) = state.menu.lock().unwrap().as_ref() {
        let _ = item.set_enabled(offered || listening);
    }
}

/// A window went: it offers nothing, and its dictation stops.
pub fn closed(app: &AppHandle, label: &str) {
    app.state::<Dictating>().offered.lock().unwrap().remove(label);
    stop_running(app, |window| window == label);
}

fn set_menu(app: &AppHandle, listening: bool) {
    if let Some(item) = app.state::<Dictating>().menu.lock().unwrap().as_ref() {
        let _ = item.set_text(if listening { "Stop Dictation" } else { "Start Dictation" });
    }
}

#[cfg(test)]
mod tests {
    use super::fetch;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::sync::atomic::AtomicBool;

    /// A server for `body` that honours a range, if `ranges`, and stops after `cut` bytes once.
    fn serve(body: Vec<u8>, ranges: bool, cut: Option<usize>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/model", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            let mut cut = cut;
            for stream in listener.incoming() {
                let mut stream = stream.unwrap();
                let mut from = 0;
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line.trim().is_empty() {
                        break;
                    }
                    if let Some(range) = line.to_lowercase().strip_prefix("range: bytes=") {
                        from = if ranges { range.trim().trim_end_matches('-').parse().unwrap() } else { 0 };
                    }
                }
                let part = &body[from..];
                let status = if from > 0 { "206 Partial Content" } else { "200 OK" };
                let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", part.len());
                match cut.take() {
                    Some(n) => {
                        let _ = stream.write_all(&part[..n]);
                    }
                    None => {
                        let _ = stream.write_all(part);
                    }
                }
            }
        });
        url
    }

    fn body() -> Vec<u8> {
        (0..300_000u32).map(|i| (i % 251) as u8).collect()
    }

    #[test]
    fn downloads_whole_and_tells_how_far_it_is() {
        let dir = tempfile::tempdir().unwrap();
        let to = dir.path().join("model");
        let url = serve(body(), true, None);
        let mut seen = Vec::new();
        fetch(&reqwest::blocking::Client::new(), &url, &to, 300_000, &AtomicBool::new(false), |d| seen.push(d)).unwrap();
        assert_eq!(std::fs::read(&to).unwrap(), body());
        assert_eq!(seen.last(), Some(&300_000));
    }

    #[test]
    fn a_download_cut_short_goes_on_from_where_it_stopped() {
        let dir = tempfile::tempdir().unwrap();
        let to = dir.path().join("model");
        let url = serve(body(), true, Some(100_000));
        let client = reqwest::blocking::Client::new();
        let first = fetch(&client, &url, &to, 300_000, &AtomicBool::new(false), |_| {});
        assert!(first.unwrap_err().contains("stopped at 100000 of 300000 bytes"));
        fetch(&client, &url, &to, 300_000, &AtomicBool::new(false), |_| {}).unwrap();
        assert_eq!(std::fs::read(&to).unwrap(), body());
    }

    #[test]
    fn a_server_that_ignores_ranges_is_downloaded_again_from_the_start() {
        let dir = tempfile::tempdir().unwrap();
        let to = dir.path().join("model");
        std::fs::write(&to, &body()[..50_000]).unwrap();
        let url = serve(body(), false, None);
        fetch(&reqwest::blocking::Client::new(), &url, &to, 300_000, &AtomicBool::new(false), |_| {}).unwrap();
        assert_eq!(std::fs::read(&to).unwrap(), body());
    }

    #[test]
    fn cancelling_keeps_what_was_downloaded() {
        let dir = tempfile::tempdir().unwrap();
        let to = dir.path().join("model");
        let url = serve(body(), true, None);
        let error = fetch(&reqwest::blocking::Client::new(), &url, &to, 300_000, &AtomicBool::new(true), |_| {}).unwrap_err();
        assert_eq!(error, "cancelled");
    }
}
