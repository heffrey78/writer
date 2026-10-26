fn main() {
    // The app's own commands, declared so a capability can grant them to the server's pages.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&["flushed", "page_ready", "pick_folder", "open_novel", "show_library", "set_recent", "edit", "clipboard_text", "can_inspect", "inspect", "dictation_available", "dictate_start", "dictate_stop", "dictation_model", "dictation_download", "dictation_cancel_download", "dictation_remove_model", "dictation_offered", "dictation_settings", "dictation_save_settings"])))
        .expect("the app couldn't be set up for building");
}
