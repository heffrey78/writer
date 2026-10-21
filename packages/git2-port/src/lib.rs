//! Writer's git port over libgit2 (D16): the operations the server needs (packages/server/src/git-port/
//! port.ts says what each does), for Android, where there's no git binary, and for the contract suite
//! on the desktop. `call` answers one request, `{ ok }` or `{ err: { code, message } }`; the stdio binary
//! (src/main.rs) and the Android app's Tauri command wrap it.
//!
//! A request's `dir` is a book's folder: the repository's top, or a folder in it. Paths given and
//! returned are relative to it, and listing, staging and committing keep to it, except the in-memory
//! merge's, which are the repository's.

use base64::{Engine, engine::general_purpose::STANDARD as B64};
use foreign_types::ForeignType;
use git2::build::CheckoutBuilder;
use git2::{
    AnnotatedCommit, BranchType, Cred, Delta, DiffFindOptions, DiffOptions, ErrorClass, ErrorCode, FetchOptions, FetchPrune, Index, IndexEntry, IndexTime, MergeOptions, ObjectType, Oid,
    PushOptions, RebaseOptions, RemoteCallbacks, Repository, RepositoryInitOptions, RepositoryState, Signature, Sort, Status, StatusOptions, Time, Tree,
};
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::Path;
use std::sync::Mutex;

/// A failure with one of the server's GitFailure codes, so the UI can say what to do.
pub struct Failure {
    pub code: &'static str,
    pub message: String,
}

type R<T> = Result<T, Failure>;

fn fail(code: &'static str, message: impl Into<String>) -> Failure {
    Failure { code, message: message.into() }
}

impl From<git2::Error> for Failure {
    fn from(e: git2::Error) -> Self {
        classify(&e, "")
    }
}

impl From<std::io::Error> for Failure {
    fn from(e: std::io::Error) -> Self {
        fail("GIT", e.to_string())
    }
}

/// libgit2's errors in the server's codes. `remote` is what the remote said (its sideband and refusals).
fn classify(e: &git2::Error, remote: &str) -> Failure {
    let text = format!("{}{}{}", e.message(), if remote.is_empty() { "" } else { "\n" }, remote);
    let lower = text.to_lowercase();
    let code = if lower.contains("workflow") && lower.contains("scope") {
        "SCOPE"
    } else if e.code() == ErrorCode::Auth || lower.contains("401") || lower.contains("403") || lower.contains("authentication") {
        "AUTH"
    } else if lower.contains("404") || (lower.contains("not found") && e.class() == ErrorClass::Http) {
        "NOT_FOUND"
    } else if e.code() == ErrorCode::NotFastForward || lower.contains("non-fastforward") || lower.contains("[rejected]") {
        "REJECTED"
    } else if matches!(e.class(), ErrorClass::Net | ErrorClass::Os | ErrorClass::Http | ErrorClass::Ssl) && (lower.contains("connect") || lower.contains("resolve") || lower.contains("timed out")) {
        "NETWORK"
    } else if e.code() == ErrorCode::Exists {
        "DESTINATION_EXISTS"
    } else {
        "GIT"
    };
    fail(code, text)
}

/// A time as git's %cI prints it: the offset it was recorded with, "Z" for UTC.
fn iso(t: Time) -> String {
    let offset = t.offset_minutes() as i64;
    let local = t.seconds() + offset * 60;
    let (days, secs) = (local.div_euclid(86_400), local.rem_euclid(86_400));
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    let zone = if offset == 0 { "Z".to_string() } else { format!("{}{:02}:{:02}", if offset < 0 { '-' } else { '+' }, offset.abs() / 60, offset.abs() % 60) };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}{zone}", secs / 3600, secs % 3600 / 60, secs % 60)
}

fn s<'a>(args: &'a Value, key: &str) -> R<&'a str> {
    args.get(key).and_then(Value::as_str).ok_or_else(|| fail("GIT", format!("missing argument {key}")))
}

fn opt<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(Value::as_str)
}

fn strs(args: &Value, key: &str) -> Vec<String> {
    args.get(key).and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default()
}

/// A book's folder in its repository: the repository, and the folder's path in it ("" or "a/b/").
struct Book {
    repo: Repository,
    prefix: String,
}

impl Book {
    fn open(dir: &str) -> R<Book> {
        let repo = Repository::discover(dir).map_err(|e| fail("GIT", e.message().to_string()))?;
        let prefix = match repo.workdir() {
            Some(top) => {
                let top = std::fs::canonicalize(top)?;
                let here = std::fs::canonicalize(dir)?;
                let rel = here.strip_prefix(&top).map_err(|_| fail("GIT", format!("{dir} isn't in its repository")))?;
                let rel = rel.to_string_lossy().replace('\\', "/");
                if rel.is_empty() { String::new() } else { format!("{rel}/") }
            }
            None => String::new(),
        };
        Ok(Book { repo, prefix })
    }

    /// A path from the folder ("." for all of it, "../" to reach outside it) as the repository's.
    fn repo_path(&self, path: &str) -> String {
        let mut parts: Vec<&str> = self.prefix.split('/').filter(|p| !p.is_empty()).collect();
        for part in path.split('/') {
            match part {
                "" | "." => {}
                ".." => {
                    parts.pop();
                }
                p => parts.push(p),
            }
        }
        parts.join("/")
    }

    /// A repository path as the folder's, if it's in it.
    fn local<'a>(&self, path: &'a str) -> Option<&'a str> {
        path.strip_prefix(self.prefix.as_str())
    }

    /// A repository path as the folder reaches it: inside it, or by "../" outside it.
    fn relative(&self, path: &str) -> String {
        match self.local(path) {
            Some(local) => local.to_string(),
            None => format!("{}{path}", "../".repeat(self.prefix.split('/').filter(|p| !p.is_empty()).count())),
        }
    }
}

/// Which files an operation covers: `paths` in the folder (all of it by default), less what matches `exclude`.
struct Scope {
    paths: Vec<String>,
    exclude: Vec<String>,
}

impl Scope {
    fn of(args: &Value) -> Scope {
        let scope = args.get("scope").cloned().unwrap_or(Value::Null);
        Scope { paths: strs(&scope, "paths"), exclude: strs(&scope, "exclude") }
    }

    /// Whether a path of the folder's is in the scope.
    fn holds(&self, local: &str) -> bool {
        let inside = self.paths.is_empty() || self.paths.iter().any(|p| p == "." || local == p || local.starts_with(&format!("{}/", p.trim_end_matches('/'))));
        inside && !self.exclude.iter().any(|g| glob(g, local))
    }
}

/// A pathspec glob as git matches one: `**` any number of folders, `*` and `?` within a name.
fn glob(pattern: &str, path: &str) -> bool {
    fn segments(p: &[&str], s: &[&str]) -> bool {
        match (p.first(), s.first()) {
            (None, None) => true,
            (Some(&"**"), _) => segments(&p[1..], s) || (!s.is_empty() && segments(p, &s[1..])),
            (Some(pat), Some(name)) => name_matches(pat.as_bytes(), name.as_bytes()) && segments(&p[1..], &s[1..]),
            _ => false,
        }
    }
    fn name_matches(p: &[u8], s: &[u8]) -> bool {
        match (p.first(), s.first()) {
            (None, None) => true,
            (Some(b'*'), _) => name_matches(&p[1..], s) || (!s.is_empty() && name_matches(p, &s[1..])),
            (Some(b'?'), Some(_)) => name_matches(&p[1..], &s[1..]),
            (Some(a), Some(b)) => a == b && name_matches(&p[1..], &s[1..]),
            _ => false,
        }
    }
    segments(&pattern.split('/').collect::<Vec<_>>(), &path.split('/').collect::<Vec<_>>())
}

fn commit_of<'r>(repo: &'r Repository, rev: &str) -> Option<git2::Commit<'r>> {
    repo.revparse_single(rev).ok()?.peel_to_commit().ok()
}

fn head_commit(repo: &Repository) -> Option<git2::Commit<'_>> {
    repo.head().ok()?.peel_to_commit().ok()
}

fn signature(repo: &Repository) -> R<Signature<'static>> {
    repo.signature().map_err(|e| fail("GIT", format!("No name and email for commits: {}", e.message())))
}

/// A message as `git commit -m` and `git tag -m` leave it: trailing spaces and blank lines gone, one final newline.
fn cleaned(message: &str) -> R<String> {
    Ok(git2::message_prettify(message, None)?)
}

/// Requests cancelled by `cancel`, by their `cancel` token: their transfers stop at the next progress report.
static CANCELLED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// Stop the request that carries `token` as its `cancel` argument.
pub fn cancel(token: &str) {
    CANCELLED.lock().unwrap().get_or_insert_with(HashSet::new).insert(token.to_string());
}

fn cancelled(token: Option<&str>) -> bool {
    token.is_some_and(|t| CANCELLED.lock().unwrap().as_ref().is_some_and(|set| set.contains(t)))
}

/// Credentials for one command, the remote's words kept for errors, progress reported, and cancelling.
fn callbacks<'a>(args: &Value, said: &'a RefCell<String>, progress: &'a mut dyn FnMut(Value)) -> RemoteCallbacks<'a> {
    let token = opt(args, "token").map(String::from);
    let cancel_token = opt(args, "cancel").map(String::from);
    let mut cb = RemoteCallbacks::new();
    let mut offered = false;
    // Writer's token as x-access-token, offered once (then it's AUTH, not a loop).
    cb.credentials(move |_url, _user, _allowed| match (&token, offered) {
        (Some(token), false) => {
            offered = true;
            Cred::userpass_plaintext("x-access-token", token)
        }
        _ => Err(git2::Error::new(ErrorCode::Auth, ErrorClass::Http, "authentication required: no credentials, or GitHub refused them")),
    });
    cb.sideband_progress(move |bytes| {
        said.borrow_mut().push_str(&format!("remote: {}", String::from_utf8_lossy(bytes)));
        true
    });
    cb.transfer_progress(move |p| {
        let total = p.total_objects();
        progress(json!({ "stage": "receiving", "progress": if total > 0 { p.received_objects() * 100 / total } else { 0 }, "processed": p.received_objects(), "total": total }));
        !cancelled(cancel_token.as_deref())
    });
    cb
}

fn checkout_safe() -> CheckoutBuilder<'static> {
    let mut c = CheckoutBuilder::new();
    c.safe();
    c
}

fn entry_json(path: &str, mode: i32, oid: Oid) -> Value {
    json!({ "path": path, "mode": format!("{mode:o}"), "oid": oid.to_string() })
}

/// Every blob under `tree`, with its path from `prefix`.
fn walk(repo: &Repository, tree: &Tree, prefix: &str, out: &mut Vec<Value>) -> R<()> {
    for e in tree.iter() {
        let name = e.name().unwrap_or("");
        let path = if prefix.is_empty() { name.to_string() } else { format!("{prefix}/{name}") };
        match e.kind() {
            Some(ObjectType::Tree) => walk(repo, &repo.find_tree(e.id())?, &path, out)?,
            _ => out.push(entry_json(&path, e.filemode(), e.id())),
        }
    }
    Ok(())
}

fn index_entry(path: &str, oid: Oid, mode: u32, size: u32) -> IndexEntry {
    IndexEntry {
        ctime: IndexTime::new(0, 0),
        mtime: IndexTime::new(0, 0),
        dev: 0,
        ino: 0,
        mode,
        uid: 0,
        gid: 0,
        file_size: size,
        id: oid,
        flags: path.len().min(0xfff) as u16,
        flags_extended: 0,
        path: path.as_bytes().to_vec(),
    }
}

fn diff_status(d: Delta) -> &'static str {
    match d {
        Delta::Added => "A",
        Delta::Deleted => "D",
        Delta::Modified => "M",
        Delta::Renamed => "R",
        Delta::Copied => "C",
        Delta::Typechange => "T",
        _ => "?",
    }
}

fn renames() -> DiffFindOptions {
    let mut f = DiffFindOptions::new();
    f.renames(true);
    f
}

/// The changes a diff holds in the folder and scope, as `--raw -M --relative` lists them.
fn changes(book: &Book, diff: &git2::Diff, scope: &Scope) -> Vec<Value> {
    let path_of = |f: git2::DiffFile| f.path().map(|p| p.to_string_lossy().replace('\\', "/"));
    let mut out = vec![];
    for d in diff.deltas() {
        let Some(repo_path) = path_of(d.new_file()).or_else(|| path_of(d.old_file())) else { continue };
        let Some(path) = book.local(&repo_path) else { continue };
        if !scope.holds(path) {
            continue;
        }
        let mut v = json!({ "status": diff_status(d.status()), "path": path, "old": d.old_file().id().to_string(), "new": d.new_file().id().to_string() });
        if matches!(d.status(), Delta::Renamed | Delta::Copied) {
            v["from"] = json!(path_of(d.old_file()).map(|p| book.local(&p).map(String::from).unwrap_or(p)));
        }
        out.push(v);
    }
    out
}

/// Diff options limited to a scope's paths in the folder, as git's pathspec limits a diff: before renames
/// are found, so a file moved in from outside the paths is added there, not renamed.
fn limited(book: &Book, scope: &Scope) -> DiffOptions {
    let mut o = DiffOptions::new();
    o.ignore_submodules(true);
    let paths: Vec<String> = if scope.paths.is_empty() { vec![book.repo_path(".")] } else { scope.paths.iter().map(|p| book.repo_path(p)).collect() };
    for p in paths.into_iter().filter(|p| !p.is_empty()) {
        o.pathspec(p);
    }
    o
}

fn tree_diff<'r>(book: &'r Book, commit: &git2::Commit<'r>, scope: &Scope) -> R<git2::Diff<'r>> {
    let parent = if commit.parent_count() > 0 { Some(commit.parent(0)?.tree()?) } else { None };
    let mut diff = book.repo.diff_tree_to_tree(parent.as_ref(), Some(&commit.tree()?), Some(&mut limited(book, scope)))?;
    diff.find_similar(Some(&mut renames()))?;
    Ok(diff)
}

/// Whether `path` (a file or a folder) is the same in `a` and `b`: git log's TREESAME.
fn same_at(a: &Tree, b: Option<&Tree>, path: &str) -> bool {
    let id = |t: &Tree| if path.is_empty() { Some(t.id()) } else { t.get_path(Path::new(path)).ok().map(|e| e.id()) };
    match b {
        Some(b) => id(a) == id(b),
        None => id(a).is_none(),
    }
}

/// What's staged in the scope, applied to HEAD's tree: `git commit -- <scope>`'s tree.
fn scoped_tree(book: &Book, scope: &Scope) -> R<Oid> {
    let repo = &book.repo;
    let mut staged = repo.index()?;
    if book.prefix.is_empty() && scope.paths.is_empty() {
        return Ok(staged.write_tree()?);
    }
    let mut index = Index::new()?;
    if let Some(head) = head_commit(repo) {
        index.read_tree(&head.tree()?)?;
    }
    let held = |p: &str| book.local(p).is_some_and(|l| scope.holds(l));
    let before: Vec<String> = index.iter().map(|e| String::from_utf8_lossy(&e.path).to_string()).filter(|p| held(p)).collect();
    for p in before {
        index.remove_path(Path::new(&p))?;
    }
    for e in staged.iter() {
        if held(&String::from_utf8_lossy(&e.path)) {
            index.add(&e)?;
        }
    }
    Ok(index.write_tree_to(repo)?)
}

fn fast_forward(repo: &Repository, rev: &str) -> R<Value> {
    let target = commit_of(repo, rev).ok_or_else(|| fail("GIT", format!("no commit {rev}")))?;
    let head = head_commit(repo);
    if let Some(h) = &head {
        if h.id() == target.id() || repo.graph_descendant_of(h.id(), target.id())? {
            return Ok(json!(null));
        }
        if !repo.graph_descendant_of(target.id(), h.id())? {
            return Err(fail("NOT_FAST_FORWARD", "Not possible to fast-forward"));
        }
    }
    // Like git merge --ff-only: the work tree follows, and a local change it would overwrite stops it.
    repo.checkout_tree(target.as_object(), Some(&mut checkout_safe()))?;
    match repo.head() {
        Ok(mut r) if r.is_branch() => {
            r.set_target(target.id(), "fast-forward")?;
        }
        _ => {
            let name = repo.find_reference("HEAD")?.symbolic_target()?.map(String::from).ok_or_else(|| fail("GIT", "HEAD is detached"))?;
            repo.reference(&name, target.id(), true, "fast-forward")?;
        }
    }
    Ok(json!(null))
}

/// The paths an index's conflicts name.
fn conflict_paths(index: &Index) -> R<BTreeSet<String>> {
    let mut paths = BTreeSet::new();
    for c in index.conflicts()? {
        let c = c?;
        for e in [&c.ancestor, &c.our, &c.their].into_iter().flatten() {
            paths.insert(String::from_utf8_lossy(&e.path).to_string());
        }
    }
    Ok(paths)
}

/// libgit2 pushes no wildcards ("refs/tags/checkpoint/*:refs/tags/checkpoint/*"): each matching ref is named, as git does.
fn expand_refspecs(repo: &Repository, specs: &[String]) -> R<Vec<String>> {
    let mut out = vec![];
    for spec in specs {
        let (force, body) = spec.strip_prefix('+').map_or(("", spec.as_str()), |b| ("+", b));
        let (src, dst) = body.split_once(':').unwrap_or((body, body));
        match (src.split_once('*'), dst.split_once('*')) {
            (Some((sp, ss)), Some((dp, ds))) => {
                for r in repo.references()? {
                    let r = r?;
                    let Ok(n) = r.name() else { continue };
                    if let Some(mid) = n.strip_prefix(sp).and_then(|m| m.strip_suffix(ss)) {
                        out.push(format!("{force}{n}:{dp}{mid}{ds}"));
                    }
                }
            }
            _ => out.push(spec.clone()),
        }
    }
    Ok(out)
}

fn op(name: &str, dir: &str, a: &Value, progress: &mut dyn FnMut(Value)) -> R<Value> {
    match name {
        "version" => {
            let (maj, min, rev) = git2::Version::get().libgit2_version();
            Ok(json!(format!("libgit2 {maj}.{min}.{rev}")))
        }
        "init" => {
            let mut o = RepositoryInitOptions::new();
            o.initial_head(s(a, "branch")?);
            // A bare one: a remote on the same device, for a test where there's no other.
            o.bare(a.get("bare").and_then(Value::as_bool) == Some(true));
            Repository::init_opts(dir, &o)?;
            Ok(json!(null))
        }
        "isRepo" => Ok(json!(Repository::discover(dir).is_ok())),
        "clone" => {
            let dest = Path::new(dir);
            if dest.exists() && dest.read_dir()?.next().is_some() {
                return Err(fail("DESTINATION_EXISTS", format!("destination path '{dir}' already exists and is not an empty directory")));
            }
            let said = RefCell::new(String::new());
            let mut fo = FetchOptions::new();
            fo.remote_callbacks(callbacks(a, &said, progress));
            git2::build::RepoBuilder::new().fetch_options(fo).clone(s(a, "url")?, dest).map_err(|e| classify(&e, &said.borrow()))?;
            Ok(json!(null))
        }
        "gitDir" => {
            let book = Book::open(dir)?;
            Ok(json!(book.repo.path().to_string_lossy().trim_end_matches('/')))
        }
        "prefix" => Ok(json!(Book::open(dir)?.prefix)),
        "inProgress" => {
            let book = Book::open(dir)?;
            Ok(json!(book.repo.state() != RepositoryState::Clean || book.repo.index()?.has_conflicts()))
        }
        "resolve" => {
            let book = Book::open(dir)?;
            Ok(json!(commit_of(&book.repo, s(a, "rev")?).map(|c| c.id().to_string())))
        }
        "currentBranch" => {
            let book = Book::open(dir)?;
            let head = book.repo.find_reference("HEAD")?;
            Ok(json!(head.symbolic_target()?.and_then(|t| t.strip_prefix("refs/heads/")).map(String::from)))
        }
        "refs" => {
            let book = Book::open(dir)?;
            let prefixes = strs(a, "prefixes");
            let mut out = vec![];
            for r in book.repo.references()? {
                let r = r?;
                let Ok(name) = r.name().map(String::from) else { continue };
                if !prefixes.iter().any(|p| name.starts_with(p.as_str())) {
                    continue;
                }
                let symref = r.symbolic_target()?.map(String::from);
                let resolved = r.resolve()?;
                let oid = resolved.target();
                let date = oid.and_then(|o| book.repo.find_commit(o).ok()).map(|c| iso(c.committer().when()));
                out.push(json!({ "name": name, "oid": oid.map(|o| o.to_string()), "date": date, "symref": symref }));
            }
            out.sort_by(|x, y| x["name"].as_str().cmp(&y["name"].as_str()));
            Ok(json!(out))
        }
        "tags" => {
            let book = Book::open(dir)?;
            let repo = &book.repo;
            let prefix = opt(a, "prefix").unwrap_or("");
            let mut out = vec![];
            for name in repo.tag_names(None)?.iter().filter_map(|n| n.ok().flatten()) {
                if !name.starts_with(prefix) {
                    continue;
                }
                let r = repo.find_reference(&format!("refs/tags/{name}"))?;
                let obj = repo.find_object(r.target().ok_or_else(|| fail("GIT", "symbolic tag"))?, None)?;
                let target = r.peel_to_commit()?;
                match obj.as_tag() {
                    Some(tag) => out.push(json!({
                        "name": name, "commit": target.id().to_string(), "annotated": true,
                        "date": tag.tagger().map(|t| iso(t.when())), "message": tag.message()?.unwrap_or(""),
                    })),
                    None => out.push(json!({ "name": name, "commit": target.id().to_string(), "annotated": false, "date": iso(target.committer().when()), "message": "" })),
                }
            }
            out.sort_by(|x, y| x["name"].as_str().cmp(&y["name"].as_str()));
            Ok(json!(out))
        }
        "tag" => {
            let book = Book::open(dir)?;
            let at = commit_of(&book.repo, opt(a, "rev").unwrap_or("HEAD")).ok_or_else(|| fail("GIT", "no commit to tag"))?;
            book.repo.tag(s(a, "name")?, at.as_object(), &signature(&book.repo)?, &cleaned(s(a, "message")?)?, false)?;
            Ok(json!(null))
        }
        "createBranch" => {
            let book = Book::open(dir)?;
            let repo = &book.repo;
            let name = s(a, "name")?;
            let start = s(a, "start")?;
            let track = a.get("track").and_then(Value::as_bool) == Some(true);
            let from = if track { commit_of(repo, &format!("refs/remotes/{start}")) } else { commit_of(repo, start) }.ok_or_else(|| fail("GIT", format!("no start point {start}")))?;
            let mut branch = repo.branch(name, &from, false)?;
            if track {
                branch.set_upstream(Some(start))?;
            }
            repo.checkout_tree(from.as_object(), Some(&mut checkout_safe()))?;
            repo.set_head(&format!("refs/heads/{name}"))?;
            Ok(json!(null))
        }
        "switchBranch" => {
            let book = Book::open(dir)?;
            let name = s(a, "name")?;
            let target = commit_of(&book.repo, &format!("refs/heads/{name}")).ok_or_else(|| fail("GIT", format!("no branch {name}")))?;
            book.repo.checkout_tree(target.as_object(), Some(&mut checkout_safe()))?;
            book.repo.set_head(&format!("refs/heads/{name}"))?;
            Ok(json!(null))
        }
        "deleteBranch" => {
            let book = Book::open(dir)?;
            book.repo.find_branch(s(a, "name")?, BranchType::Local)?.delete()?;
            Ok(json!(null))
        }
        "ancestors" => {
            let book = Book::open(dir)?;
            let mut walk = book.repo.revwalk()?;
            walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
            walk.push(commit_of(&book.repo, s(a, "rev")?).ok_or_else(|| fail("GIT", "no such revision"))?.id())?;
            Ok(json!(walk.filter_map(|o| o.ok().map(|o| o.to_string())).collect::<Vec<_>>()))
        }
        "getConfig" => {
            let config = if dir.is_empty() { git2::Config::open_default()? } else { Book::open(dir)?.repo.config()? };
            Ok(json!(config.get_string(s(a, "key")?).ok()))
        }
        "setConfig" => {
            let level = if dir.is_empty() { git2::ConfigLevel::Global } else { git2::ConfigLevel::Local };
            let config = if dir.is_empty() { git2::Config::open_default()? } else { Book::open(dir)?.repo.config()? };
            config.open_level(level)?.set_str(s(a, "key")?, s(a, "value")?)?;
            Ok(json!(null))
        }
        "listConfig" => {
            let config = Book::open(dir)?.repo.config()?;
            let mut out = vec![];
            let mut entries = config.entries(None)?;
            while let Some(e) = entries.next() {
                let e = e?;
                out.push(json!([e.name().unwrap_or(""), e.value().unwrap_or("")]));
            }
            Ok(json!(out))
        }
        "remoteUrl" => {
            let book = Book::open(dir)?;
            Ok(json!(book.repo.find_remote(s(a, "name")?).ok().and_then(|r| r.url().ok().map(String::from))))
        }
        "addRemote" => {
            Book::open(dir)?.repo.remote(s(a, "name")?, s(a, "url")?)?;
            Ok(json!(null))
        }
        "status" => {
            let book = Book::open(dir)?;
            let scope = Scope::of(a);
            let mut o = StatusOptions::new();
            o.include_untracked(true).recurse_untracked_dirs(true).renames_head_to_index(true).include_ignored(false);
            let mut out = vec![];
            for e in book.repo.statuses(Some(&mut o))?.iter() {
                let st = e.status();
                let x = if st.contains(Status::WT_NEW) && !st.intersects(Status::INDEX_NEW | Status::INDEX_MODIFIED) {
                    "?"
                } else if st.contains(Status::CONFLICTED) {
                    "U"
                } else if st.contains(Status::INDEX_NEW) {
                    "A"
                } else if st.contains(Status::INDEX_RENAMED) {
                    "R"
                } else if st.contains(Status::INDEX_DELETED) {
                    "D"
                } else if st.contains(Status::INDEX_MODIFIED) {
                    "M"
                } else if st.contains(Status::INDEX_TYPECHANGE) {
                    "T"
                } else {
                    " "
                };
                let y = if x == "?" {
                    "?"
                } else if st.contains(Status::CONFLICTED) {
                    "U"
                } else if st.contains(Status::WT_DELETED) {
                    "D"
                } else if st.contains(Status::WT_MODIFIED) {
                    "M"
                } else if st.contains(Status::WT_TYPECHANGE) {
                    "T"
                } else {
                    " "
                };
                let renamed = e.head_to_index().filter(|d| d.status() == Delta::Renamed);
                let repo_path = renamed.as_ref().and_then(|d| d.new_file().path()).map(|p| p.to_string_lossy().to_string()).or(e.path().ok().map(String::from)).unwrap_or_default();
                let Some(path) = book.local(&repo_path).map(String::from) else { continue };
                if !scope.holds(&path) {
                    continue;
                }
                let mut v = json!({ "path": path, "x": x, "y": y });
                if let Some(d) = renamed {
                    v["from"] = json!(d.old_file().path().map(|p| { let p = p.to_string_lossy().to_string(); book.local(&p).map(String::from).unwrap_or(p) }));
                }
                out.push(v);
            }
            out.sort_by(|p, q| p["path"].as_str().cmp(&q["path"].as_str()));
            Ok(json!(out))
        }
        "stage" => {
            // git add -A: new and changed files, and deleted ones gone from the index.
            let book = Book::open(dir)?;
            let scope = Scope::of(a);
            let mut index = book.repo.index()?;
            let spec = vec![if book.prefix.is_empty() { "*".to_string() } else { format!("{}*", book.prefix) }];
            let mut skip = |p: &Path, _: &[u8]| -> i32 {
                let p = p.to_string_lossy().replace('\\', "/");
                if book.local(&p).is_some_and(|l| scope.holds(l)) { 0 } else { 1 }
            };
            index.add_all(spec.iter(), git2::IndexAddOption::DEFAULT, Some(&mut skip))?;
            index.update_all(spec.iter(), Some(&mut skip))?;
            index.write()?;
            Ok(json!(null))
        }
        "remove" => {
            let book = Book::open(dir)?;
            let top = book.repo.workdir().ok_or_else(|| fail("GIT", "no work tree"))?.to_path_buf();
            let mut index = book.repo.index()?;
            for p in strs(a, "paths") {
                let repo_path = book.repo_path(&p);
                let full = top.join(&repo_path);
                if full.is_dir() {
                    index.remove_dir(Path::new(&repo_path), 0)?;
                    std::fs::remove_dir_all(&full)?;
                } else {
                    index.remove_path(Path::new(&repo_path))?;
                    if full.exists() {
                        std::fs::remove_file(&full)?;
                    }
                }
            }
            index.write()?;
            Ok(json!(null))
        }
        "listFiles" => {
            let book = Book::open(dir)?;
            let scope = Scope { paths: strs(a, "paths"), exclude: vec![] };
            let index = book.repo.index()?;
            let out: Vec<String> = index.iter().filter_map(|e| book.local(&String::from_utf8_lossy(&e.path)).map(String::from)).filter(|l| scope.holds(l)).collect();
            Ok(json!(out))
        }
        "stagedChanges" => {
            let book = Book::open(dir)?;
            let head = head_commit(&book.repo).map(|c| c.tree()).transpose()?;
            let scope = Scope::of(a);
            let mut diff = book.repo.diff_tree_to_index(head.as_ref(), Some(&book.repo.index()?), Some(&mut limited(&book, &scope)))?;
            diff.find_similar(Some(&mut renames()))?;
            Ok(json!(changes(&book, &diff, &scope)))
        }
        "commit" => {
            // What's staged in the scope, on HEAD, and no hooks (libgit2 runs none); null if nothing changed.
            let book = Book::open(dir)?;
            let repo = &book.repo;
            let tree_id = scoped_tree(&book, &Scope::of(a))?;
            let head = head_commit(repo);
            if head.as_ref().is_some_and(|h| h.tree_id() == tree_id) || (head.is_none() && repo.find_tree(tree_id)?.is_empty()) {
                return Ok(json!(null));
            }
            let sig = signature(repo)?;
            let parents: Vec<git2::Commit> = head.into_iter().collect();
            let refs: Vec<&git2::Commit> = parents.iter().collect();
            Ok(json!(repo.commit(Some("HEAD"), &sig, &sig, &cleaned(s(a, "message")?)?, &repo.find_tree(tree_id)?, &refs)?.to_string()))
        }
        "amend" => {
            // git commit --amend --no-edit: its message and author kept, a new committer and tree.
            let book = Book::open(dir)?;
            let repo = &book.repo;
            let tree = repo.find_tree(repo.index()?.write_tree()?)?;
            let head = head_commit(repo).ok_or_else(|| fail("GIT", "nothing to amend"))?;
            Ok(json!(head.amend(Some("HEAD"), None, Some(&signature(repo)?), None, None, Some(&tree))?.to_string()))
        }
        "commitInfo" => {
            let book = Book::open(dir)?;
            let c = commit_of(&book.repo, s(a, "rev")?).ok_or_else(|| fail("GIT", "no such commit"))?;
            Ok(json!({
                "oid": c.id().to_string(), "tree": c.tree_id().to_string(), "parents": c.parent_ids().map(|p| p.to_string()).collect::<Vec<_>>(),
                "message": c.message().unwrap_or(""), "author": { "name": c.author().name().ok(), "email": c.author().email().ok() },
                "authored": iso(c.author().when()), "committed": iso(c.committer().when()),
            }))
        }
        "restore" => {
            // git restore --source=<rev> --staged --worktree -- <paths>: what the source has comes back,
            // and what it hasn't is removed, from the index and the work tree.
            let book = Book::open(dir)?;
            let repo = &book.repo;
            let top = repo.workdir().ok_or_else(|| fail("GIT", "no work tree"))?.to_path_buf();
            let source = commit_of(repo, s(a, "rev")?).ok_or_else(|| fail("GIT", "no such source"))?.tree()?;
            let mut index = repo.index()?;
            for p in strs(a, "paths") {
                let p = book.repo_path(&p);
                let mut wanted = vec![];
                match source.get_path(Path::new(&p)) {
                    Ok(e) if e.kind() == Some(ObjectType::Tree) => walk(repo, &repo.find_tree(e.id())?, &p, &mut wanted)?,
                    Ok(e) => wanted.push(entry_json(&p, e.filemode(), e.id())),
                    Err(_) => {}
                }
                let keep: BTreeSet<String> = wanted.iter().filter_map(|w| w["path"].as_str().map(String::from)).collect();
                let present: Vec<String> = index.iter().map(|e| String::from_utf8_lossy(&e.path).to_string()).filter(|q| q == &p || q.starts_with(&format!("{p}/"))).collect();
                for q in present.iter().filter(|q| !keep.contains(*q)) {
                    index.remove_path(Path::new(q))?;
                    let _ = std::fs::remove_file(top.join(q));
                }
                for w in &wanted {
                    let path = w["path"].as_str().unwrap_or("");
                    let blob = repo.find_blob(Oid::from_str(w["oid"].as_str().unwrap_or(""))?)?;
                    let full = top.join(path);
                    if let Some(parent) = full.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    std::fs::write(&full, blob.content())?;
                    index.add_path(Path::new(path))?;
                }
            }
            index.write()?;
            Ok(json!(null))
        }
        "fastForward" => fast_forward(&Book::open(dir)?.repo, s(a, "rev")?),
        "log" => {
            let book = Book::open(dir)?;
            let repo = &book.repo;
            let mut walk = repo.revwalk()?;
            // Newest first, parents after children even within a second, as git log keeps them.
            walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
            match commit_of(repo, opt(a, "rev").unwrap_or("HEAD")) {
                Some(c) => walk.push(c.id())?,
                None => return Ok(json!([])),
            }
            let path = opt(a, "path").map(|p| book.repo_path(p));
            let limit = a.get("limit").and_then(Value::as_u64).unwrap_or(u64::MAX) as usize;
            let mut out = vec![];
            for id in walk {
                let c = repo.find_commit(id?)?;
                if let Some(p) = &path {
                    let tree = c.tree()?;
                    let parents: Vec<Tree> = c.parents().map(|q| q.tree()).collect::<Result<_, _>>()?;
                    // Like git log -- <path>: a commit that left it as one of its parents had it isn't listed.
                    let same = if parents.is_empty() { same_at(&tree, None, p) } else { parents.iter().any(|q| same_at(&tree, Some(q), p)) };
                    if same {
                        continue;
                    }
                }
                out.push(json!({
                    "oid": c.id().to_string(), "parents": c.parent_ids().map(|p| p.to_string()).collect::<Vec<_>>(),
                    "committed": iso(c.committer().when()), "authored": iso(c.author().when()), "summary": c.summary().ok().flatten().unwrap_or(""),
                }));
                if out.len() >= limit {
                    break;
                }
            }
            Ok(json!(out))
        }
        "history" => {
            // git log --reverse --no-merges --root -M --raw --relative -- <path>: each commit's changes, oldest first.
            let book = Book::open(dir)?;
            let repo = &book.repo;
            let scope = Scope { paths: opt(a, "path").map(|p| vec![p.to_string()]).unwrap_or_default(), exclude: vec![] };
            let mut walk = repo.revwalk()?;
            walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME | Sort::REVERSE)?;
            if head_commit(repo).is_none() {
                return Ok(json!([]));
            }
            walk.push_head()?;
            let mut out = vec![];
            for id in walk {
                let c = repo.find_commit(id?)?;
                if c.parent_count() > 1 {
                    continue;
                }
                let files = changes(&book, &tree_diff(&book, &c, &scope)?, &scope);
                if !files.is_empty() {
                    out.push(json!({ "oid": c.id().to_string(), "authored": iso(c.author().when()), "files": files }));
                }
            }
            Ok(json!(out))
        }
        "deletions" => {
            // git log --diff-filter=D --name-only -n <limit> -- <path>: newest first.
            let book = Book::open(dir)?;
            let repo = &book.repo;
            let scope = Scope { paths: vec![s(a, "path")?.to_string()], exclude: vec![] };
            let limit = a.get("limit").and_then(Value::as_u64).unwrap_or(200) as usize;
            let mut walk = repo.revwalk()?;
            walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
            if head_commit(repo).is_none() {
                return Ok(json!([]));
            }
            walk.push_head()?;
            let mut out = vec![];
            for id in walk {
                let c = repo.find_commit(id?)?;
                if c.parent_count() > 1 {
                    continue;
                }
                let files: Vec<Value> = changes(&book, &tree_diff(&book, &c, &scope)?, &scope).into_iter().filter(|f| f["status"] == "D").map(|f| f["path"].clone()).collect();
                if !files.is_empty() {
                    out.push(json!({ "oid": c.id().to_string(), "committed": iso(c.committer().when()), "files": files }));
                    if out.len() >= limit {
                        break;
                    }
                }
            }
            Ok(json!(out))
        }
        "readFile" => {
            let book = Book::open(dir)?;
            let Some(c) = commit_of(&book.repo, s(a, "rev")?) else { return Ok(json!(null)) };
            let Ok(e) = c.tree()?.get_path(Path::new(&book.repo_path(s(a, "path")?))) else { return Ok(json!(null)) };
            Ok(json!(book.repo.find_blob(e.id()).ok().map(|b| B64.encode(b.content()))))
        }
        "listTree" => {
            let book = Book::open(dir)?;
            let tree = commit_of(&book.repo, s(a, "rev")?).ok_or_else(|| fail("GIT", "no such revision"))?.tree()?;
            let at = book.repo_path(opt(a, "path").unwrap_or("."));
            let mut out = vec![];
            if at.is_empty() {
                walk(&book.repo, &tree, "", &mut out)?;
            } else {
                match tree.get_path(Path::new(&at)) {
                    Ok(e) if e.kind() == Some(ObjectType::Tree) => walk(&book.repo, &book.repo.find_tree(e.id())?, &at, &mut out)?,
                    Ok(e) => out.push(entry_json(&at, e.filemode(), e.id())),
                    Err(_) => {}
                }
            }
            let out: Vec<Value> = out
                .into_iter()
                .map(|mut e| {
                    let path = book.relative(e["path"].as_str().unwrap_or(""));
                    e["path"] = json!(path);
                    e
                })
                .collect();
            Ok(json!(out))
        }
        "readBlobs" => {
            let book = Book::open(dir)?;
            let mut out = BTreeMap::new();
            for oid in strs(a, "oids") {
                if let Ok(b) = book.repo.find_blob(Oid::from_str(&oid)?) {
                    out.insert(oid, B64.encode(b.content()));
                }
            }
            Ok(json!(out))
        }
        "count" => {
            let book = Book::open(dir)?;
            let mut walk = book.repo.revwalk()?;
            walk.push(commit_of(&book.repo, s(a, "rev")?).ok_or_else(|| fail("GIT", "no such revision"))?.id())?;
            Ok(json!(walk.count()))
        }
        "aheadBehind" => {
            let book = Book::open(dir)?;
            let (x, y) = (commit_of(&book.repo, s(a, "a")?), commit_of(&book.repo, s(a, "b")?));
            let (Some(x), Some(y)) = (x, y) else { return Err(fail("GIT", "no such revision")) };
            let (ahead, behind) = book.repo.graph_ahead_behind(x.id(), y.id())?;
            Ok(json!({ "ahead": ahead, "behind": behind }))
        }
        "mergeBase" => {
            let book = Book::open(dir)?;
            let (x, y) = (commit_of(&book.repo, s(a, "a")?), commit_of(&book.repo, s(a, "b")?));
            let (Some(x), Some(y)) = (x, y) else { return Ok(json!(null)) };
            Ok(json!(book.repo.merge_base(x.id(), y.id()).ok().map(|o| o.to_string())))
        }
        "isAncestor" => {
            let book = Book::open(dir)?;
            let (x, y) = (commit_of(&book.repo, s(a, "a")?), commit_of(&book.repo, s(a, "b")?));
            let (Some(x), Some(y)) = (x, y) else { return Ok(json!(false)) };
            Ok(json!(x.id() == y.id() || book.repo.graph_descendant_of(y.id(), x.id())?))
        }
        "mergeTrees" => {
            // git merge-tree --write-tree --name-only: the merged tree, and the paths that didn't merge.
            // The app merges those itself (core's merge3) and replaces them, so what the tree holds for a
            // conflicted path doesn't matter: here it's our side, or theirs where we have none.
            let book = Book::open(dir)?;
            let repo = &book.repo;
            let ours = commit_of(repo, s(a, "ours")?).ok_or_else(|| fail("GIT", "no such commit"))?;
            let theirs = commit_of(repo, s(a, "theirs")?).ok_or_else(|| fail("GIT", "no such commit"))?;
            let mut opts = MergeOptions::new();
            opts.find_renames(true);
            let mut index = repo.merge_commits(&ours, &theirs, Some(&opts))?;
            let conflicted = conflict_paths(&index)?;
            let mut stand_ins = vec![];
            for c in index.conflicts()? {
                let c = c?;
                if let Some(e) = c.our.or(c.their) {
                    stand_ins.push(e);
                }
            }
            for p in &conflicted {
                index.conflict_remove(Path::new(p)).ok();
            }
            for mut e in stand_ins {
                e.flags &= !0x3000; // stage 0
                index.add(&e)?;
            }
            let tree = index.write_tree_to(repo)?;
            Ok(json!({ "tree": tree.to_string(), "conflicts": conflicted.into_iter().collect::<Vec<_>>() }))
        }
        "buildTree" => {
            // read-tree, update-index and write-tree in a temporary index: the real one isn't touched.
            let book = Book::open(dir)?;
            let repo = &book.repo;
            let base = repo.find_tree(Oid::from_str(s(a, "base")?)?)?;
            let mut index = Index::new()?;
            index.read_tree(&base)?;
            for e in a.get("edits").and_then(Value::as_array).cloned().unwrap_or_default() {
                let path = s(&e, "path")?;
                if e.get("remove").and_then(Value::as_bool) == Some(true) {
                    index.remove_path(Path::new(path))?;
                } else if let Some(content) = e.get("content").and_then(Value::as_str) {
                    let bytes = B64.decode(content).map_err(|x| fail("GIT", x.to_string()))?;
                    let oid = repo.blob(&bytes)?;
                    let mode = u32::from_str_radix(opt(&e, "mode").unwrap_or("100644"), 8).unwrap_or(0o100644);
                    index.add(&index_entry(path, oid, mode, bytes.len() as u32))?;
                } else {
                    let oid = Oid::from_str(s(&e, "oid")?)?;
                    let mode = u32::from_str_radix(s(&e, "mode")?, 8).unwrap_or(0o100644);
                    index.add(&index_entry(path, oid, mode, 0))?;
                }
            }
            Ok(json!(index.write_tree_to(repo)?.to_string()))
        }
        "commitTree" => {
            // git commit-tree: the message as given.
            let book = Book::open(dir)?;
            let repo = &book.repo;
            let sig = signature(repo)?;
            let tree = repo.find_tree(Oid::from_str(s(a, "tree")?)?)?;
            let parents: Vec<git2::Commit> = strs(a, "parents").iter().map(|p| repo.find_commit(Oid::from_str(p)?)).collect::<Result<_, _>>()?;
            let refs: Vec<&git2::Commit> = parents.iter().collect();
            Ok(json!(repo.commit(None, &sig, &sig, s(a, "message")?, &tree, &refs)?.to_string()))
        }
        "rebase" => {
            // git rebase <onto>: our commits replayed on it. On a conflict nothing is left half done
            // (git rebase --abort), and the repository's paths are returned.
            let book = Book::open(dir)?;
            let repo = &book.repo;
            let sig = signature(repo)?;
            let onto = repo.revparse_single(s(a, "onto")?)?.peel_to_commit()?;
            let upstream: AnnotatedCommit = repo.find_annotated_commit(onto.id())?;
            let branch = repo.reference_to_annotated_commit(&repo.head()?)?;
            let mut ro = RebaseOptions::new();
            let mut rebase = repo.rebase(Some(&branch), Some(&upstream), None, Some(&mut ro))?;
            while let Some(step) = rebase.next() {
                step?;
                let index = repo.index()?;
                if index.has_conflicts() {
                    let paths = conflict_paths(&index)?;
                    rebase.abort()?;
                    return Ok(json!({ "conflicts": paths.into_iter().collect::<Vec<_>>() }));
                }
                match rebase.commit(None, &sig, None) {
                    Ok(_) => {}
                    // Already upstream: git drops it too.
                    Err(e) if e.code() == ErrorCode::Applied => {}
                    Err(e) => return Err(e.into()),
                }
            }
            rebase.finish(Some(&sig))?;
            Ok(json!({ "conflicts": [] }))
        }
        "fetch" => {
            let book = Book::open(dir)?;
            let said = RefCell::new(String::new());
            let mut remote = book.repo.find_remote(s(a, "remote")?)?;
            let mut fo = FetchOptions::new();
            fo.remote_callbacks(callbacks(a, &said, progress));
            if a.get("prune").and_then(Value::as_bool) == Some(true) {
                fo.prune(FetchPrune::On);
            }
            remote.fetch(&strs(a, "refspecs"), Some(&mut fo), None).map_err(|e| classify(&e, &said.borrow()))?;
            Ok(json!(null))
        }
        "push" => {
            let book = Book::open(dir)?;
            let repo = &book.repo;
            let said = RefCell::new(String::new());
            let refused = RefCell::new(Vec::<String>::new());
            let name = s(a, "remote")?;
            let mut remote = repo.find_remote(name)?;
            let refspecs = expand_refspecs(repo, &strs(a, "refspecs"))?;
            {
                let mut cb = callbacks(a, &said, progress);
                cb.push_update_reference(|refname, status| {
                    if let Some(why) = status {
                        refused.borrow_mut().push(format!("! [remote rejected] {refname} ({why})"));
                    }
                    Ok(())
                });
                let mut po = PushOptions::new();
                po.remote_callbacks(cb);
                remote.push(&refspecs, Some(&mut po)).map_err(|e| classify(&e, &said.borrow()))?;
            }
            if !refused.borrow().is_empty() {
                let text = format!("{}\n{}", said.borrow(), refused.borrow().join("\n"));
                let code = if text.to_lowercase().contains("workflow") && text.to_lowercase().contains("scope") { "SCOPE" } else { "GIT" };
                return Err(fail(code, text));
            }
            if a.get("setUpstream").and_then(Value::as_bool) == Some(true) {
                // Like git push --set-upstream: the local branch pushed (HEAD's, for "HEAD:…") tracks the one it went to.
                for spec in &refspecs {
                    let (src, dst) = spec.trim_start_matches('+').split_once(':').unwrap_or((spec, spec));
                    let local = if src == "HEAD" { repo.head()?.shorthand().ok().map(String::from) } else { src.strip_prefix("refs/heads/").map(String::from) };
                    if let (Some(local), Some(to)) = (local, dst.strip_prefix("refs/heads/")) {
                        repo.find_branch(&local, BranchType::Local)?.set_upstream(Some(&format!("{name}/{to}")))?;
                    }
                }
            }
            Ok(json!(null))
        }
        "cancel" => {
            cancel(s(a, "token")?);
            Ok(json!(null))
        }
        other => Err(fail("GIT", format!("unknown op {other}"))),
    }
}

/// One request: `op` on the folder `dir` (empty: the user's global configuration), with `args`.
/// `{ ok: … }` or `{ err: { code, message } }`. `progress` hears a clone's or fetch's progress.
pub fn call_with(name: &str, dir: &str, args: &Value, progress: &mut dyn FnMut(Value)) -> Value {
    match op(name, dir, args, progress) {
        Ok(v) => json!({ "ok": v }),
        Err(f) => json!({ "err": { "code": f.code, "message": f.message } }),
    }
}

/// One request, with no one listening for progress.
pub fn call(name: &str, dir: &str, args: &Value) -> Value {
    call_with(name, dir, args, &mut |_| {})
}

/// Trust the certificates in `dirs` for every https remote, added to libgit2's OpenSSL in memory.
///
/// Android keeps its trusted roots one PEM file each, named by OpenSSL's old subject hash, which today's
/// OpenSSL doesn't look up; and OpenSSL as built for Android (openssl-src) has no stdio, so it can't read
/// a file or folder of certificates at all. So each certificate is parsed here, from memory, and handed
/// to libgit2 (GIT_OPT_ADD_SSL_X509_CERT). The newest store is Conscrypt's, which Android updates on its
/// own; the system one is older. Returns how many were trusted, and from which folders.
pub fn trust_certificates_in(dirs: &[&str]) -> Result<Value, String> {
    let mut seen = BTreeSet::new();
    let mut from = vec![];
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(dir) else { continue };
        let before = seen.len();
        for e in entries.flatten() {
            let Ok(text) = std::fs::read(e.path()) else { continue };
            // A file may hold a description after its PEM block: only certificates are read.
            let Ok(certs) = openssl::x509::X509::stack_from_pem(&text) else { continue };
            for cert in certs {
                let Ok(der) = cert.to_der() else { continue };
                if !seen.insert(der) {
                    continue;
                }
                libgit2_sys::init();
                // libgit2 takes its own reference to the certificate (X509_STORE_add_cert).
                let rc = unsafe { libgit2_sys::git_libgit2_opts(libgit2_sys::GIT_OPT_ADD_SSL_X509_CERT as std::ffi::c_int, cert.as_ptr()) };
                if rc < 0 {
                    return Err(git2::Error::last_error(rc).message().to_string());
                }
            }
        }
        if seen.len() > before {
            from.push(*dir);
        }
    }
    if seen.is_empty() {
        return Err(format!("no certificates in {}", dirs.join(", ")));
    }
    Ok(json!({ "certificates": seen.len(), "from": from }))
}

#[cfg(test)]
mod tests {
    use super::glob;

    #[test]
    fn globs_match_as_git_pathspecs_do() {
        assert!(glob("**/.*.writer-tmp", ".a.md.writer-tmp"));
        assert!(glob("**/.*.writer-tmp", "book/one/.a.md.writer-tmp"));
        assert!(!glob("**/.*.writer-tmp", "book/a.md"));
        assert!(!glob("**/.*.writer-tmp", "book/a.md.writer-tmp"));
        assert!(glob("book/*.md", "book/a.md"));
        assert!(!glob("book/*.md", "book/x/a.md"));
    }
}
