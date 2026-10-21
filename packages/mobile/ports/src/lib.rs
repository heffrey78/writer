//! The Android app's ports (D16, #52), apart from Tauri: the files port in the app's storage, the
//! GitHub token sealed by a cipher (Android's keystore, in the app), and the host's facts and
//! templates. The app (src-tauri) gives them to the engine in its webview.

pub mod files;
pub mod host;
pub mod secrets;
