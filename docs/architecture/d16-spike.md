# D16 spike: Writer's git over libgit2 (desktop phase)

Task #45, for decision D16 (#12) and requirement #8 (Android). The question: can a Rust git port (libgit2 through the `git2` crate) do everything Writer's server asks of git, with the same results, so that the server's logic can become an engine that Android hosts without Node or a git binary?

This is the desktop phase. Nothing ran on Android: the Android toolchain isn't on the development machine yet, and that phase is the next step.

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

## Not checked yet

- **Android itself.** It needs a JDK, the Android SDK, NDK, an emulator and Rust's Android targets. Then a Tauri Android app calling this Rust in process, and the same sync round trip against the fake GitHub from the emulator.
- **HTTPS on Android.** The build here links the system's OpenSSL. Android needs `vendored-openssl`, or libgit2 built against another TLS library. To try first in the Android phase.
- **SSH remotes.** Built without SSH, since Writer's own sign-in is HTTPS with a token. A book cloned over SSH on the desktop would need HTTPS on Android.
- **Books in a subfolder of a larger repository.** The app supports them (`--relative`, `rev-parse --show-prefix`). The port takes paths from the repository's top, so the engine would add and strip the prefix. Not exercised.
- **gitoxide** (pure Rust), as D16 names it, wasn't tried. libgit2 did everything asked, so there was no need.

## Recommendation

**Accept D16, amended** as follows. The owner decides.

1. The git port is defined by what the app needs, as in `port.ts`, not by git's commands. Each operation has a contract test that both adapters pass.
2. The port returns the server's error codes. Pattern-matching git's output stays inside the Node adapter.
3. The contract suite runs in CI against both adapters, so they can't drift apart. That needs Rust in CI, which a job of its own can have.
4. Use libgit2 through `git2` on Android, as proposed. It did everything the app needs, and agreed with git on every answer checked.

Then the Android phase: the toolchain, a Tauri Android app calling the port in process, and the round trip on an emulator.
