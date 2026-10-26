//! Writer's Android plugin (#52). Its Kotlin (android/) seals and opens bytes with an AES key that
//! lives in Android's keystore and can't leave it, for the GitHub token; opens other sites in the
//! phone's browser; asks for the microphone, for dictation (#86); and, when the webview loads, keeps the page clear of the system's bars and gives
//! the page's service worker (packages/web/public/engine-sw.js) the same answers as the page, which
//! Android's webview otherwise asks the network for.

use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder, TauriPlugin};
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::Runtime;

#[derive(Serialize, Deserialize)]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
struct Bytes {
    /// Base64.
    data: String,
}

#[derive(Serialize)]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
struct Address {
    url: String,
}

#[derive(Serialize)]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
struct Ask {
    ask: bool,
}

#[derive(Deserialize)]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
struct Allowed {
    state: String,
}

/// The plugin's Kotlin: the keystore's cipher, as the app's secrets store (secrets.rs there) uses
/// it, and the phone's browser.
pub struct Android<R: Runtime>(#[allow(dead_code)] tauri::plugin::PluginHandle<R>);

impl<R: Runtime> Android<R> {
    fn run(&self, op: &str, data: String) -> Result<String, String> {
        #[cfg(target_os = "android")]
        return self.0.run_mobile_plugin::<Bytes>(op, Bytes { data }).map(|b| b.data).map_err(|e| e.to_string());
        #[cfg(not(target_os = "android"))]
        return Err(format!("No keystore here to {op} {} bytes: the keystore is Android's.", data.len()));
    }

    /// `plain` (base64) sealed with the keystore's key: base64 of the nonce and the ciphertext.
    pub fn seal(&self, plain: String) -> Result<String, String> {
        self.run("seal", plain)
    }

    /// What `seal` sealed, back; an error if the key that sealed it is gone.
    pub fn open(&self, sealed: String) -> Result<String, String> {
        self.run("open", sealed)
    }

    /// Whether the microphone may be used: "granted", "prompt" or "denied" (for good: only Android's
    /// settings can allow it now). With `ask`, Android's prompt first, where it would show one; it
    /// waits for the writer's answer, so not from the main thread.
    pub fn microphone(&self, ask: bool) -> Result<String, String> {
        #[cfg(target_os = "android")]
        return self.0.run_mobile_plugin::<Allowed>("microphone", Ask { ask }).map(|a| a.state).map_err(|e| e.to_string());
        #[cfg(not(target_os = "android"))]
        return Err(format!("No microphone to ask for here (ask: {ask}): it's Android's."));
    }

    /// `url` opened by the phone (its browser), from a thread of its own: the Kotlin runs on the
    /// main thread, which a navigation is decided on.
    #[cfg(target_os = "android")]
    fn view(&self, url: String) {
        let handle = self.0.clone();
        std::thread::spawn(move || drop(handle.run_mobile_plugin::<()>("view", Address { url })));
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("writer-android")
        // The app's own pages stay in its webview. Another site (GitHub's sign-in page, a link in a
        // note) opens in the phone's browser: in the webview it would take the place of the app,
        // and the app's engine with it.
        .on_navigation(|webview, url| {
            let elsewhere = matches!(url.scheme(), "http" | "https") && url.host_str() != Some("tauri.localhost");
            #[cfg(target_os = "android")]
            if elsewhere {
                if let Some(android) = webview.try_state::<Android<R>>() {
                    android.view(url.to_string());
                }
                return false;
            }
            let _ = (webview, elsewhere);
            true
        })
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            app.manage(Android(api.register_android_plugin("io.github.heffrey78.writer.android", "WriterPlugin")?));
            // Elsewhere, no keystore: the app's secrets say so.
            #[cfg(not(target_os = "android"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}
