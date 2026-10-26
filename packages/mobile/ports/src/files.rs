//! The files port (D16) on Android: the engine's reads, atomic writes, listings and watches in the
//! app's storage, as packages/server/src/files-port/node.ts does them on the desktop. The page calls
//! these by name (remote-ports.ts), with its arguments as JSON and bytes as `{ "$bytes": base64 }`.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use notify::event::{AccessKind, AccessMode, CreateKind, ModifyKind, RemoveKind, RenameMode};
use notify::{EventKind, RecursiveMode, Watcher};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Suffix of the temporary files atomic writes leave behind if the app dies mid-write (files-port/port.ts).
pub const TEMP_SUFFIX: &str = ".ghw-tmp";

/// A failure as the page reads one: Node's error code where there is one, which the engine checks.
#[derive(Debug)]
pub struct Failure {
    pub code: Option<&'static str>,
    pub message: String,
}

impl Failure {
    pub fn to_json(&self) -> Value {
        match self.code {
            Some(code) => json!({ "code": code, "message": self.message }),
            None => json!({ "message": self.message }),
        }
    }
}

impl From<std::io::Error> for Failure {
    fn from(e: std::io::Error) -> Self {
        let code = match e.kind() {
            ErrorKind::NotFound => Some("ENOENT"),
            ErrorKind::AlreadyExists => Some("EEXIST"),
            ErrorKind::PermissionDenied => Some("EACCES"),
            ErrorKind::NotADirectory => Some("ENOTDIR"),
            ErrorKind::IsADirectory => Some("EISDIR"),
            ErrorKind::DirectoryNotEmpty => Some("ENOTEMPTY"),
            ErrorKind::CrossesDevices => Some("EXDEV"),
            _ => None,
        };
        Failure { code, message: e.to_string() }
    }
}

fn missing(e: &std::io::Error) -> bool {
    matches!(e.kind(), ErrorKind::NotFound | ErrorKind::NotADirectory)
}

fn kind_of(t: std::fs::FileType) -> &'static str {
    if t.is_symlink() {
        "symlink"
    } else if t.is_dir() {
        "dir"
    } else if t.is_file() {
        "file"
    } else {
        "other"
    }
}

/// A file's bytes, or None if there's no file there.
pub fn read(path: &str) -> Result<Option<Vec<u8>>, Failure> {
    match std::fs::read(path) {
        Ok(b) => Ok(Some(b)),
        Err(e) if missing(&e) || e.kind() == ErrorKind::IsADirectory => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// What's at `path`, not following a symlink there: `{ kind, size, mtimeMs }`, or None.
pub fn stat(path: &str) -> Result<Option<Value>, Failure> {
    let info = match std::fs::symlink_metadata(path) {
        Ok(i) => i,
        Err(e) if missing(&e) => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let mtime = info.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0.0, |d| d.as_secs_f64() * 1000.0);
    Ok(Some(json!({ "kind": kind_of(info.file_type()), "size": info.len(), "mtimeMs": mtime })))
}

/// A folder's entries, or everything under it, as `{ path, kind }` by "/"-separated path, sorted.
pub fn list(path: &str, recursive: bool) -> Result<Vec<Value>, Failure> {
    fn walk(root: &Path, dir: &Path, recursive: bool, out: &mut Vec<(String, &'static str)>) -> std::io::Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let kind = kind_of(entry.file_type()?);
            let full = entry.path();
            out.push((rel(root, &full), kind));
            if recursive && kind == "dir" {
                walk(root, &full, true, out)?;
            }
        }
        Ok(())
    }
    let root = Path::new(path);
    let mut out = vec![];
    match walk(root, root, recursive, &mut out) {
        Ok(()) => {}
        Err(e) if missing(&e) => return Ok(vec![]),
        Err(e) => return Err(e.into()),
    }
    out.sort();
    Ok(out.into_iter().map(|(path, kind)| json!({ "path": path, "kind": kind })).collect())
}

fn rel(root: &Path, path: &Path) -> String {
    path.strip_prefix(root).unwrap_or(path).components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/")
}

/// Six random-enough bytes, as hex, for a temp file's name: the time, a counter and the process.
fn nonce() -> String {
    static COUNT: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_nanos() as u64);
    let mixed = nanos ^ (COUNT.fetch_add(1, Ordering::Relaxed).wrapping_mul(0x9E37_79B9_7F4A_7C15)) ^ ((std::process::id() as u64) << 32);
    format!("{:012x}", mixed & 0xFFFF_FFFF_FFFF)
}

/// `data` put at `path` so that a crash at any point leaves the old file or the new one: a temp file
/// in the same folder (made with its parents), flushed, renamed over the target, and the folder
/// flushed so the rename lasts. The file keeps its permissions.
pub fn write(path: &str, data: &[u8]) -> Result<(), Failure> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let full = Path::new(path);
    let dir = full.parent().ok_or_else(|| Failure { code: None, message: format!("{path} has no folder") })?;
    std::fs::create_dir_all(dir)?;
    let mode = std::fs::metadata(full).map(|m| m.permissions().mode() & 0o777).unwrap_or(0o644);
    let name = full.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let temp = dir.join(format!(".{name}.{}{TEMP_SUFFIX}", nonce()));
    let written = (|| {
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).mode(mode).open(&temp)?;
        file.write_all(data)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, full)
    })();
    if let Err(e) = written {
        let _ = std::fs::remove_file(&temp);
        return Err(e.into());
    }
    std::fs::File::open(dir)?.sync_all()?;
    Ok(())
}

pub fn remove(path: &str) -> Result<(), Failure> {
    match std::fs::remove_file(path) {
        Err(e) if !missing(&e) => Err(e.into()),
        _ => Ok(()),
    }
}

pub fn remove_tree(path: &str) -> Result<(), Failure> {
    match std::fs::symlink_metadata(path) {
        Err(e) if missing(&e) => Ok(()),
        Err(e) => Err(e.into()),
        Ok(m) if m.is_dir() => Ok(std::fs::remove_dir_all(path)?),
        Ok(_) => Ok(std::fs::remove_file(path)?),
    }
}

/// An empty folder gone: false, and kept, if it isn't empty (or isn't there).
pub fn remove_empty_dir(path: &str) -> bool {
    std::fs::remove_dir(path).is_ok()
}

/// `path` with every symlink in it followed; None if nothing is there.
pub fn real(path: &str) -> Option<String> {
    std::fs::canonicalize(path).ok().map(|p| p.to_string_lossy().to_string())
}

/// What to do with a watch's events: `(type, path from the root)`.
pub type Sink = Arc<dyn Fn(&str, &str) + Send + Sync>;

/// A watch on a folder: additions, changes and removals of files under it, by anyone.
pub struct Watch {
    _watcher: notify::RecommendedWatcher,
}

/// Watch `root`. git's own folder and the temp files of atomic writes are left out here, before the
/// page's own `ignore`: never a book's files, and a sync writes hundreds in git's. Files are told apart from what was there before (`add`
/// for new ones, `change` for others), as chokidar does on the desktop, since an atomic write
/// arrives as a rename either way.
pub fn watch(root: &str, sink: Sink) -> Result<Watch, Failure> {
    let root = PathBuf::from(root);
    let known: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
    {
        let mut known = known.lock().unwrap();
        for e in list(&root.to_string_lossy(), true)? {
            if e["kind"] == "file" && !skipped(e["path"].as_str().unwrap_or("")) {
                known.insert(e["path"].as_str().unwrap_or("").to_string());
            }
        }
    }
    let base = root.clone();
    let all = Arc::clone(&known);
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        // A folder just made is looked through again a moment later, for the files it had by the
        // time its own watch was in place: one written there in between (an atomic write's rename)
        // would be missed otherwise. Only those not known yet are told of then.
        if let EventKind::Create(CreateKind::Folder | CreateKind::Any) = event.kind {
            for dir in event.paths.iter().filter(|p| p.is_dir()).cloned() {
                let (known, sink, base) = (Arc::clone(&all), Arc::clone(&sink), base.clone());
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(250));
                    let mut known = known.lock().unwrap();
                    for e in list(&dir.to_string_lossy(), true).unwrap_or_default() {
                        if e["kind"] != "file" {
                            continue;
                        }
                        let p = rel(&base, &dir.join(e["path"].as_str().unwrap_or("")));
                        if !skipped(&p) && known.insert(p.clone()) {
                            sink("add", &p);
                        }
                    }
                });
            }
        }
        let mut known = all.lock().unwrap();
        // A file, or a folder that's new and everything already in it: inotify watches a new folder
        // only once it's seen, so what's written there first would be missed.
        fn appeared(base: &Path, path: &Path, known: &mut HashSet<String>, sink: &Sink) {
            if path.is_dir() {
                for e in list(&path.to_string_lossy(), true).unwrap_or_default() {
                    if e["kind"] == "file" {
                        appeared(base, &path.join(e["path"].as_str().unwrap_or("")), known, sink);
                    }
                }
                return;
            }
            let p = rel(base, path);
            if !path.is_file() || skipped(&p) {
                return;
            }
            let fresh = known.insert(p.clone());
            sink(if fresh { "add" } else { "change" }, &p);
        }
        let appeared = |path: &Path, known: &mut HashSet<String>| appeared(&base, path, known, &sink);
        let gone = |path: &Path, known: &mut HashSet<String>| {
            let p = rel(&base, path);
            if known.remove(&p) {
                sink("unlink", &p);
            }
        };
        match event.kind {
            EventKind::Create(CreateKind::File | CreateKind::Folder | CreateKind::Any) | EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
                for p in &event.paths {
                    appeared(p, &mut known);
                }
            }
            // inotify's rename comes as From, then To, then Both (the two paths): the first two are enough.
            EventKind::Modify(ModifyKind::Name(RenameMode::From)) | EventKind::Remove(RemoveKind::File | RemoveKind::Any) => {
                for p in &event.paths {
                    gone(p, &mut known);
                }
            }
            // A folder gone takes its files with it.
            EventKind::Remove(RemoveKind::Folder) => {
                for p in &event.paths {
                    let prefix = format!("{}/", rel(&base, p));
                    let under: Vec<String> = known.iter().filter(|k| k.starts_with(&prefix)).cloned().collect();
                    for k in under {
                        known.remove(&k);
                        sink("unlink", &k);
                    }
                }
            }
            // Written in place by someone else: once, when they close it.
            EventKind::Access(AccessKind::Close(AccessMode::Write)) => {
                for p in &event.paths {
                    appeared(p, &mut known);
                }
            }
            _ => {}
        }
    })
    .map_err(|e| Failure { code: None, message: e.to_string() })?;
    watcher.watch(&root, RecursiveMode::Recursive).map_err(|e| Failure { code: None, message: e.to_string() })?;
    Ok(Watch { _watcher: watcher })
}

/// git's own folder, and the port's temp files.
fn skipped(path: &str) -> bool {
    path == ".git" || path.starts_with(".git/") || path.ends_with(TEMP_SUFFIX)
}

/// The port's operations by name, as remote-ports.ts calls them; `watch` and `unwatch` are the app's
/// (lib.rs), which keeps the watches and sends their events.
pub fn call(op: &str, args: &[Value]) -> Result<Value, Failure> {
    let path = |i: usize| -> Result<&str, Failure> { args.get(i).and_then(Value::as_str).ok_or_else(|| Failure { code: None, message: format!("{op}: argument {i} isn't a path") }) };
    Ok(match op {
        "read" => read(path(0)?)?.map_or(Value::Null, |b| json!({ "$bytes": BASE64.encode(b) })),
        "stat" => stat(path(0)?)?.unwrap_or(Value::Null),
        "list" => Value::Array(list(path(0)?, args.get(1).and_then(|o| o["recursive"].as_bool()).unwrap_or(false))?),
        "write" => {
            let data = match args.get(1) {
                Some(Value::String(s)) => s.as_bytes().to_vec(),
                Some(v) => BASE64.decode(v["$bytes"].as_str().unwrap_or("")).map_err(|e| Failure { code: None, message: e.to_string() })?,
                None => vec![],
            };
            write(path(0)?, &data)?;
            Value::Null
        }
        "remove" => remove(path(0)?).map(|_| Value::Null)?,
        "removeTree" => remove_tree(path(0)?).map(|_| Value::Null)?,
        "removeEmptyDir" => Value::Bool(remove_empty_dir(path(0)?)),
        "rename" => std::fs::rename(path(0)?, path(1)?).map(|_| Value::Null)?,
        "makeDir" => std::fs::create_dir_all(path(0)?).map(|_| Value::Null)?,
        "copy" => std::fs::copy(path(0)?, path(1)?).map(|_| Value::Null)?,
        "real" => real(path(0)?).map_or(Value::Null, Value::String),
        _ => return Err(Failure { code: None, message: format!("No files operation {op}.") }),
    })
}

/// The app's watches, by the id the page knows them by.
#[derive(Default)]
pub struct Watches {
    next: AtomicU64,
    open: Mutex<HashMap<String, Watch>>,
}

impl Watches {
    /// A watch on `root` whose events go to `send` as `{ watch, type, path }`; its id.
    pub fn start(&self, root: &str, send: Arc<dyn Fn(Value) + Send + Sync>) -> Result<String, Failure> {
        let id = format!("w{}", self.next.fetch_add(1, Ordering::Relaxed) + 1);
        let watch_id = id.clone();
        let w = watch(root, Arc::new(move |t: &str, p: &str| send(json!({ "watch": watch_id, "type": t, "path": p }))))?;
        self.open.lock().unwrap().insert(id.clone(), w);
        Ok(id)
    }

    pub fn stop(&self, id: &str) {
        self.open.lock().unwrap().remove(id);
    }

    pub fn stop_all(&self) {
        self.open.lock().unwrap().clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn text(b: Option<Vec<u8>>) -> Option<String> {
        b.map(|b| String::from_utf8(b).unwrap())
    }

    #[test]
    fn writes_atomically_making_the_folders_and_reads_back_leaving_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let path = format!("{root}/manuscript/01-arrival/01-the-station.md");
        assert_eq!(read(&path).unwrap(), None);
        write(&path, b"Ada stepped off the train.\n").unwrap();
        assert_eq!(text(read(&path).unwrap()).as_deref(), Some("Ada stepped off the train.\n"));
        write(&path, b"Bytes too.\n").unwrap();
        assert_eq!(text(read(&path).unwrap()).as_deref(), Some("Bytes too.\n"));
        let entries = list(&format!("{root}/manuscript/01-arrival"), false).unwrap();
        assert_eq!(entries, vec![json!({ "path": "01-the-station.md", "kind": "file" })]);
        let info = stat(&path).unwrap().unwrap();
        assert_eq!((info["kind"].as_str(), info["size"].as_u64()), (Some("file"), Some(11)));
        assert_eq!(stat(&format!("{root}/manuscript")).unwrap().unwrap()["kind"], "dir");
        assert_eq!(stat(&format!("{root}/nothing")).unwrap(), None);
        // A folder isn't a file to read.
        assert_eq!(read(&format!("{root}/manuscript")).unwrap(), None);
    }

    #[test]
    fn keeps_a_files_permissions_and_leaves_the_old_file_when_the_new_one_cant_be_put_in_place() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        let p = path.to_string_lossy().to_string();
        write(&p, b"Old.\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        write(&p, b"New.\n").unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        // A folder where the file would go: the rename fails, the temp file goes, the folder stays.
        let blocked = dir.path().join("blocked");
        std::fs::create_dir_all(blocked.join("inside")).unwrap();
        assert!(write(&blocked.to_string_lossy(), b"x").is_err());
        assert!(blocked.join("inside").is_dir());
        let names: Vec<String> = std::fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
        assert!(names.iter().all(|n| !n.ends_with(TEMP_SUFFIX)), "{names:?}");
    }

    #[test]
    fn lists_a_folder_or_everything_under_it_sorted_and_nothing_for_a_folder_that_isnt_there() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        for (p, t) in [("b.md", "b"), ("a/c.md", "c"), ("a/d/e.md", "e")] {
            write(&format!("{root}/{p}"), t.as_bytes()).unwrap();
        }
        assert_eq!(list(&root, false).unwrap(), vec![json!({ "path": "a", "kind": "dir" }), json!({ "path": "b.md", "kind": "file" })]);
        let all: Vec<String> = list(&root, true).unwrap().iter().map(|e| format!("{} {}", e["kind"].as_str().unwrap(), e["path"].as_str().unwrap())).collect();
        assert_eq!(all, ["dir a", "file a/c.md", "dir a/d", "file a/d/e.md", "file b.md"]);
        assert_eq!(list(&format!("{root}/none"), false).unwrap(), Vec::<Value>::new());
    }

    #[test]
    fn removes_renames_copies_and_removes_a_folder_only_when_empty_or_a_whole_tree() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let [a, b, c] = ["a/x.md", "a/y.md", "z.md"].map(|p| format!("{root}/{p}"));
        write(&a, b"x").unwrap();
        call("rename", &[json!(a), json!(b)]).unwrap();
        assert_eq!(read(&a).unwrap(), None);
        call("copy", &[json!(b), json!(c)]).unwrap();
        assert_eq!(text(read(&c).unwrap()).as_deref(), Some("x"));
        assert!(!remove_empty_dir(&format!("{root}/a")));
        remove(&b).unwrap();
        remove(&b).unwrap();
        assert!(remove_empty_dir(&format!("{root}/a")));
        write(&format!("{root}/t/u/v.md"), b"v").unwrap();
        remove_tree(&format!("{root}/t")).unwrap();
        remove_tree(&format!("{root}/t")).unwrap();
        assert_eq!(stat(&format!("{root}/t")).unwrap(), None);
        call("makeDir", &[json!(format!("{root}/made/deep"))]).unwrap();
        assert_eq!(stat(&format!("{root}/made/deep")).unwrap().unwrap()["kind"], "dir");
        assert_eq!(real(&format!("{root}/none")), None);
    }

    #[test]
    fn carries_bytes_as_base64_by_name_and_says_what_failed_with_nodes_code() {
        let dir = tempfile::tempdir().unwrap();
        let path = format!("{}/a.md", dir.path().to_string_lossy());
        call("write", &[json!(path), json!({ "$bytes": BASE64.encode("Ada\n") })]).unwrap();
        assert_eq!(call("read", &[json!(path)]).unwrap(), json!({ "$bytes": BASE64.encode("Ada\n") }));
        assert_eq!(call("read", &[json!(format!("{path}.none"))]).unwrap(), Value::Null);
        let failed = call("rename", &[json!(format!("{path}.none")), json!(path)]).unwrap_err();
        assert_eq!(failed.code, Some("ENOENT"));
        assert!(call("chmod", &[]).unwrap_err().message.contains("No files operation chmod"));
    }

    #[test]
    fn watches_changes_by_anyone_by_path_from_the_root_and_not_gits_own() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        write(&format!("{root}/a.md"), b"a").unwrap();
        let events = Arc::new(Mutex::new(Vec::<String>::new()));
        let seen = Arc::clone(&events);
        let w = watch(&root, Arc::new(move |t: &str, p: &str| seen.lock().unwrap().push(format!("{t} {p}")))).unwrap();
        let until = |want: &[&str]| {
            let start = Instant::now();
            loop {
                let got = events.lock().unwrap().clone();
                if want.iter().all(|w| got.iter().any(|g| g == w)) || start.elapsed() > Duration::from_secs(5) {
                    return got;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        };
        write(&format!("{root}/b.md"), b"b").unwrap();
        // Seen before it's removed: a file gone by the time its arrival is read is told of neither way.
        until(&["add b.md"]);
        write(&format!("{root}/a.md"), b"a2").unwrap();
        write(&format!("{root}/.git/objects/ab/cd"), b"object").unwrap();
        remove(&format!("{root}/b.md")).unwrap();
        // Another app's write in place; a file written in a folder as it's made; then that folder
        // gone with what's in it.
        std::fs::write(format!("{root}/a.md"), b"a3").unwrap();
        write(&format!("{root}/gone/c.md"), b"c").unwrap();
        let got = until(&["add b.md", "change a.md", "unlink b.md", "add gone/c.md"]);
        assert!(["add b.md", "change a.md", "unlink b.md", "add gone/c.md"].iter().all(|w| got.iter().any(|g| g == w)), "{got:?}");
        assert!(got.iter().all(|g| !g.contains(".git") && !g.contains(TEMP_SUFFIX)), "{got:?}");
        assert_eq!(got.iter().filter(|g| *g == "add a.md").count(), 0, "{got:?}");
        remove_tree(&format!("{root}/gone")).unwrap();
        let got = until(&["unlink gone/c.md"]);
        assert!(got.contains(&"unlink gone/c.md".to_string()), "{got:?}");
        drop(w);
        std::thread::sleep(Duration::from_millis(100));
        let before = events.lock().unwrap().len();
        write(&format!("{root}/c.md"), b"c").unwrap();
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(events.lock().unwrap().len(), before);
    }
}
