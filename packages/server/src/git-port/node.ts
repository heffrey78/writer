import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { classifyGitError, git, gitPlumbing } from "../git.ts";
import { GitFailure, gitFailure, type Change, type GitAuth, type GitPort, type Scope, type StatusEntry, type TreeEntry } from "./port.ts";

/**
 * The git port over git itself (the system's, or the desktop app's portable git: git.ts), with the
 * commands and flags the server has always run, from the book's folder. The only code that runs git.
 */

const failure = (e: unknown): GitFailure => (e instanceof GitFailure ? e : classifyGitError(e));

async function run(dir: string, args: string[], options: { input?: string | Uint8Array; env?: Record<string, string> } = {}): Promise<Buffer> {
  try {
    const { input, env } = options;
    return await gitPlumbing(dir, args, { ...(env ? { env } : {}), ...(input === undefined ? {} : { input: typeof input === "string" ? input : Buffer.from(input) }) });
  } catch (e) {
    throw failure(e);
  }
}

const out = async (dir: string, args: string[], options?: { input?: string | Uint8Array; env?: Record<string, string> }) => (await run(dir, args, options)).toString();
const trimmed = async (dir: string, args: string[]) => (await out(dir, args)).trim();
/** A command whose failure means "none": --verify --quiet, config --get. */
const orNull = async (p: Promise<string>) => (await p.catch(() => "")).trim() || null;

/** `-- <paths> :(exclude,glob)<pattern>`: the folder (or `paths` in it), less what's excluded. */
const pathspec = ({ paths, exclude = [] }: Scope = {}) => ["--", ...(paths?.length ? paths : ["."]), ...exclude.map((g) => `:(exclude,glob)${g}`)];

/** With Writer's token for a remote, as the server runs fetch, push and clone; `signal` stops it. */
async function withAuth(dir: string | undefined, auth: GitAuth | undefined, args: string[], signal?: AbortSignal): Promise<void> {
  try {
    await git(dir, undefined, signal, auth).raw(args);
  } catch (e) {
    throw failure(e);
  }
}

/** Changes as `--raw -z --no-abbrev` lists them. */
function parseRaw(raw: string): Change[] {
  const fields = raw.split("\0").filter(Boolean);
  const changes: Change[] = [];
  for (let i = 0; i < fields.length; ) {
    const head = /^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*$/.exec(fields[i++]!);
    if (!head) continue;
    const status = head[3] as Change["status"];
    if (status === "R" || status === "C") {
      const from = fields[i++]!;
      changes.push({ status, path: fields[i++]!, from, old: head[1]!, new: head[2]! });
    } else changes.push({ status, path: fields[i++]!, old: head[1]!, new: head[2]! });
  }
  return changes;
}

const IN_PROGRESS = ["MERGE_HEAD", "REBASE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"];
const top = (dir: string) => trimmed(dir, ["rev-parse", "--show-toplevel"]);

export const nodeGitPort: GitPort = {
  version: async () => {
    const { major, minor, patch } = await git().version();
    return `git ${major}.${minor}.${patch}`;
  },

  init: async (dir, branch) => void (await run(dir, ["init", "-q", "-b", branch])),
  isRepo: async (dir) => {
    try {
      return await git(dir).checkIsRepo();
    } catch (e) {
      throw failure(e);
    }
  },
  clone: async (url, dest, { auth, onProgress, signal } = {}) => {
    try {
      await git(undefined, onProgress ? ({ stage, progress, processed, total }) => onProgress({ stage, progress, processed, total }) : undefined, signal, auth).clone(url, dest);
    } catch (e) {
      throw failure(e);
    }
  },
  gitDir: (dir) => trimmed(dir, ["rev-parse", "--absolute-git-dir"]),
  prefix: (dir) => trimmed(dir, ["rev-parse", "--show-prefix"]),
  inProgress: async (dir) => {
    const paths = (await out(dir, ["rev-parse", ...IN_PROGRESS.flatMap((p) => ["--git-path", p])])).trim().split("\n");
    if (paths.some((p) => existsSync(resolve(dir, p)))) return true;
    return (await out(dir, ["ls-files", "--unmerged", "--", "."])).trim() !== "";
  },

  resolve: (dir, rev) => orNull(out(dir, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${rev}^{commit}`])),
  currentBranch: (dir) => orNull(out(dir, ["symbolic-ref", "--quiet", "--short", "HEAD"])),
  refs: async (dir, prefixes) =>
    (await out(dir, ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(committerdate:iso-strict)%00%(symref)", ...prefixes]))
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, oid, date, symref] = line.split("\0");
        return { name: name!, oid: oid || null, date: date || null, symref: symref || null };
      })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  tags: async (dir, prefix = "") =>
    (await out(dir, ["for-each-ref", "--sort=refname", "--format=%(refname:strip=2)%00%(creatordate:iso-strict)%00%(*objectname)%00%(objectname)%00%(objecttype)%00%(contents)%1e", `refs/tags/${prefix}`]))
      .split("\x1e")
      .map((r) => r.replace(/^\n/, ""))
      .filter(Boolean)
      .map((r) => {
        const [name, date, peeled, oid, type, ...message] = r.split("\0");
        const annotated = type === "tag";
        return { name: name!, commit: annotated ? peeled! : oid!, annotated, date: date || null, message: annotated ? message.join("\0") : "" };
      }),
  tag: async (dir, name, message, rev = "HEAD") => void (await run(dir, ["tag", "--annotate", "-F", "-", name, rev], { input: message })),
  createBranch: async (dir, name, start, { track = false } = {}) => void (await run(dir, ["switch", "--quiet", track ? "--track" : "--no-track", "-c", name, start])),
  switchBranch: async (dir, name) => void (await run(dir, ["switch", "--quiet", name])),
  deleteBranch: async (dir, name) => void (await run(dir, ["branch", "--quiet", "-D", name])),
  ancestors: async (dir, rev) => (await out(dir, ["rev-list", rev])).split("\n").filter(Boolean),

  getConfig: (dir, key) => orNull(dir === null ? git().raw(["config", "--global", "--get", key]) : out(dir, ["config", "--get", key])),
  setConfig: async (dir, key, value) => {
    if (dir !== null) return void (await run(dir, ["config", key, value]));
    try {
      await git().raw(["config", "--global", key, value]);
    } catch (e) {
      throw failure(e);
    }
  },
  listConfig: async (dir) =>
    (await out(dir, ["config", "--list", "-z"]))
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const nl = entry.indexOf("\n");
        return (nl === -1 ? [entry, ""] : [entry.slice(0, nl), entry.slice(nl + 1)]) as [string, string];
      }),
  remoteUrl: (dir, name) => orNull(out(dir, ["remote", "get-url", name])),
  addRemote: async (dir, name, url) => void (await run(dir, ["remote", "add", name, url])),

  status: async (dir, scope) => {
    const fields = (await out(dir, ["status", "--porcelain", "-z", "--untracked-files=all", ...pathspec(scope)])).split("\0").filter(Boolean);
    // Porcelain paths are the repository's, wherever it runs: made the folder's.
    const prefix = await trimmed(dir, ["rev-parse", "--show-prefix"]);
    const local = (p: string) => (p.startsWith(prefix) ? p.slice(prefix.length) : p);
    const entries: StatusEntry[] = [];
    for (let i = 0; i < fields.length; ) {
      const f = fields[i++]!;
      const entry: StatusEntry = { path: local(f.slice(3)), x: f[0]!, y: f[1]! };
      // A rename entry carries its old path as an extra field.
      if (f[0] === "R" || f[0] === "C") entry.from = local(fields[i++]!);
      entries.push(entry);
    }
    return entries;
  },
  stage: async (dir, scope) => void (await run(dir, ["add", "-A", ...pathspec(scope)])),
  remove: async (dir, paths) => void (await run(dir, ["rm", "-q", "-r", "--", ...paths])),
  listFiles: async (dir, paths) => (await out(dir, ["ls-files", "-z", "--", ...paths])).split("\0").filter(Boolean),
  stagedChanges: async (dir, scope) => parseRaw(await out(dir, ["diff", "--cached", "--raw", "--no-abbrev", "-M", "--relative", "-z", ...pathspec(scope)])),
  commit: async (dir, message, scope) => {
    if (!(await trimmed(dir, ["diff", "--cached", "--name-only", ...pathspec(scope)]))) return null;
    // --no-verify: a background save must not run (or be stopped by) the author's commit hooks.
    await run(dir, ["commit", "--quiet", "--no-verify", "-F", "-", ...pathspec(scope)], { input: message });
    return trimmed(dir, ["rev-parse", "HEAD"]);
  },
  amend: async (dir) => {
    await run(dir, ["commit", "-q", "--amend", "--no-edit", "--no-verify"]);
    return trimmed(dir, ["rev-parse", "HEAD"]);
  },
  commitInfo: async (dir, rev) => {
    const [oid, tree, parents, name, email, authored, committed, ...message] = (await out(dir, ["log", "-1", "--format=%H%x00%T%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%B", "--end-of-options", rev])).split("\0");
    return { oid: oid!, tree: tree!, parents: parents ? parents.split(" ") : [], author: { name: name!, email: email! }, authored: authored!, committed: committed!, message: message.join("\0").replace(/\n$/, "") };
  },
  restore: async (dir, rev, paths) => void (await run(dir, ["restore", `--source=${rev}`, "--staged", "--worktree", "--", ...paths])),
  fastForward: async (dir, rev) => {
    try {
      await gitPlumbing(dir, ["merge", "--ff-only", "--quiet", rev]);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw /not possible to fast-forward/i.test(detail) ? gitFailure("NOT_FAST_FORWARD", detail) : failure(e);
    }
  },

  log: async (dir, { rev = "HEAD", path, limit } = {}) =>
    (await out(dir, ["log", "--format=%H%x00%P%x00%cI%x00%aI%x00%s", ...(limit ? ["-n", String(limit)] : []), "--end-of-options", rev, ...(path ? ["--", path] : [])]))
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [oid, parents, committed, authored, summary] = line.split("\0");
        return { oid: oid!, parents: parents ? parents.split(" ") : [], committed: committed!, authored: authored!, summary: summary ?? "" };
      }),
  history: async (dir, path = ".") => {
    const raw = await out(dir, ["log", "--reverse", "--no-merges", "--root", "-M", "--raw", "-z", "--no-abbrev", "--relative", "--format=%x01%H%x00%aI", "HEAD", "--", path]);
    return raw
      .split("\x01")
      .filter(Boolean)
      .map((record) => {
        const nul = record.indexOf("\0");
        const oid = record.slice(0, nul);
        const rest = record.slice(nul + 1);
        const end = rest.indexOf("\0");
        const authored = (end === -1 ? rest : rest.slice(0, end)).trim();
        return { oid, authored, files: end === -1 ? [] : parseRaw(rest.slice(end + 1).replace(/^\n/, "")) };
      });
  },
  deletions: async (dir, path, limit) =>
    (await out(dir, ["log", "--diff-filter=D", "--name-only", "--relative", "--format=%x1e%H%x1f%cI", "-n", String(limit), "--", path]).catch(() => ""))
      .split("\x1e")
      .filter((r) => r.trim())
      .map((record) => {
        const [head, ...files] = record.trim().split("\n");
        const [oid, committed] = head!.split("\x1f") as [string, string];
        return { oid, committed, files: files.filter(Boolean) };
      }),
  readFile: (dir, rev, path) => run(dir, ["cat-file", "blob", `${rev}:./${path}`]).catch(() => null),
  listTree: async (dir, rev, path) =>
    (await out(dir, ["ls-tree", "-r", "-z", "--end-of-options", rev, ...(path ? ["--", path] : [])]))
      .split("\0")
      .filter(Boolean)
      .map((line): TreeEntry => {
        const tab = line.indexOf("\t");
        const [mode, , oid] = line.slice(0, tab).split(" ");
        return { path: line.slice(tab + 1), mode: mode!, oid: oid! };
      }),
  readBlobs: async (dir, oids) => {
    const blobs = new Map<string, Uint8Array>();
    if (!oids.length) return blobs;
    // cat-file --batch: "<oid> blob <size>\n<bytes>\n" each.
    const data = await run(dir, ["cat-file", "--batch"], { input: `${oids.join("\n")}\n` });
    let at = 0;
    while (at < data.length) {
      const nl = data.indexOf(10, at);
      const [oid, type, size] = data.subarray(at, nl).toString().split(" ");
      at = nl + 1;
      if (type !== "blob") continue;
      blobs.set(oid!, data.subarray(at, at + Number(size)));
      at += Number(size) + 1;
    }
    return blobs;
  },
  count: async (dir, rev) => Number(await trimmed(dir, ["rev-list", "--count", rev])),
  aheadBehind: async (dir, a, b) => {
    const [ahead, behind] = (await trimmed(dir, ["rev-list", "--left-right", "--count", `${a}...${b}`])).split(/\s+/).map(Number);
    return { ahead: ahead!, behind: behind! };
  },
  mergeBase: (dir, a, b) => orNull(out(dir, ["merge-base", a, b])),
  isAncestor: (dir, a, b) =>
    gitPlumbing(dir, ["merge-base", "--is-ancestor", a, b]).then(
      () => true,
      () => false,
    ),

  mergeTrees: async (dir, ours, theirs) => {
    // From the repository's top: merge-tree names paths relative to where it runs.
    const raw = await gitPlumbing(await top(dir), ["merge-tree", "--write-tree", "--name-only", "--no-messages", ours, theirs]).catch((e: unknown) => {
      // Exit 1 means conflicts, with the same output; anything else is a failure.
      const stdout = (e as { stdout?: Buffer }).stdout;
      if (stdout?.length) return stdout;
      throw failure(e);
    });
    const [tree, ...conflicts] = raw.toString().split("\n").filter(Boolean);
    return { tree: tree!, conflicts: [...new Set(conflicts)].sort() };
  },
  buildTree: async (dir, base, edits) => {
    // A temporary index, so the real one and the work tree are untouched.
    const root = await top(dir);
    const index = resolve(dir, await trimmed(dir, ["rev-parse", "--git-path", `ghw-merge-index-${process.pid}`]));
    const env = { GIT_INDEX_FILE: index };
    try {
      await run(root, ["read-tree", base], { env });
      for (const e of edits) {
        if ("remove" in e) await run(root, ["update-index", "--force-remove", "--", e.path], { env });
        else {
          const object = "content" in e ? (await out(root, ["hash-object", "-w", "--stdin", "--path", e.path], { input: e.content })).trim() : e.oid;
          await run(root, ["update-index", "--add", "--cacheinfo", `${e.mode ?? "100644"},${object},${e.path}`], { env });
        }
      }
      return (await out(root, ["write-tree"], { env })).trim();
    } finally {
      await rm(index, { force: true });
    }
  },
  commitTree: async (dir, tree, parents, message) => (await out(dir, ["commit-tree", tree, ...parents.flatMap((p) => ["-p", p]), "-F", "-"], { input: message })).trim(),
  rebase: async (dir, onto) => {
    try {
      await run(dir, ["rebase", "--quiet", "--no-verify", onto]);
      return { conflicts: [] };
    } catch (e) {
      const unmerged = (await out(await top(dir), ["diff", "--name-only", "--diff-filter=U"]).catch(() => "")).split("\n").filter(Boolean);
      await run(dir, ["rebase", "--abort"]).catch(() => {});
      if (!unmerged.length) throw e;
      return { conflicts: unmerged.sort() };
    }
  },

  fetch: (dir, remote, refspecs, { prune = false, auth, signal } = {}) => withAuth(dir, auth, ["fetch", "--quiet", ...(prune ? ["--prune"] : []), remote, ...refspecs], signal),
  push: (dir, remote, refspecs, { setUpstream = false, auth, signal } = {}) => withAuth(dir, auth, ["push", "--quiet", ...(setUpstream ? ["--set-upstream"] : []), remote, ...refspecs], signal),
};

