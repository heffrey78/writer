//! The app's own settings, in settings.json in its config folder. The writer's work and library live
//! elsewhere (the novels' folders, the server's library.json); these are only how the app runs.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Use the computer's own git instead of the one inside the app.
    pub system_git: bool,
    pub dictation: Dictation,
}

/// How dictation hears the writer (#80): kept on this computer, never in a book. The page shows and
/// changes them (DEVELOPER.md, *Dictation*).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Dictation {
    /// The recognizer chosen, where there's more than one; none for the first.
    pub recognizer: Option<String>,
    /// The microphone chosen; none for the system's default.
    pub microphone: Option<Microphone>,
    /// Listening stops after this long without a word heard.
    pub silence_seconds: u32,
    /// Each settled phrase is read out to a screen reader.
    pub announce: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Microphone {
    pub id: String,
    /// Its name when chosen, for saying it isn't connected.
    pub name: String,
}

impl Default for Dictation {
    fn default() -> Self {
        Dictation { recognizer: None, microphone: None, silence_seconds: 60, announce: false }
    }
}

impl Settings {
    fn file(dir: &Path) -> PathBuf {
        dir.join("settings.json")
    }

    /// The settings in `dir`, or the defaults if there are none (or they can't be read).
    pub fn load(dir: &Path) -> Settings {
        fs::read_to_string(Self::file(dir)).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
    }

    pub fn save(&self, dir: &Path) -> Result<(), String> {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let text = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(Self::file(dir), text).map_err(|e| format!("Couldn't save the app's settings: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::{Dictation, Microphone, Settings};

    #[test]
    fn keeps_what_it_saved_and_defaults_otherwise() {
        let dir = std::env::temp_dir().join(format!("writer-settings-{}", std::process::id()));
        assert!(!Settings::load(&dir).system_git);
        Settings { system_git: true, ..Settings::default() }.save(&dir).unwrap();
        assert!(Settings::load(&dir).system_git);
        assert_eq!(Settings::load(&dir).dictation, Dictation::default());
        std::fs::write(dir.join("settings.json"), "not json").unwrap();
        assert!(!Settings::load(&dir).system_git);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn keeps_dictation_settings_beside_the_others() {
        let dir = std::env::temp_dir().join(format!("writer-dictation-settings-{}", std::process::id()));
        let dictation = Dictation { microphone: Some(Microphone { id: "pulseaudio:alsa_input.usb".into(), name: "USB Microphone".into() }), silence_seconds: 120, announce: true, ..Dictation::default() };
        Settings { system_git: true, dictation: dictation.clone() }.save(&dir).unwrap();
        assert_eq!(Settings::load(&dir).dictation, dictation);
        // Settings saved before dictation had any keep theirs, and dictation's defaults.
        std::fs::write(dir.join("settings.json"), r#"{ "systemGit": true }"#).unwrap();
        let loaded = Settings::load(&dir);
        assert!(loaded.system_git);
        assert_eq!(loaded.dictation.silence_seconds, 60);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
