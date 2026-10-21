import { fromBase64, toBase64 } from "../base64.ts";
import type { CloneProgress, GitPort, TreeEdit } from "./port.ts";

/**
 * The git port over libgit2 (packages/git2-port, D16), whichever way its Rust is reached: its stdio
 * binary for the desktop's contract suite, or in process through Tauri on Android (#52). `call` runs
 * one operation, `{ op, dir, args }`, resolving with its answer or rejecting with a GitFailure, and
 * reports a transfer's progress, if it has any, along the way.
 */
export type Git2Call = (op: string, dir: string, args: Record<string, unknown>, progress?: (p: CloneProgress) => void) => Promise<unknown>;

export function git2GitPort(run: Git2Call): GitPort {
  let next = 0;
  const call = <T>(op: string, dir: string | null, args: Record<string, unknown> = {}, progress?: (p: CloneProgress) => void) => run(op, dir ?? "", args, progress) as Promise<T>;
  /** A transfer `signal` can stop: its cancel token, sent to the port when it aborts. */
  const cancellable = (signal: AbortSignal | undefined) => {
    if (!signal) return {};
    const token = `cancel-${++next}`;
    signal.addEventListener("abort", () => void call("cancel", ".", { token }), { once: true });
    return { cancel: token };
  };
  const bytes = (b64: string | null) => (b64 === null ? null : fromBase64(b64));
  const edit = (e: TreeEdit) => ("content" in e ? { ...e, content: toBase64(typeof e.content === "string" ? new TextEncoder().encode(e.content) : e.content) } : e);

  return {
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
    readBlobs: async (dir, oids) => new Map(Object.entries(await call<Record<string, string>>("readBlobs", dir, { oids })).map(([k, v]) => [k, fromBase64(v)])),
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
