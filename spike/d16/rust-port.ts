import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { GitPortError, type GitPort, type GitPortCode, type TreeEdit } from "./port.ts";

/**
 * The port over libgit2 (spike/d16/git2-port), one request per line on the binary's stdin. On Android
 * the same Rust would be called in process, from a Tauri command; this is only the test's way in.
 */

export const BINARY = fileURLToPath(new URL("./git2-port/target/release/git2-port", import.meta.url));

export function rustPort(binary = BINARY): GitPort & { close(): void } {
  let child: ChildProcessWithoutNullStreams | undefined;
  let next = 0;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

  const start = () => {
    const c = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    createInterface({ input: c.stdout }).on("line", (line) => {
      const answer = JSON.parse(line) as { id: number; ok?: unknown; err?: { code: GitPortCode; message: string } };
      const w = waiting.get(answer.id);
      waiting.delete(answer.id);
      if (answer.err) w?.reject(new GitPortError(answer.err.code, answer.err.message));
      else w?.resolve(answer.ok);
    });
    c.on("exit", () => {
      for (const w of waiting.values()) w.reject(new GitPortError("GIT", "git2-port stopped"));
      waiting.clear();
      child = undefined;
    });
    return c;
  };

  const call = <T>(op: string, dir: string, args: Record<string, unknown> = {}): Promise<T> =>
    new Promise((resolve, reject) => {
      child ??= start();
      const id = ++next;
      waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      child.stdin.write(JSON.stringify({ id, op, dir, args }) + "\n");
    });
  const bytes = (b64: string | null) => (b64 === null ? null : Buffer.from(b64, "base64"));
  const edit = (e: TreeEdit) => ("content" in e ? { ...e, content: e.content.toString("base64") } : e);

  return {
    name: "git2",
    close: () => child?.kill(),
    version: () => call("version", "."),

    init: (dir, branch) => call("init", dir, { branch }),
    isRepo: (dir) => call("isRepo", dir),
    clone: (url, dest, auth) => call("clone", dest, { url, ...(auth ? { token: auth.token } : {}) }),

    resolve: (dir, rev) => call("resolve", dir, { rev }),
    currentBranch: (dir) => call("currentBranch", dir),
    refs: (dir, prefix) => call("refs", dir, { prefix }),
    tags: (dir) => call("tags", dir),
    createBranch: (dir, name, from, track) => call("createBranch", dir, { name, from, ...(track ? { track } : {}) }),
    switchBranch: (dir, name) => call("switchBranch", dir, { name }),
    deleteBranch: (dir, name) => call("deleteBranch", dir, { name }),
    tag: (dir, name, message) => call("tag", dir, { name, message }),

    getConfig: (dir, key) => call("getConfig", dir, { key }),
    setConfig: (dir, key, value) => call("setConfig", dir, { key, value }),
    remoteUrl: (dir, name) => call("remoteUrl", dir, { name }),
    addRemote: (dir, name, url) => call("addRemote", dir, { name, url }),

    status: (dir) => call("status", dir),
    stage: (dir, paths) => call("stage", dir, { paths: paths ?? [] }),
    remove: (dir, paths) => call("remove", dir, { paths }),
    stagedChanges: (dir) => call("stagedChanges", dir),
    commit: (dir, message, options) => call("commit", dir, { message, amend: options?.amend ?? false }),
    commitInfo: (dir, rev) => call("commitInfo", dir, { rev }),
    restore: (dir, rev, paths) => call("restore", dir, { rev, paths }),
    fastForward: (dir, rev) => call("fastForward", dir, { rev }),

    log: (dir, options = {}) => call("log", dir, options),
    history: (dir) => call("history", dir),
    readFile: async (dir, rev, path) => bytes(await call<string | null>("readFile", dir, { rev, path })),
    listTree: (dir, rev, path) => call("listTree", dir, { rev, ...(path ? { path } : {}) }),
    readBlobs: async (dir, oids) => new Map(Object.entries(await call<Record<string, string>>("readBlobs", dir, { oids })).map(([k, v]) => [k, Buffer.from(v, "base64")])),
    count: (dir, rev) => call("count", dir, { rev }),
    aheadBehind: (dir, a, b) => call("aheadBehind", dir, { a, b }),
    mergeBase: (dir, a, b) => call("mergeBase", dir, { a, b }),
    isAncestor: (dir, a, b) => call("isAncestor", dir, { a, b }),

    mergeTrees: (dir, ours, theirs) => call("mergeTrees", dir, { ours, theirs }),
    buildTree: (dir, base, edits) => call("buildTree", dir, { base, edits: edits.map(edit) }),
    commitTree: (dir, tree, parents, message) => call("commitTree", dir, { tree, parents, message }),
    rebase: (dir, onto) => call("rebase", dir, { onto }),

    fetch: (dir, remote, refspecs, options = {}) => call("fetch", dir, { remote, refspecs, prune: options.prune ?? false, ...(options.auth ? { token: options.auth.token } : {}) }),
    push: (dir, remote, refspecs, options = {}) => call("push", dir, { remote, refspecs, setUpstream: options.setUpstream ?? false, ...(options.auth ? { token: options.auth.token } : {}) }),
  };
}
