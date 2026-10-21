//! What the engine knows of its host on Android (remote-ports.ts's HostFacts): the app's folders, and
//! the book templates, put in the app's storage from the app itself.

use include_dir::{Dir, include_dir};
use serde_json::{Value, json};
use std::path::Path;

/// The templates new books are made from (templates/ at the repository's top).
static TEMPLATES: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/../../../templates");

/// A fingerprint of the templates this app carries (FNV-1a 64 over their paths and bytes).
fn fingerprint() -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut eat = |bytes: &[u8]| {
        for b in bytes {
            h ^= *b as u64;
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
    };
    let mut files = vec![];
    collect(&TEMPLATES, &mut files);
    files.sort_by_key(|f| f.path());
    for f in files {
        eat(f.path().to_string_lossy().as_bytes());
        eat(f.contents());
    }
    format!("{h:016x}")
}

fn collect<'a>(dir: &'a Dir<'a>, out: &mut Vec<&'a include_dir::File<'a>>) {
    out.extend(dir.files());
    for d in dir.dirs() {
        collect(d, out);
    }
}

/// The templates at `to`, as this app carries them: written afresh when they're not the same.
pub fn put_templates(to: &Path) -> Result<(), String> {
    let marker = to.join(".fingerprint");
    let want = fingerprint();
    if std::fs::read_to_string(&marker).ok().as_deref() == Some(want.as_str()) {
        return Ok(());
    }
    let _ = std::fs::remove_dir_all(to);
    let mut files = vec![];
    collect(&TEMPLATES, &mut files);
    for f in files {
        let path = to.join(f.path());
        std::fs::create_dir_all(path.parent().unwrap_or(to)).map_err(|e| e.to_string())?;
        std::fs::write(&path, f.contents()).map_err(|e| e.to_string())?;
    }
    std::fs::write(marker, want).map_err(|e| e.to_string())
}

/// The host's facts, for the engine: everything under the app's own folder. `env.json` there, if
/// any, is the engine's environment: for trying the app against a GitHub other than github.com.
pub fn facts(root: &Path) -> Value {
    let env = std::fs::read_to_string(root.join("env.json")).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()).unwrap_or_else(|| json!({}));
    let at = |p: &str| root.join(p).to_string_lossy().to_string();
    json!({
        "env": env,
        "configDir": at("config"),
        "booksDir": at("books"),
        "templates": at("templates"),
        "home": root.to_string_lossy(),
        "cwd": root.to_string_lossy(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn puts_the_templates_once_and_again_when_they_change() {
        let dir = tempfile::tempdir().unwrap();
        let to = dir.path().join("templates");
        put_templates(&to).unwrap();
        // Hidden folders too: the books' vendored tools.
        assert!(to.join("novel/.github/gh-writer/validate.mjs").is_file());
        assert!(to.join("journal/book.yaml").is_file());
        // Left alone while the same; put back once the marker says otherwise.
        std::fs::write(to.join("novel/extra.md"), "mine").unwrap();
        put_templates(&to).unwrap();
        assert!(to.join("novel/extra.md").exists());
        std::fs::write(to.join(".fingerprint"), "old").unwrap();
        put_templates(&to).unwrap();
        assert!(!to.join("novel/extra.md").exists());
        assert!(to.join("novel/.github/gh-writer/validate.mjs").is_file());
    }

    #[test]
    fn says_where_things_are_under_the_apps_folder() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("env.json"), r#"{ "WRITER_GITHUB_URL": "http://127.0.0.1:47811" }"#).unwrap();
        let f = facts(dir.path());
        assert_eq!(f["booksDir"], dir.path().join("books").to_string_lossy().as_ref());
        assert_eq!(f["env"]["WRITER_GITHUB_URL"], "http://127.0.0.1:47811");
    }
}
