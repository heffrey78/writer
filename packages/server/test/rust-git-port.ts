import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { gitFailure, type CloneProgress, type GitErrorCode, type GitPort, type TreeEdit } from "../src/git-port/port.ts";

/**
 * The git port over libgit2 (packages/git2-port), for the contract suite on the desktop: its stdio
 * binary, one request per line. On Android the same Rust is called in process instead (#52).
 */

export const BINARY = fileURLToPath(new URL("../../git2-port/target/release/git2-port", import.meta.url));

/** Whether the binary is built (`cargo build --release` in packages/git2-port): the suite runs it where it is. */
export const built = () => existsSync(BINARY);

export function rustGitPort(binary = BINARY): GitPort & { close(): void } {
  let child: ChildProcessWithoutNullStreams | undefined;
  let next = 0;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void; progress?: (p: CloneProgress) => void }>();

  const start = () => {
    const c = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    createInterface({ input: c.stdout }).on("line", (line) => {
      const answer = JSON.parse(line) as { id: number; ok?: unknown; progress?: CloneProgress; err?: { code: GitErrorCode; message: string } };
      const w = waiting.get(answer.id);
      if (answer.progress) return void w?.progress?.(answer.progress);
      waiting.delete(answer.id);
      if (answer.err) w?.reject(gitFailure(answer.err.code, answer.err.message));
      else w?.resolve(answer.ok);
    });
    c.on("exit", () => {
      for (const w of waiting.values()) w.reject(gitFailure("GIT", "git2-port stopped"));
      waiting.clear();
      child = undefined;
    });
    return c;
  };

  const call = <T>(op: string, dir: string | null, args: Record<string, unknown> = {}, progress?: (p: CloneProgress) => void): Promise<T> =>
    new Promise((resolve, reject) => {
      child ??= start();
      const id = ++next;
      waiting.set(id, { resolve: resolve as (v: unknown) => void, reject, ...(progress ? { progress } : {}) });
      child.stdin.write(JSON.stringify({ id, op, dir: dir ?? "", args }) + "\n");
    });
  /** A transfer `signal` can stop: its cancel token, sent to the port when it aborts. */
  const cancellable = (signal: AbortSignal | undefined) => {
    if (!signal) return {};
    const token = `cancel-${++next}`;
    signal.addEventListener("abort", () => void call("cancel", ".", { token }), { once: true });
    return { cancel: token };
  };
  const bytes = (b64: string | null) => (b64 === null ? null : new Uint8Array(Buffer.from(b64, "base64")));
  const edit = (e: TreeEdit) => ("content" in e ? { ...e, content: Buffer.from(e.content).toString("base64") } : e);

  return {
    close: () => child?.kill(),
    version: () => call("version", "."),

    init: (dir, branch) => call("init", dir, { branch }),
    isRepo: (dir) => call("isRepo", dir),
    clone: (url, dest, { auth, onProgress, signal } = {}) => call("clone", dest, { url, ...(auth ? { token: auth.token } : {}), ...cancellable(signal) }, onProgress),
    gitDir: (dir) => call("gitDir", dir),
    prefix: (dir) => call("prefix", dir),
    inProgress: (dir) => call("inProgress", dir),

    resolve: (dir, rev) => call("resolve", dir, { rev }),
    currentBranch: (dir) => call("currentBranch", dir),
    refs: (dir, prefixes) => call("refs", dir, { prefixes }),
    tags: (dir, prefix) => call("tags", dir, prefix ? { prefix } : {}),
    tag: (dir, name, message, rev) => call("tag", dir, { name, message, ...(rev ? { rev } : {}) }),
    createBranch: (dir, name, start, { track = false } = {}) => call("createBranch", dir, { name, start, track }),
    switchBranch: (dir, name) => call("switchBranch", dir, { name }),
    deleteBranch: (dir, name) => call("deleteBranch", dir, { name }),
    ancestors: (dir, rev) => call("ancestors", dir, { rev }),

    getConfig: (dir, key) => call("getConfig", dir, { key }),
    setConfig: (dir, key, value) => call("setConfig", dir, { key, value }),
    listConfig: (dir) => call("listConfig", dir),
    remoteUrl: (dir, name) => call("remoteUrl", dir, { name }),
    addRemote: (dir, name, url) => call("addRemote", dir, { name, url }),

    status: (dir, scope) => call("status", dir, { scope: scope ?? {} }),
    stage: (dir, scope) => call("stage", dir, { scope: scope ?? {} }),
    remove: (dir, paths) => call("remove", dir, { paths }),
    listFiles: (dir, paths) => call("listFiles", dir, { paths }),
    stagedChanges: (dir, scope) => call("stagedChanges", dir, { scope: scope ?? {} }),
    commit: (dir, message, scope) => call("commit", dir, { message, scope: scope ?? {} }),
    amend: (dir) => call("amend", dir),
    commitInfo: (dir, rev) => call("commitInfo", dir, { rev }),
    restore: (dir, rev, paths) => call("restore", dir, { rev, paths }),
    fastForward: (dir, rev) => call("fastForward", dir, { rev }),

    log: (dir, options = {}) => call("log", dir, options),
    history: (dir, path) => call("history", dir, path ? { path } : {}),
    deletions: (dir, path, limit) => call("deletions", dir, { path, limit }),
    readFile: async (dir, rev, path) => bytes(await call<string | null>("readFile", dir, { rev, path })),
    listTree: (dir, rev, path) => call("listTree", dir, { rev, ...(path ? { path } : {}) }),
    readBlobs: async (dir, oids) => new Map(Object.entries(await call<Record<string, string>>("readBlobs", dir, { oids })).map(([k, v]) => [k, new Uint8Array(Buffer.from(v, "base64"))])),
    count: (dir, rev) => call("count", dir, { rev }),
    aheadBehind: (dir, a, b) => call("aheadBehind", dir, { a, b }),
    mergeBase: (dir, a, b) => call("mergeBase", dir, { a, b }),
    isAncestor: (dir, a, b) => call("isAncestor", dir, { a, b }),

    mergeTrees: (dir, ours, theirs) => call("mergeTrees", dir, { ours, theirs }),
    buildTree: (dir, base, edits) => call("buildTree", dir, { base, edits: edits.map(edit) }),
    commitTree: (dir, tree, parents, message) => call("commitTree", dir, { tree, parents, message }),
    rebase: (dir, onto) => call("rebase", dir, { onto }),

    fetch: (dir, remote, refspecs, { prune = false, auth, signal } = {}) => call("fetch", dir, { remote, refspecs, prune, ...(auth ? { token: auth.token } : {}), ...cancellable(signal) }),
    push: (dir, remote, refspecs, { setUpstream = false, auth, signal } = {}) => call("push", dir, { remote, refspecs, setUpstream, ...(auth ? { token: auth.token } : {}), ...cancellable(signal) }),
  };
}
