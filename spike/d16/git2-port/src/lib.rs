//! D16 spike (#45, #46): the git operations Writer's server uses (docs/architecture/d16-spike.md), over
//! libgit2. `call` answers one request, `{ ok }` or `{ err: { code, message } }`: the stdio binary
//! (src/main.rs) wraps it for the desktop contract suite, and the Android app's Tauri command calls it
//! in process.

use base64::{Engine, engine::general_purpose::STANDARD as B64};
use git2::{
    AnnotatedCommit, BranchType, Cred, Delta, DiffFindOptions, DiffOptions, ErrorClass, ErrorCode, FetchOptions, FetchPrune, Index, IndexEntry,
    IndexTime, MergeOptions, ObjectType, Oid, PushOptions, RebaseOptions, RemoteCallbacks, Repository, RepositoryInitOptions, Signature, Sort, Status,
    StatusOptions, Time, Tree,
};
use serde_json::{Value, json};
use git2::build::CheckoutBuilder;
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

/// A failure with one of the codes the server's GitFailure uses, so the UI can say what to do.
struct Failure {
    code: &'static str,
    message: String,
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
    } else if lower.contains("404") || lower.contains("not found") && e.class() == ErrorClass::Http {
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

fn strs(args: &Value, key: &str) -> Vec<String> {
    args.get(key).and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default()
}

fn open(dir: &str) -> R<Repository> {
    Repository::open(dir).map_err(|e| fail("GIT", e.message().to_string()))
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

/// Credentials for one command: Writer's token as x-access-token, offered once (then it's AUTH, not a loop).
fn callbacks<'a>(auth: Option<String>, said: &'a RefCell<String>) -> RemoteCallbacks<'a> {
    let mut cb = RemoteCallbacks::new();
    let mut offered = false;
    cb.credentials(move |_url, _user, _allowed| match (&auth, offered) {
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

/// Every blob under `tree` (or under `prefix` in it), with its path from the tree's root.
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

/// The changes a diff holds, as `--name-status -M --raw` would list them.
fn changes(diff: &git2::Diff) -> Vec<Value> {
    diff.deltas()
        .map(|d| {
            let path = d.new_file().path().or(d.old_file().path()).map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
            let mut v = json!({ "status": diff_status(d.status()), "path": path, "old": d.old_file().id().to_string(), "new": d.new_file().id().to_string() });
            if matches!(d.status(), Delta::Renamed | Delta::Copied) {
                v["from"] = json!(d.old_file().path().map(|p| p.to_string_lossy().to_string()));
            }
            v
        })
        .collect()
}

fn tree_diff<'r>(repo: &'r Repository, commit: &git2::Commit<'r>) -> R<git2::Diff<'r>> {
    let parent = if commit.parent_count() > 0 { Some(commit.parent(0)?.tree()?) } else { None };
    let mut diff = repo.diff_tree_to_tree(parent.as_ref(), Some(&commit.tree()?), Some(DiffOptions::new().ignore_submodules(true)))?;
    diff.find_similar(Some(&mut renames()))?;
    Ok(diff)
}

/// Whether `path` (a file or a folder) is the same in `a` and `b`: git log's TREESAME.
fn same_at(a: &Tree, b: Option<&Tree>, path: &str) -> bool {
    let id = |t: &Tree| t.get_path(Path::new(path)).ok().map(|e| e.id());
    match b {
        Some(b) => id(a) == id(b),
        None => id(a).is_none(),
    }
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

fn op(name: &str, dir: &str, a: &Value) -> R<Value> {
    match name {
        "version" => {
            let v = git2::Version::get();
            let (maj, min, rev) = v.libgit2_version();
            Ok(json!(format!("libgit2 {maj}.{min}.{rev}")))
        }
        "init" => {
            let mut o = RepositoryInitOptions::new();
            o.initial_head(s(a, "branch")?);
            // A bare one: a remote on the same device, for the Android app when there's no PC.
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
            fo.remote_callbacks(callbacks(a.get("token").and_then(Value::as_str).map(String::from), &said));
            git2::build::RepoBuilder::new().fetch_options(fo).clone(s(a, "url")?, dest).map_err(|e| classify(&e, &said.borrow()))?;
            Ok(json!(null))
        }
        "resolve" => {
            let repo = open(dir)?;
            Ok(json!(commit_of(&repo, s(a, "rev")?).map(|c| c.id().to_string())))
        }
        "currentBranch" => {
            let repo = open(dir)?;
            let head = repo.find_reference("HEAD")?;
            Ok(json!(head.symbolic_target()?.and_then(|t| t.strip_prefix("refs/heads/")).map(String::from)))
        }
        "refs" => {
            let repo = open(dir)?;
            let prefix = s(a, "prefix")?;
            let mut out = vec![];
            for r in repo.references()? {
                let r = r?;
                let Ok(name) = r.name().map(String::from) else { continue };
                if !name.starts_with(prefix) {
                    continue;
                }
                let symref = r.symbolic_target()?.map(String::from);
                let resolved = r.resolve()?;
                let oid = resolved.target();
                let date = oid.and_then(|o| repo.find_commit(o).ok()).map(|c| iso(c.committer().when()));
                out.push(json!({ "name": name, "oid": oid.map(|o| o.to_string()), "date": date, "symref": symref }));
            }
            out.sort_by(|x, y| x["name"].as_str().cmp(&y["name"].as_str()));
            Ok(json!(out))
        }
        "tags" => {
            let repo = open(dir)?;
            let mut out = vec![];
            for name in repo.tag_names(None)?.iter().filter_map(|n| n.ok().flatten()) {
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
            Ok(json!(out))
        }
        "createBranch" => {
            let repo = open(dir)?;
            let name = s(a, "name")?;
            let from = commit_of(&repo, s(a, "from")?).ok_or_else(|| fail("GIT", "no such start point"))?;
            let mut branch = repo.branch(name, &from, false)?;
            if let Some(up) = a.get("track").and_then(Value::as_str) {
                branch.set_upstream(Some(up))?;
            }
            repo.checkout_tree(from.as_object(), Some(&mut checkout_safe()))?;
            repo.set_head(&format!("refs/heads/{name}"))?;
            Ok(json!(null))
        }
        "switchBranch" => {
            let repo = open(dir)?;
            let name = s(a, "name")?;
            let target = commit_of(&repo, &format!("refs/heads/{name}")).ok_or_else(|| fail("GIT", format!("no branch {name}")))?;
            repo.checkout_tree(target.as_object(), Some(&mut checkout_safe()))?;
            repo.set_head(&format!("refs/heads/{name}"))?;
            Ok(json!(null))
        }
        "deleteBranch" => {
            let repo = open(dir)?;
            repo.find_branch(s(a, "name")?, BranchType::Local)?.delete()?;
            Ok(json!(null))
        }
        "tag" => {
            let repo = open(dir)?;
            let head = head_commit(&repo).ok_or_else(|| fail("GIT", "no commit to tag"))?;
            repo.tag(s(a, "name")?, head.as_object(), &signature(&repo)?, &cleaned(s(a, "message")?)?, false)?;
            Ok(json!(null))
        }
        "getConfig" => {
            let repo = open(dir)?;
            Ok(json!(repo.config()?.get_string(s(a, "key")?).ok()))
        }
        "setConfig" => {
            let repo = open(dir)?;
            repo.config()?.open_level(git2::ConfigLevel::Local)?.set_str(s(a, "key")?, s(a, "value")?)?;
            Ok(json!(null))
        }
        "remoteUrl" => {
            let repo = open(dir)?;
            Ok(json!(repo.find_remote(s(a, "name")?).ok().and_then(|r| r.url().ok().map(String::from))))
        }
        "addRemote" => {
            let repo = open(dir)?;
            repo.remote(s(a, "name")?, s(a, "url")?)?;
            Ok(json!(null))
        }
        "status" => {
            let repo = open(dir)?;
            let mut o = StatusOptions::new();
            o.include_untracked(true).recurse_untracked_dirs(true).renames_head_to_index(true).include_ignored(false);
            let mut out = vec![];
            for e in repo.statuses(Some(&mut o))?.iter() {
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
                let path = renamed.as_ref().and_then(|d| d.new_file().path()).map(|p| p.to_string_lossy().to_string()).or(e.path().ok().map(String::from)).unwrap_or_default();
                let mut v = json!({ "path": path, "x": x, "y": y });
                if let Some(d) = renamed {
                    v["from"] = json!(d.old_file().path().map(|p| p.to_string_lossy().to_string()));
                }
                out.push(v);
            }
            out.sort_by(|p, q| p["path"].as_str().cmp(&q["path"].as_str()));
            Ok(json!(out))
        }
        "stage" => {
            let repo = open(dir)?;
            let mut index = repo.index()?;
            let paths = strs(a, "paths");
            let spec: Vec<&str> = if paths.is_empty() { vec!["*"] } else { paths.iter().map(String::as_str).collect() };
            // git add -A: new and changed files, and deleted ones gone from the index.
            index.add_all(spec.iter(), git2::IndexAddOption::DEFAULT, None)?;
            index.update_all(spec.iter(), None)?;
            index.write()?;
            Ok(json!(null))
        }
        "remove" => {
            let repo = open(dir)?;
            let mut index = repo.index()?;
            for p in strs(a, "paths") {
                let full = Path::new(dir).join(&p);
                if full.is_dir() {
                    index.remove_dir(Path::new(&p), 0)?;
                    std::fs::remove_dir_all(&full)?;
                } else {
                    index.remove_path(Path::new(&p))?;
                    if full.exists() {
                        std::fs::remove_file(&full)?;
                    }
                }
            }
            index.write()?;
            Ok(json!(null))
        }
        "stagedChanges" => {
            let repo = open(dir)?;
            let head = head_commit(&repo).map(|c| c.tree()).transpose()?;
            let mut diff = repo.diff_tree_to_index(head.as_ref(), Some(&repo.index()?), None)?;
            diff.find_similar(Some(&mut renames()))?;
            Ok(json!(changes(&diff)))
        }
        "commit" => {
            let repo = open(dir)?;
            let sig = signature(&repo)?;
            let tree = repo.find_tree(repo.index()?.write_tree()?)?;
            let id = if a.get("amend").and_then(Value::as_bool) == Some(true) {
                // git commit --amend --no-edit: its message and author kept, a new committer and tree.
                let head = head_commit(&repo).ok_or_else(|| fail("GIT", "nothing to amend"))?;
                head.amend(Some("HEAD"), None, Some(&sig), None, None, Some(&tree))?
            } else {
                let parents: Vec<git2::Commit> = head_commit(&repo).into_iter().collect();
                let refs: Vec<&git2::Commit> = parents.iter().collect();
                repo.commit(Some("HEAD"), &sig, &sig, &cleaned(s(a, "message")?)?, &tree, &refs)?
            };
            Ok(json!(id.to_string()))
        }
        "commitInfo" => {
            let repo = open(dir)?;
            let c = commit_of(&repo, s(a, "rev")?).ok_or_else(|| fail("GIT", "no such commit"))?;
            Ok(json!({
                "oid": c.id().to_string(), "tree": c.tree_id().to_string(), "parents": c.parent_ids().map(|p| p.to_string()).collect::<Vec<_>>(),
                "message": c.message().unwrap_or(""), "author": { "name": c.author().name().ok(), "email": c.author().email().ok() },
                "authored": iso(c.author().when()), "committed": iso(c.committer().when()),
            }))
        }
        "restore" => {
            // git restore --source=<rev> --staged --worktree -- <paths>: what the source has comes back,
            // and what it hasn't is removed, from the index and the work tree.
            let repo = open(dir)?;
            let source = commit_of(&repo, s(a, "rev")?).ok_or_else(|| fail("GIT", "no such source"))?.tree()?;
            let mut index = repo.index()?;
            for p in strs(a, "paths") {
                let mut wanted = vec![];
                match source.get_path(Path::new(&p)) {
                    Ok(e) if e.kind() == Some(ObjectType::Tree) => walk(&repo, &repo.find_tree(e.id())?, &p, &mut wanted)?,
                    Ok(e) => wanted.push(entry_json(&p, e.filemode(), e.id())),
                    Err(_) => {}
                }
                let keep: BTreeSet<String> = wanted.iter().filter_map(|w| w["path"].as_str().map(String::from)).collect();
                let present: Vec<String> = index.iter().map(|e| String::from_utf8_lossy(&e.path).to_string()).filter(|q| q == &p || q.starts_with(&format!("{p}/"))).collect();
                for q in present.iter().filter(|q| !keep.contains(*q)) {
                    index.remove_path(Path::new(q))?;
                    let _ = std::fs::remove_file(Path::new(dir).join(q));
                }
                for w in &wanted {
                    let path = w["path"].as_str().unwrap_or("");
                    let blob = repo.find_blob(Oid::from_str(w["oid"].as_str().unwrap_or(""))?)?;
                    let full = Path::new(dir).join(path);
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
        "fastForward" => fast_forward(&open(dir)?, s(a, "rev")?),
        "log" => {
            let repo = open(dir)?;
            let mut walk = repo.revwalk()?;
            // Newest first, parents after children even within a second, as git log keeps them.
            walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
            match a.get("rev").and_then(Value::as_str) {
                Some(rev) => walk.push(repo.revparse_single(rev)?.peel_to_commit()?.id())?,
                None => walk.push_head()?,
            }
            let path = a.get("path").and_then(Value::as_str);
            let limit = a.get("limit").and_then(Value::as_u64).unwrap_or(u64::MAX) as usize;
            let mut out = vec![];
            for id in walk {
                let c = repo.find_commit(id?)?;
                if let Some(p) = path {
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
            // git log --reverse --no-merges --root -M --raw: each commit's changes, oldest first.
            let repo = open(dir)?;
            let mut walk = repo.revwalk()?;
            walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME | Sort::REVERSE)?;
            walk.push_head()?;
            let mut out = vec![];
            for id in walk {
                let c = repo.find_commit(id?)?;
                if c.parent_count() > 1 {
                    continue;
                }
                out.push(json!({ "oid": c.id().to_string(), "authored": iso(c.author().when()), "files": changes(&tree_diff(&repo, &c)?) }));
            }
            Ok(json!(out))
        }
        "readFile" => {
            let repo = open(dir)?;
            let Some(c) = commit_of(&repo, s(a, "rev")?) else { return Ok(json!(null)) };
            let Ok(e) = c.tree()?.get_path(Path::new(s(a, "path")?)) else { return Ok(json!(null)) };
            Ok(json!(repo.find_blob(e.id()).ok().map(|b| B64.encode(b.content()))))
        }
        "listTree" => {
            let repo = open(dir)?;
            let tree = commit_of(&repo, s(a, "rev")?).ok_or_else(|| fail("GIT", "no such revision"))?.tree()?;
            let mut out = vec![];
            match a.get("path").and_then(Value::as_str) {
                None => walk(&repo, &tree, "", &mut out)?,
                Some(p) => match tree.get_path(Path::new(p)) {
                    Ok(e) if e.kind() == Some(ObjectType::Tree) => walk(&repo, &repo.find_tree(e.id())?, p, &mut out)?,
                    Ok(e) => out.push(entry_json(p, e.filemode(), e.id())),
                    Err(_) => {}
                },
            }
            Ok(json!(out))
        }
        "readBlobs" => {
            let repo = open(dir)?;
            let mut out = BTreeMap::new();
            for oid in strs(a, "oids") {
                if let Ok(b) = repo.find_blob(Oid::from_str(&oid)?) {
                    out.insert(oid, B64.encode(b.content()));
                }
            }
            Ok(json!(out))
        }
        "count" => {
            let repo = open(dir)?;
            let mut walk = repo.revwalk()?;
            walk.push(commit_of(&repo, s(a, "rev")?).ok_or_else(|| fail("GIT", "no such revision"))?.id())?;
            Ok(json!(walk.count()))
        }
        "aheadBehind" => {
            let repo = open(dir)?;
            let (x, y) = (commit_of(&repo, s(a, "a")?), commit_of(&repo, s(a, "b")?));
            let (Some(x), Some(y)) = (x, y) else { return Err(fail("GIT", "no such revision")) };
            let (ahead, behind) = repo.graph_ahead_behind(x.id(), y.id())?;
            Ok(json!({ "ahead": ahead, "behind": behind }))
        }
        "mergeBase" => {
            let repo = open(dir)?;
            let (x, y) = (commit_of(&repo, s(a, "a")?), commit_of(&repo, s(a, "b")?));
            let (Some(x), Some(y)) = (x, y) else { return Ok(json!(null)) };
            Ok(json!(repo.merge_base(x.id(), y.id()).ok().map(|o| o.to_string())))
        }
        "isAncestor" => {
            let repo = open(dir)?;
            let (x, y) = (commit_of(&repo, s(a, "a")?), commit_of(&repo, s(a, "b")?));
            let (Some(x), Some(y)) = (x, y) else { return Ok(json!(false)) };
            Ok(json!(x.id() == y.id() || repo.graph_descendant_of(y.id(), x.id())?))
        }
        "mergeTrees" => {
            // git merge-tree --write-tree --name-only: the merged tree, and the paths that didn't merge.
            // The app merges those itself (core's merge3) and replaces them, so what the tree holds for a
            // conflicted path doesn't matter: here it's our side, or theirs where we have none.
            let repo = open(dir)?;
            let ours = commit_of(&repo, s(a, "ours")?).ok_or_else(|| fail("GIT", "no such commit"))?;
            let theirs = commit_of(&repo, s(a, "theirs")?).ok_or_else(|| fail("GIT", "no such commit"))?;
            let mut opts = MergeOptions::new();
            opts.find_renames(true);
            let mut index = repo.merge_commits(&ours, &theirs, Some(&opts))?;
            let mut conflicted = BTreeSet::new();
            let mut stand_ins = vec![];
            for c in index.conflicts()? {
                let c = c?;
                for e in [&c.ancestor, &c.our, &c.their].into_iter().flatten() {
                    conflicted.insert(String::from_utf8_lossy(&e.path).to_string());
                }
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
            let tree = index.write_tree_to(&repo)?;
            Ok(json!({ "tree": tree.to_string(), "conflicts": conflicted.into_iter().collect::<Vec<_>>() }))
        }
        "buildTree" => {
            // read-tree, update-index and write-tree in a temporary index: the real one isn't touched.
            let repo = open(dir)?;
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
                    let mode = u32::from_str_radix(e.get("mode").and_then(Value::as_str).unwrap_or("100644"), 8).unwrap_or(0o100644);
                    index.add(&index_entry(path, oid, mode, bytes.len() as u32))?;
                } else {
                    let oid = Oid::from_str(s(&e, "oid")?)?;
                    let mode = u32::from_str_radix(s(&e, "mode")?, 8).unwrap_or(0o100644);
                    index.add(&index_entry(path, oid, mode, 0))?;
                }
            }
            Ok(json!(index.write_tree_to(&repo)?.to_string()))
        }
        "commitTree" => {
            // git commit-tree: the message as given.
            let repo = open(dir)?;
            let sig = signature(&repo)?;
            let tree = repo.find_tree(Oid::from_str(s(a, "tree")?)?)?;
            let parents: Vec<git2::Commit> = strs(a, "parents").iter().map(|p| repo.find_commit(Oid::from_str(p)?)).collect::<Result<_, _>>()?;
            let refs: Vec<&git2::Commit> = parents.iter().collect();
            Ok(json!(repo.commit(None, &sig, &sig, s(a, "message")?, &tree, &refs)?.to_string()))
        }
        "rebase" => {
            // git rebase <onto>: our commits replayed on it. On a conflict nothing is left half done
            // (git rebase --abort), and the paths are returned.
            let repo = open(dir)?;
            let sig = signature(&repo)?;
            let onto = repo.revparse_single(s(a, "onto")?)?.peel_to_commit()?;
            let upstream: AnnotatedCommit = repo.find_annotated_commit(onto.id())?;
            let branch = repo.reference_to_annotated_commit(&repo.head()?)?;
            let mut ro = RebaseOptions::new();
            let mut rebase = repo.rebase(Some(&branch), Some(&upstream), None, Some(&mut ro))?;
            while let Some(step) = rebase.next() {
                step?;
                let index = repo.index()?;
                if index.has_conflicts() {
                    let mut paths = BTreeSet::new();
                    for c in index.conflicts()? {
                        let c = c?;
                        for e in [&c.ancestor, &c.our, &c.their].into_iter().flatten() {
                            paths.insert(String::from_utf8_lossy(&e.path).to_string());
                        }
                    }
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
            let repo = open(dir)?;
            let said = RefCell::new(String::new());
            let mut remote = repo.find_remote(s(a, "remote")?)?;
            let mut fo = FetchOptions::new();
            fo.remote_callbacks(callbacks(a.get("token").and_then(Value::as_str).map(String::from), &said));
            if a.get("prune").and_then(Value::as_bool) == Some(true) {
                fo.prune(FetchPrune::On);
            }
            let refspecs = strs(a, "refspecs");
            remote.fetch(&refspecs, Some(&mut fo), None).map_err(|e| classify(&e, &said.borrow()))?;
            Ok(json!(null))
        }
        "push" => {
            let repo = open(dir)?;
            let said = RefCell::new(String::new());
            let refused = RefCell::new(Vec::<String>::new());
            let name = s(a, "remote")?;
            let mut remote = repo.find_remote(name)?;
            // libgit2 pushes no wildcards ("refs/tags/checkpoint/*:refs/tags/checkpoint/*"): each
            // matching ref is named instead, as git does.
            let mut refspecs = vec![];
            for spec in strs(a, "refspecs") {
                let (force, body) = spec.strip_prefix('+').map_or(("", spec.as_str()), |b| ("+", b));
                let (src, dst) = body.split_once(':').unwrap_or((body, body));
                match (src.split_once('*'), dst.split_once('*')) {
                    (Some((sp, ss)), Some((dp, ds))) => {
                        for r in repo.references()? {
                            let r = r?;
                            let Ok(n) = r.name() else { continue };
                            if let Some(mid) = n.strip_prefix(sp).and_then(|m| m.strip_suffix(ss)) {
                                refspecs.push(format!("{force}{n}:{dp}{mid}{ds}"));
                            }
                        }
                    }
                    _ => refspecs.push(spec.clone()),
                }
            }
            {
                let mut cb = callbacks(a.get("token").and_then(Value::as_str).map(String::from), &said);
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
        other => Err(fail("GIT", format!("unknown op {other}"))),
    }
}

/// One request: `op` on the repository at `dir`, with `args`. `{ ok: … }` or `{ err: { code, message } }`.
pub fn call(name: &str, dir: &str, args: &Value) -> Value {
    match op(name, dir, args) {
        Ok(v) => json!({ "ok": v }),
        Err(f) => json!({ "err": { "code": f.code, "message": f.message } }),
    }
}
