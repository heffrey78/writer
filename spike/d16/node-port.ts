import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyGitError, git, gitPlumbing } from "../../packages/server/src/git.ts";
import { GitPortError, type Auth, type Change, type GitPort, type StatusEntry, type TreeEntry } from "./port.ts";

/** The port over the git the server runs today, with the commands and flags the server uses. */

const failure = (e: unknown): GitPortError => {
  const text = e instanceof Error ? e.message : String(e);
  if (/Not possible to fast-forward|not possible to fast-forward/i.test(text)) return new GitPortError("NOT_FAST_FORWARD", text);
  const f = classifyGitError(e);
  return new GitPortError(f.code === "BAD_REPO" || f.code === "GIT_MISSING" ? "GIT" : f.code, f.detail || f.message);
};

async function run(dir: string, args: string[], options: { input?: string | Buffer; env?: Record<string, string> } = {}): Promise<Buffer> {
  try {
    return await gitPlumbing(dir, args, options);
  } catch (e) {
    throw failure(e);
  }
}

const text = async (dir: string, args: string[], options?: { input?: string | Buffer; env?: Record<string, string> }) => (await run(dir, args, options)).toString();
const trimmed = async (dir: string, args: string[]) => (await text(dir, args)).trim();
const orNull = async (p: Promise<string>) => (await p.catch(() => "")).trim() || null;

/** With Writer's token for a remote: as the server runs fetch, push and clone. */
async function remoteGit(dir: string | undefined, url: string, auth: Auth | undefined, args: string[]): Promise<void> {
  const origin = /^https?:/.test(url) ? new URL(url).origin : undefined;
  try {
    await git(dir, undefined, undefined, auth && origin ? { origin, token: auth.token } : undefined).raw(args);
  } catch (e) {
    throw failure(e);
  }
}

function parseChanges(out: string): Change[] {
  const fields = out.split("\0").filter(Boolean);
  const changes: Change[] = [];
  for (let i = 0; i < fields.length; ) {
    const head = fields[i++]!;
    // A --raw line: ":old-mode new-mode old new status"; --name-status gives the status alone.
    const raw = /^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*$/.exec(head);
    const status = (raw ? raw[3] : head[0]) as Change["status"];
    const [old, now] = raw ? [raw[1]!, raw[2]!] : ["", ""];
    if (status === "R" || status === "C") {
      const from = fields[i++]!;
      changes.push({ status, path: fields[i++]!, from, old, new: now });
    } else changes.push({ status, path: fields[i++]!, old, new: now });
  }
  return changes;
}

export const nodePort: GitPort = {
  name: "git",
  version: async () => (await trimmed(".", ["version"])).replace(/^git version /, "git "),

  init: async (dir, branch) => void (await run(".", ["init", "-q", "-b", branch, dir])),
  isRepo: (dir) => git(dir).checkIsRepo(),
  clone: (url, dest, auth) => remoteGit(undefined, url, auth, ["clone", url, dest]),

  resolve: (dir, rev) => orNull(text(dir, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`])),
  currentBranch: (dir) => orNull(text(dir, ["symbolic-ref", "--quiet", "--short", "HEAD"])),
  refs: async (dir, prefix) =>
    (await text(dir, ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(committerdate:iso-strict)%00%(symref)", prefix]))
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, oid, date, symref] = line.split("\0");
        return { name: name!, oid: oid || null, date: date || null, symref: symref || null };
      })
      .sort((a, b) => (a.name < b.name ? -1 : 1)),
  tags: async (dir) =>
    (await text(dir, ["for-each-ref", "--sort=refname", "--format=%(refname:strip=2)%00%(creatordate:iso-strict)%00%(*objectname)%00%(objectname)%00%(objecttype)%00%(contents)%1e", "refs/tags"]))
      .split("\x1e")
      .map((r) => r.replace(/^\n/, ""))
      .filter(Boolean)
      .map((r) => {
        const [name, date, peeled, oid, type, ...message] = r.split("\0");
        const annotated = type === "tag";
        return { name: name!, commit: annotated ? peeled! : oid!, annotated, date: date || null, message: annotated ? message.join("\0") : "" };
      }),
  createBranch: async (dir, name, from, track) => void (await run(dir, ["switch", "--quiet", ...(track ? ["--track", "-c", name, track] : ["--no-track", "-c", name, from])])),
  switchBranch: async (dir, name) => void (await run(dir, ["switch", "--quiet", name])),
  deleteBranch: async (dir, name) => void (await run(dir, ["branch", "--quiet", "-D", name])),
  tag: async (dir, name, message) => void (await run(dir, ["tag", "--annotate", "-F", "-", name], { input: message })),

  getConfig: (dir, key) => orNull(text(dir, ["config", "--get", key])),
  setConfig: async (dir, key, value) => void (await run(dir, ["config", key, value])),
  remoteUrl: (dir, name) => orNull(text(dir, ["remote", "get-url", name])),
  addRemote: async (dir, name, url) => void (await run(dir, ["remote", "add", name, url])),

  status: async (dir) => {
    const fields = (await text(dir, ["status", "--porcelain", "-z", "--untracked-files=all"])).split("\0").filter(Boolean);
    const out: StatusEntry[] = [];
    for (let i = 0; i < fields.length; ) {
      const f = fields[i++]!;
      const entry: StatusEntry = { path: f.slice(3), x: f[0]!, y: f[1]! };
      if (f[0] === "R" || f[0] === "C") entry.from = fields[i++]!;
      out.push(entry);
    }
    return out.sort((a, b) => (a.path < b.path ? -1 : 1));
  },
  stage: async (dir, paths) => void (await run(dir, ["add", "-A", "--", ...(paths?.length ? paths : ["."])])),
  remove: async (dir, paths) => void (await run(dir, ["rm", "-q", "-r", "--", ...paths])),
  stagedChanges: async (dir) => parseChanges(await text(dir, ["diff", "--cached", "--raw", "--no-abbrev", "-M", "-z"])),
  commit: async (dir, message, options) => {
    await run(dir, options?.amend ? ["commit", "-q", "--amend", "--no-edit"] : ["commit", "--quiet", "--no-verify", "-F", "-"], options?.amend ? {} : { input: message });
    return trimmed(dir, ["rev-parse", "HEAD"]);
  },
  commitInfo: async (dir, rev) => {
    const [oid, tree, parents, name, email, authored, committed, ...message] = (await text(dir, ["log", "-1", "--format=%H%x00%T%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%B", rev])).split("\0");
    return { oid: oid!, tree: tree!, parents: parents ? parents.split(" ") : [], author: { name: name!, email: email! }, authored: authored!, committed: committed!, message: message.join("\0").replace(/\n$/, "") };
  },
  restore: async (dir, rev, paths) => void (await run(dir, ["restore", `--source=${rev}`, "--staged", "--worktree", "--", ...paths])),
  fastForward: async (dir, rev) => void (await run(dir, ["merge", "--ff-only", "--quiet", rev])),

  log: async (dir, options = {}) =>
    (await text(dir, ["log", "--format=%H%x00%P%x00%cI%x00%aI%x00%s", ...(options.limit ? ["-n", String(options.limit)] : []), options.rev ?? "HEAD", ...(options.path ? ["--", options.path] : [])]))
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [oid, parents, committed, authored, summary] = line.split("\0");
        return { oid: oid!, parents: parents ? parents.split(" ") : [], committed: committed!, authored: authored!, summary: summary! };
      }),
  history: async (dir) => {
    const out = await text(dir, ["log", "--reverse", "--no-merges", "--root", "-M", "--raw", "-z", "--no-abbrev", "--format=%x01%H%x00%aI"]);
    return out
      .split("\x01")
      .filter(Boolean)
      .map((record) => {
        const [oid, rest] = [record.slice(0, 40), record.slice(41)];
        const nul = rest.indexOf("\0");
        const authored = rest.slice(0, nul === -1 ? undefined : nul).trim();
        return { oid, authored, files: nul === -1 ? [] : parseChanges(rest.slice(nul + 1).replace(/^\n/, "")) };
      });
  },
  readFile: async (dir, rev, path) => run(dir, ["cat-file", "blob", `${rev}:${path}`]).catch(() => null),
  listTree: async (dir, rev, path) => {
    const out = (await text(dir, ["ls-tree", "-r", "-z", rev, ...(path ? ["--", path] : [])])).split("\0").filter(Boolean);
    return out.map((line): TreeEntry => {
      const [meta, p] = line.split("\t");
      const [mode, , oid] = meta!.split(" ");
      return { path: p!, mode: mode!, oid: oid! };
    });
  },
  readBlobs: async (dir, oids) => {
    // cat-file --batch: "<oid> blob <size>\n<bytes>\n" each.
    const out = await run(dir, ["cat-file", "--batch"], { input: oids.join("\n") + "\n" });
    const blobs = new Map<string, Buffer>();
    let at = 0;
    while (at < out.length) {
      const nl = out.indexOf(10, at);
      const [oid, type, size] = out.subarray(at, nl).toString().split(" ");
      at = nl + 1;
      if (type !== "blob") continue;
      blobs.set(oid!, out.subarray(at, at + Number(size)));
      at += Number(size) + 1;
    }
    return blobs;
  },
  count: async (dir, rev) => Number(await trimmed(dir, ["rev-list", "--count", rev])),
  aheadBehind: async (dir, a, b) => {
    const [ahead, behind] = (await trimmed(dir, ["rev-list", "--left-right", "--count", `${a}...${b}`])).split(/\s+/).map(Number);
    return { ahead: ahead!, behind: behind! };
  },
  mergeBase: (dir, a, b) => orNull(text(dir, ["merge-base", a, b])),
  isAncestor: async (dir, a, b) =>
    run(dir, ["merge-base", "--is-ancestor", a, b]).then(
      () => true,
      () => false,
    ),

  mergeTrees: async (dir, ours, theirs) => {
    const out = (
      await gitPlumbing(dir, ["merge-tree", "--write-tree", "--name-only", "--no-messages", ours, theirs]).catch((e: unknown) => {
        const stdout = (e as { stdout?: Buffer }).stdout;
        if (stdout?.length) return stdout;
        throw failure(e);
      })
    )
      .toString()
      .split("\n")
      .filter(Boolean);
    const [tree, ...conflicts] = out;
    return { tree: tree!, conflicts: [...new Set(conflicts)].sort() };
  },
  buildTree: async (dir, base, edits) => {
    const index = join(await mkdtemp(join(tmpdir(), "ghw-index-")), "index");
    const env = { GIT_INDEX_FILE: index };
    try {
      await run(dir, ["read-tree", base], { env });
      for (const e of edits) {
        if ("remove" in e) await run(dir, ["update-index", "--force-remove", "--", e.path], { env });
        else {
          const object = "content" in e ? (await text(dir, ["hash-object", "-w", "--stdin", "--path", e.path], { input: e.content })).trim() : e.oid;
          await run(dir, ["update-index", "--add", "--cacheinfo", `${e.mode ?? "100644"},${object},${e.path}`], { env });
        }
      }
      return (await text(dir, ["write-tree"], { env })).trim();
    } finally {
      await rm(join(index, ".."), { recursive: true, force: true });
    }
  },
  commitTree: async (dir, tree, parents, message) => (await text(dir, ["commit-tree", tree, ...parents.flatMap((p) => ["-p", p]), "-F", "-"], { input: message })).trim(),
  rebase: async (dir, onto) => {
    try {
      await run(dir, ["rebase", "--quiet", "--no-verify", onto]);
      return { conflicts: [] };
    } catch (e) {
      const unmerged = (await text(dir, ["diff", "--name-only", "--diff-filter=U"]).catch(() => "")).split("\n").filter(Boolean);
      await run(dir, ["rebase", "--abort"]).catch(() => {});
      if (!unmerged.length) throw e;
      return { conflicts: unmerged.sort() };
    }
  },

  fetch: async (dir, remote, refspecs, options = {}) => {
    const url = (await trimmed(dir, ["remote", "get-url", remote]).catch(() => remote)) || remote;
    await remoteGit(dir, url, options.auth, ["fetch", "--quiet", ...(options.prune ? ["--prune"] : []), remote, ...refspecs]);
  },
  push: async (dir, remote, refspecs, options = {}) => {
    const url = (await trimmed(dir, ["remote", "get-url", remote]).catch(() => remote)) || remote;
    await remoteGit(dir, url, options.auth, ["push", "--quiet", ...(options.setUpstream ? ["--set-upstream"] : []), remote, ...refspecs]);
  },
};
