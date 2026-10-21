# D16 spike: Writer's git over libgit2

Tasks #45 (desktop) and #46 (Android), for decision D16 (#12) and requirement #8 (Android). The question: can a Rust git port (libgit2 through the `git2` crate) do everything Writer's server asks of git, with the same results, so that the server's logic can become an engine that Android hosts without Node or a git binary?

In short: on the desktop, libgit2 agrees with git on everything the app asks of it. On an Android phone, a webview called the same Rust in process and ran a whole sync round trip, with a conflict, in tens of milliseconds a step, and reached github.com over HTTPS trusting the phone's own certificates.

## What was built

All of it is under `spike/d16/`, outside the app. No production code changed.

| File | What it is |
|---|---|
| `port.ts` | The git port: 39 operations named for what the app needs, not for git commands. |
| `node-port.ts` | The port over today's git, running the same commands and flags the server runs, through the server's own `git.ts` (environment, credentials, error codes). |
| `git2-port/` | The port over libgit2 1.9.7 (`git2` 0.21, built from source with HTTPS), in Rust. For the test it answers JSON requests on stdin; on Android the same functions would be called in process from a Tauri command. |
| `rust-port.ts` | The port over that binary. |
| `contract.test.ts` | One contract suite, run against both ports, then both run on the same repositories (or identical copies) and compared answer for answer. Syncs go through the fake GitHub's git over HTTP, with Writer's token. |
| `bench.ts` | Timings over a large book. |
| `android/` | A Tauri 2 Android app whose page calls the port in process (*On Android*, below). |

To run them: `cargo build --release` in `spike/d16/git2-port`, then `npx vitest run --config spike/d16/vitest.config.ts`, and `node spike/d16/bench.ts`.

## Result

**26 of 26 contract tests pass on both ports.** On the same repositories, git and libgit2 give identical answers, down to the object IDs:
- refs, tags (annotated, with their messages), status, logs, a path's log, each commit's changes with renames, trees, blobs, counts and merge bases;
- after the same writes (staging, committing, restoring from a checkpoint, rebasing), the same trees;
- for a merge, the same conflicted paths and, once the app has settled them, the same tree;
- with `core.autocrlf=input`, the same blobs; over a binary file, the same conflict.

Each port on its own also:
- commits with the message cleaned up as `git commit -m` does, by the configured author, and amends;
- makes, switches and deletes branches, keeping a local change a switch doesn't touch and refusing one it would overwrite;
- fast-forwards only, and not over a local change;
- rebases, and on a conflict leaves everything as it was and names the paths;
- puts a book on GitHub with the app's own refspecs (`HEAD:refs/heads/main`, the checkpoint tags by wildcard), clones it, and takes a conflict both sides made through the app's merge to a push and a pull;
- prunes a deleted version from what a fetch tracks;
- says why GitHub refused, in the server's codes:
  - AUTH, for no token or a revoked one;
  - NOT_FOUND, for no such repository;
  - NETWORK, for no server;
  - DESTINATION_EXISTS, for a folder that isn't empty;
  - REJECTED, for a push the remote has moved past;
  - SCOPE, for a workflow pushed without the workflow scope.

### Speed

150 scenes of about 800 words each, 401 commits. Milliseconds on this machine (8 cores). The git2 column includes the JSON-over-stdio hop and base64 for blobs, which in-process calls wouldn't have.

| Operation | git 2.56.0 | libgit2 1.9.7 |
|---|---:|---:|
| status | 6 | 10 |
| save: a scene staged and committed | 18 | 22 |
| open: tree and every blob at HEAD | 11 | 7 |
| a scene's history (log -- path) | 34 | 46 |
| stats: every commit's changes (log --raw -M) | 46 | 68 |
| sync: ahead/behind and an in-memory merge | 7 | 4 |

The two are within a few tens of milliseconds of each other on every operation. A phone will be several times slower than this machine; the stats page's full-history read is the one to watch there.

## What the app needs of git

The server and the CLI run git in 108 places, through simple-git (`git()`) and raw commands with stdin and a temporary index (`gitPlumbing()`). Grouped by what they do:

| Port operation | Commands today | Used by |
|---|---|---|
| `init`, `isRepo`, `clone` | `init -q -b`, `checkIsRepo`, `clone` | new-book, library |
| `resolve`, `currentBranch` | `rev-parse --verify`, `symbolic-ref --quiet --short` | everywhere |
| `refs`, `tags` | `for-each-ref` with formats | versions, checkpoints, sync |
| `createBranch`, `switchBranch`, `deleteBranch` | `switch -c` (`--track` / `--no-track`), `switch`, `branch -D` | versions |
| `tag` | `tag --annotate -m -m` | checkpoints |
| `getConfig`, `setConfig`, `remoteUrl`, `addRemote` | `config`, `remote get-url`, `remote add` | committer, sync, publish |
| `status`, `stage`, `remove`, `stagedChanges` | `status --porcelain -z --untracked-files=all`, `add -A`, `rm -q`, `diff --cached --name-status -M -z` | committer, operations, convert |
| `commit`, `commitInfo` | `commit --quiet --no-verify -m -m`, `commit --amend --no-edit`, `log -1 --format` | committer, operations, convert |
| `restore` | `restore --source=<tag> --staged --worktree` | checkpoints |
| `fastForward` | `merge --ff-only` | sync, versions, conflicts |
| `log`, `history` | `log` with formats, `-- path`, `--diff-filter=D`; `log --reverse --no-merges --root -M --raw -z` | issues, manuscript (recently deleted), stats |
| `readFile`, `listTree`, `readBlobs` | `show rev:path`, `cat-file blob`, `ls-tree -r -z`, `cat-file --batch` | git-source (a book at a revision), checkpoints, compare |
| `count`, `aheadBehind`, `mergeBase`, `isAncestor` | `rev-list --count`, `rev-list --left-right --count`, `merge-base`, `merge-base --is-ancestor` | sync, versions |
| `mergeTrees` | `merge-tree --write-tree --name-only --no-messages` | conflicts |
| `buildTree`, `commitTree` | `read-tree`, `update-index`, `hash-object -w`, `write-tree` in a temporary index; `commit-tree -p -p -F -` | conflicts |
| `rebase` | `rebase --quiet --no-verify`, `rebase --abort`, `diff --name-only --diff-filter=U` | sync |
| `fetch`, `push` | `fetch --quiet [--prune]`, `push --quiet [--set-upstream]`, with Writer's token for one command | sync, publish |

Not in the port yet, and simple: `rev-parse --git-path` and `--absolute-git-dir` (where the app keeps its caches, and whether a merge or rebase is in progress), `ls-files --unmerged`, `log --diff-filter=D` (recently deleted), and `git version`.

One D16 risk didn't apply: **the app doesn't depend on git's conflict markers or its diffs.** It uses `merge-tree` only for the tree of what merged cleanly and the list of paths that didn't. It merges those itself, paragraph by paragraph (core's `merge3`). Its word diffs are its own too (core's `word-diff.ts`). So libgit2's merge output only has to agree on which paths conflict, and it does.

## Where libgit2 differs, and how the port handles it

| Difference | Matters to the app? | Handled |
|---|---|---|
| No wildcard refspecs in push (`refs/tags/checkpoint/*:…`) | Yes: sync pushes checkpoints that way | The port expands them against local refs, as git does |
| `--set-upstream` isn't part of push | Yes: the first push sets the branch's upstream | The port sets it after a successful push, from the refspec (`HEAD:` included) |
| Commit and tag messages are stored as given | Yes: git cleans up `-m` messages | The port runs `message_prettify`; `commitTree` keeps the message verbatim, as `commit-tree` does |
| Errors are classes and codes, not git's text | Yes: the server classifies git's output by pattern (`git.ts`) | The port returns the server's codes; the remote's own words (sideband, refusals) go in the message |
| A date-sorted walk isn't topological within a second | Yes: logs listed a parent before its child | Topological and date order together, as git log keeps it |
| `merge-tree` writes conflict markers into the tree; libgit2's merge leaves the conflict in an index | No: the app replaces every conflicted path | The port's tree holds our side for those paths |
| `git rebase` skips commits already upstream by patch ID; libgit2 only skips ones that come out empty | Hardly: the app rebases only its own unpushed commits | Noted, not handled |
| A path's log on merges: git simplifies history; the port leaves out a merge that matches any parent | Not for the app's linear histories; checked only on those | Noted |
| No hooks, no `GIT_ASKPASS`, no credential helpers | No: the app passes its own token and wants no hooks (`--no-verify`) | The port takes the token directly |
| The author's name comes from the global config, which a phone won't have | Yes, on Android | The engine keeps the identity itself and gives it to the port; the app already asks for one where git has none (*Who's writing?*) |

## What the engine split would take

- The server is 8,172 lines in 39 files. 22 import from `node:`: mostly `path` (19) and `fs/promises` (18), which become the files port, and `crypto` (5), for hashes, which has a Web Crypto equivalent.
- `child_process` is used in 2 files (`git.ts` and its plumbing), which the git port replaces. `http` and `net` are in the transport, which stays in the Node host. File watching (chokidar) is in `workspace.ts`, behind the files port.
- The 108 git call sites move onto the port's 39 operations. Most are one-line changes. `conflicts.ts`, `sync.ts`, `versions.ts` and `checkpoints.ts` need the most care, and the contract suite covers what they do.
- Error handling simplifies: the port returns codes, so `classifyGitError`'s patterns stay only in the Node adapter.

A rough size: the port and its Node adapter, about 380 lines (written here); moving the server onto the port, one task per area (committer, sync and conflicts, versions and checkpoints, history and stats, library and publish), each with its tests green; the Rust adapter, about 800 lines (written here), plus Tauri commands.

## On Android

`spike/d16/android/` is a Tauri 2 app. Its Rust has one command, `git(op, dir, args)`, that calls the port library (`git2-port/src/lib.rs`) in process, plus a few for files. Its page (`page/scenario.js`) runs the round trip in JavaScript through `invoke()`, as an engine in the webview would:
1. It clones a book twice.
2. A writes, makes a checkpoint and syncs. B writes the same paragraph, and B's push is refused.
3. B fetches and merges in memory, gets the conflict, settles it, commits the merge and syncs.
4. A syncs and has the settled text.

Then it times what the app does most often, and reaches github.com over HTTPS. With a PC attached, it uses the PC's fake GitHub through `adb reverse` (`run.ts`). On its own, it makes a remote on the device with the same book: 150 scenes and 61 commits.

**Building it.** `build.sh` builds an arm64 APK with the Android SDK, NDK 27.2 and OpenJDK 17 from a Unity 6 install (read only), and Rust 1.99.1 with the Android target from a rustup in its own folder. Two things needed working around:
- Unity's SDK carries no accepted licences, so Gradle can't fetch anything. The project compiles against platform 36, which the SDK has, and targets 34.
- The generated Gradle task calls the Tauri CLI by a bare name, so `build.sh` gives it the full path.

The APK is 19 MB, debug-signed for sideloading. The Rust library is 12 MB optimized and stripped, and holds libgit2, OpenSSL and Tauri.

**On a Pixel 10 Pro, Android 17** (WebView: Chrome 155), installed from the APK, with no PC attached. Every step passed:

| Step | Phone, ms | This PC, ms |
|---|---:|---:|
| clone the book (150 scenes, 61 commits) | 17 | 9 |
| A writes, commits, makes a checkpoint and syncs | 83 | 7 |
| B writes the same paragraph, commits, and is refused | 57 | 4 |
| B fetches and merges in memory | 44 | 13 |
| B commits the settled merge and syncs | 55 | 8 |
| A syncs and has the settled text | 59 | 11 |
| status | 13 | 1 |
| open: tree and every blob at HEAD | 28 | 3 |
| a scene's history | 8 | 4 |
| stats: every commit's changes | 27 | 9 |
| save: a scene staged and committed | 46 | 3 |
| https: list a GitHub repository's refs | 374 | |
| https: clone a small repository from github.com | 1453 | 292 |

The PC column is the same page script, run in Node against the stdio binary. The phone column includes each `invoke()` from the page to the Rust and back. Nothing the app does on a save or a sync takes as long as a tenth of a second.

**HTTPS took three tries, and the third is the way to do it.** OpenSSL as built for Android (openssl-src) has no stdio, so it can't read a certificate file or folder at all. Android also names its certificates by OpenSSL's old subject hash, so pointing OpenSSL at the folder would find nothing even if it could read it. So at start the app reads each certificate from Android's stores itself and hands it to libgit2 in memory (`GIT_OPT_ADD_SSL_X509_CERT`, in `trust_certificates_in`). It reads Conscrypt's store first (`/apex/com.android.conscrypt/cacerts`, which Android updates on its own), then the system's. On the Pixel: 120 certificates, all from Conscrypt. A certificate a user adds to the phone themselves isn't in either folder, so it wouldn't be trusted this way.

**Not run on the phone:** a push with Writer's token over HTTPS to a real repository (the desktop phase covered token pushes, over HTTP to the fake GitHub), and the round trip through `adb reverse` to the PC's fake GitHub (`run.ts`; it needs a phone on USB).

## Not checked yet

- **Unsaved text when Android kills the app**, which #8 asks for. That's the engine's and the files port's, not git's.
- **A push to github.com from the phone**, with Writer's token over HTTPS.
- **SSH remotes.** Built without SSH, since Writer's own sign-in is HTTPS with a token. A book cloned over SSH on the desktop would need HTTPS on Android.
- **Books in a subfolder of a larger repository.** The app supports them (`--relative`, `rev-parse --show-prefix`). The port takes paths from the repository's top, so the engine would add and strip the prefix. Not exercised.
- **gitoxide** (pure Rust), as D16 names it, wasn't tried. libgit2 did everything asked, so there was no need.

## Recommendation

**Accept D16, amended** as follows. The owner decides.

1. The git port is defined by what the app needs, as in `port.ts`, not by git's commands. Each operation has a contract test that both adapters pass.
2. The port returns the server's error codes. Pattern-matching git's output stays inside the Node adapter.
3. The contract suite runs in CI against both adapters, so they can't drift apart. That needs Rust in CI, which a job of its own can have.
4. Use libgit2 through `git2` on Android, as proposed. It did everything the app needs, agreed with git on every answer checked, and ran the round trip on a phone.
5. On Android, the engine trusts the device's certificates by handing them to libgit2 in memory, as `trust_certificates_in` does. OpenSSL there can't read them from files.

D16's validation criteria asked for the round trip on an Android emulator. It ran on a real phone instead, against a remote on the phone, plus a clone from github.com. The engine's own tests against in-memory ports are part of the split, not of this spike.
