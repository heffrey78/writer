//! Writer's Android plugin (#52). Its Kotlin (android/) seals and opens bytes with an AES key that
//! lives in Android's keystore and can't leave it, for the GitHub token; and, when the webview loads,
//! gives the page's service worker (packages/web/public/engine-sw.js) the same answers as the page,
//! which Android's webview otherwise asks the network for.

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

/// The keystore's cipher, as the app's secrets store (secrets.rs there) uses it.
pub struct Keystore<R: Runtime>(#[allow(dead_code)] tauri::plugin::PluginHandle<R>);

impl<R: Runtime> Keystore<R> {
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
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("writer-android")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            app.manage(Keystore(api.register_android_plugin("io.github.heffrey78.writer.android", "WriterPlugin")?));
            // Elsewhere, no keystore: the app's secrets say so.
            #[cfg(not(target_os = "android"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}
