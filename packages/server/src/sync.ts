import { CHECKPOINT_PREFIX } from "./checkpoints.ts";
import { operationInProgress, type Committer } from "./committer.ts";
import { commitMerge, ConflictError, openConflicts, prepareMerge, type Conflicts, type FileResolution, type PreparedMerge } from "./conflicts.ts";
import { GitFailure, gitFailure, type GitAuth, type GitAuthSource } from "./git-port/port.ts";
import { gitPort } from "./ports.ts";
import { discardedVersions, setDiscardedVersions, VERSION_PREFIX } from "./versions.ts";

export interface SyncerOptions {
  /** Sync this often (ms), and once when the novel is opened. Default 5 minutes; 0 syncs only on demand. */
  intervalMs?: number;
  /** First retry after a network failure (ms), doubling up to `intervalMs`. Default 15 s. */
  retryMs?: number;
  /** Timer source: tests pass a fake clock. Returns a cancel function. */
  schedule?: (fn: () => void, ms: number) => () => void;
}

/**
 * local: no remote to sync with. syncing: a sync is under way. synced: up to date with the remote.
 * ahead / behind: commits not yet pushed / not yet brought in. offline: the remote couldn't be reached
 * (retried by itself). needs-sign-in: the remote refused the credentials. conflict: the remote has
 * changes that clash with local ones (for the resolver, heffrey78/gh-writer#47). error: anything else.
 */
export type SyncState = "local" | "syncing" | "synced" | "ahead" | "behind" | "offline" | "needs-sign-in" | "conflict" | "error";

export type SyncErrorCode = "DETACHED" | "BUSY" | GitFailure["code"];

export interface SyncStatus {
  state: SyncState;
  /** The remote synced with (e.g. "origin"), and the local branch. */
  remote: string | null;
  branch: string | null;
  /** Local commits the remote doesn't have, and remote commits not brought in, as of the last fetch. */
  ahead: number;
  behind: number;
  /** When the last sync finished cleanly (ISO), or null. */
  lastSync: string | null;
  /** The novel's files changed on both sides, relative to the novel's folder. */
  conflict?: { files: string[] };
  error?: { code: SyncErrorCode; message: string; detail?: string };
}

interface Target {
  remote: string;
  branch: string;
  /** The branch on the remote, e.g. refs/heads/main. */
  mergeRef: string;
  /** Its remote-tracking ref, e.g. refs/remotes/origin/main. */
  tracking: string;
  /** Whether the branch already tracks it (otherwise the first push sets that up). */
  upstream: boolean;
  /** The remote's configured fetch refspecs. */
  fetch: string[];
}

// Checkpoint tags travel with every sync. A remote checkpoint replaces a local one of the same name (made
// in the same second with the same name on two machines), rather than stopping every sync after it.
const FETCH_CHECKPOINTS = `+${CHECKPOINT_PREFIX}*:${CHECKPOINT_PREFIX}*`;
const PUSH_CHECKPOINTS = `${CHECKPOINT_PREFIX}*:${CHECKPOINT_PREFIX}*`;

type Outcome =
  | { kind: "ok" }
  | { kind: "local" }
  | { kind: "conflict"; files: string[] }
  | { kind: "failed"; state: "offline" | "needs-sign-in" | "error"; error: NonNullable<SyncStatus["error"]> };

class SyncFailure extends Error {
  readonly code: "DETACHED" | "BUSY";

  constructor(code: "DETACHED" | "BUSY", message: string) {
    super(message);
    this.code = code;
  }
}

/** A push refused because the remote moved is retried after bringing its changes in, this many times. */
const PUSH_ATTEMPTS = 3;

const realSchedule = (fn: () => void, ms: number) => {
  const timer = setTimeout(fn, ms);
  timer.unref();
  return () => clearTimeout(timer);
};

export interface SyncerDeps {
  /** Saved work is committed before each sync. */
  committer?: Committer;
  /** Runs the step that changes the work tree with writes to the novel and background commits held off. Default: commits only. */
  exclusive?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Writer's GitHub credentials for the remote's URL, if any (otherwise git uses the author's own). */
  auth?: GitAuthSource;
  /** The remote refused Writer's credentials: the connection should check whether they still hold. */
  onAuthRefused?: () => void;
  /** Writer's sign-in for the remote's URL was refused earlier and forgotten: a refusal without credentials is that, too. */
  signInRefused?: (url: string) => boolean;
}

/**
 * Keeps a novel in step with its remote: every `intervalMs` and on demand it commits saved work, fetches,
 * brings remote changes in (fast-forward, or rebasing local commits onto them for a linear history), and
 * pushes. One sync runs at a time. Files git can't merge are merged again paragraph by paragraph
 * (core's merge3) into a merge commit. When the same paragraph or field changed on both sides, nothing
 * in the work tree is touched: the status is `conflict`, with the files, and local commits are kept
 * until the author settles it (`conflicts()`, `resolve()`).
 */
export class Syncer {
  readonly root: string;
  #committer: Committer | undefined;
  #exclusive: NonNullable<SyncerDeps["exclusive"]>;
  #auth: SyncerDeps["auth"];
  #onAuthRefused: SyncerDeps["onAuthRefused"];
  #signInRefused: SyncerDeps["signInRefused"];
  #intervalMs: number;
  #retryMs: number;
  #schedule: NonNullable<SyncerOptions["schedule"]>;
  #cancelNext?: () => void;
  #running: Promise<SyncStatus> | undefined;
  #syncing = false;
  #abort: AbortController | undefined;
  #closed = false;
  #target: Target | null | undefined;
  #outcome: Outcome | undefined;
  #failures = 0;
  #lastSync: string | null = null;
  #listeners = new Set<() => void>();
  /** Checkpoints made, and how many of them the last push carried: the first sync pushes any from before. */
  #tagsMade = 0;
  #tagsPushed = -1;

  constructor(root: string, { intervalMs = 300_000, retryMs = 15_000, schedule = realSchedule }: SyncerOptions = {}, { committer, exclusive, auth, onAuthRefused, signInRefused }: SyncerDeps = {}) {
    this.root = root;
    this.#committer = committer;
    this.#auth = auth;
    this.#onAuthRefused = onAuthRefused;
    this.#signInRefused = signInRefused;
    this.#exclusive = exclusive ?? ((fn) => (committer ? committer.hold(fn) : fn()));
    this.#intervalMs = intervalMs;
    this.#retryMs = retryMs;
    this.#schedule = schedule;
  }

  /** Sync now, then every interval (unless syncing only on demand). */
  start(): void {
    if (this.#intervalMs > 0) void this.sync();
  }

  /**
   * Sync from scratch: after a sync already under way (which may have started before a change it must
   * see, such as a new remote), another one.
   */
  async syncAgain(): Promise<SyncStatus> {
    await this.#running?.catch(() => {});
    return this.sync();
  }

  /** Sync now. A sync already under way is joined, not repeated. Resolves with the status after it. */
  sync(): Promise<SyncStatus> {
    if (this.#closed) return this.status();
    // The next sync is scheduled once this one has let go, so its timer can never join a finished run.
    this.#running ??= this.#run().finally(() => {
      this.#running = undefined;
      if (!this.#closed && this.#intervalMs > 0) this.#cancelNext = this.#schedule(() => void this.sync(), this.#nextDelay());
    });
    return this.#running;
  }

  /** A checkpoint was made: the next sync pushes it, even with no commits to push. */
  tagsChanged(): void {
    this.#tagsMade++;
  }

  /**
   * Another version was opened, or one made or discarded: the branch to sync is looked up afresh, and
   * (unless syncing only on demand) a sync carries the change to the remote.
   */
  branchChanged(): void {
    this.#target = undefined;
    this.#outcome = undefined;
    if (this.#intervalMs > 0) void this.syncAgain();
    else this.#changed();
  }

  /** What the author has to settle, merged afresh against the remote as last fetched; null without a conflict. */
  async conflicts(): Promise<Conflicts | null> {
    const target = this.#target;
    if (this.#outcome?.kind !== "conflict" || !target) return null;
    return openConflicts(await prepareMerge(this.root, target.tracking));
  }

  /**
   * Settle the conflicts shown for remote commit `upstream`: commit the merge with `resolutions` (by
   * path in the novel), then sync to push it. Refused as STALE when the remote has moved, or a file
   * changed, since the conflicts were read.
   */
  async resolve(upstream: string, resolutions: Record<string, FileResolution>): Promise<SyncStatus> {
    const target = this.#target;
    if (this.#outcome?.kind !== "conflict" || !target) throw new ConflictError("NO_CONFLICT", "There's no conflict to resolve.");
    await this.#exclusive(async () => {
      await this.#committer?.commit();
      const prepared = await prepareMerge(this.root, target.tracking);
      if (prepared.upstream !== upstream) throw new ConflictError("STALE", "The remote has changed again since the conflict was shown.");
      await commitMerge(this.root, prepared, resolutions, mergeMessage(target.remote, prepared, "resolved"));
    });
    return this.sync();
  }

  /** Called when the status may have changed. Returns a function that removes it. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  async status(): Promise<SyncStatus> {
    // Not synced yet (on demand only): counts as of the last fetch, whoever made it.
    if (this.#target === undefined && !this.#syncing) this.#target = await this.#resolveTarget().catch(() => undefined);
    const target = this.#target;
    const { ahead, behind } = target ? await this.#counts(target).catch(() => ({ ahead: 0, behind: 0 })) : { ahead: 0, behind: 0 };
    const outcome = this.#outcome;
    let state: SyncState;
    if (this.#syncing) state = "syncing";
    else if (outcome?.kind === "conflict") state = "conflict";
    else if (outcome?.kind === "failed") state = outcome.state;
    else if (outcome?.kind === "local" || target === null) state = "local";
    else state = ahead ? "ahead" : behind ? "behind" : "synced";
    return {
      state,
      remote: target?.remote ?? null,
      branch: target?.branch ?? null,
      ahead,
      behind,
      lastSync: this.#lastSync,
      ...(outcome?.kind === "conflict" ? { conflict: { files: outcome.files } } : {}),
      ...(outcome?.kind === "failed" ? { error: outcome.error } : {}),
    };
  }

  /** Stop syncing: a fetch or push under way is cut short; bringing changes in is let finish. */
  async close(): Promise<void> {
    this.#closed = true;
    this.#cancelNext?.();
    this.#abort?.abort();
    await this.#running?.catch(() => {});
  }

  async #run(): Promise<SyncStatus> {
    this.#cancelNext?.();
    this.#syncing = true;
    this.#changed();
    this.#abort = new AbortController();
    try {
      this.#outcome = await this.#attempt(this.#abort.signal);
      if (this.#outcome.kind === "ok") this.#lastSync = new Date().toISOString();
    } catch (e) {
      this.#outcome = this.#failure(e);
    } finally {
      this.#abort = undefined;
      this.#syncing = false;
    }
    // Consecutive network failures, for the backoff.
    this.#failures = this.#offline() ? this.#failures + 1 : 0;
    this.#changed();
    return this.status();
  }

  async #attempt(signal: AbortSignal): Promise<Outcome> {
    const target = await this.#resolveTarget();
    this.#target = target;
    if (!target) return { kind: "local" };
    // Network steps can be cut short by close(); the work-tree step can't, so it never stops halfway.
    const url = (await gitPort().remoteUrl(this.root, target.remote).catch(() => null)) ?? "";
    const auth = url ? await this.#auth?.(url) : undefined;
    const remote: Transfer = { signal, ...(auth ? { auth } : {}) };
    await this.#committer?.commit();
    try {
      return await this.#exchange(target, remote);
    } catch (e) {
      const failure = asFailure(e);
      if (failure.code === "AUTH" && (auth || this.#signInRefused?.(url))) {
        if (auth) this.#onAuthRefused?.();
        throw new GitFailure("AUTH", "GitHub didn't accept Writer's sign-in for this repository: it may have been revoked, or your account can't push to it. Connect to GitHub again, or check your access.", failure.detail);
      }
      throw e;
    }
  }

  async #exchange(target: Target, remote: Transfer): Promise<Outcome> {
    const git = gitPort();
    for (let attempt = 1; ; attempt++) {
      // The configured refspecs are named because naming any refspec replaces them.
      await git.fetch(this.root, target.remote, [...target.fetch, FETCH_CHECKPOINTS], remote);
      await this.#pruneVersions(target, remote);
      const conflict = await this.#exclusive(() => this.#integrate(target));
      if (conflict) return { kind: "conflict", files: conflict };
      const { ahead } = await this.#counts(target);
      const tags = this.#tagsMade;
      const pushTags = this.#tagsPushed < tags;
      const deletes = await this.#versionDeletes(target);
      if (!ahead && !pushTags && !deletes.length) return { kind: "ok" };
      try {
        const refs = [`HEAD:${target.mergeRef}`, ...(pushTags ? [PUSH_CHECKPOINTS] : []), ...deletes.map((b) => `:refs/heads/${b}`)];
        await git.push(this.root, target.remote, refs, { ...remote, setUpstream: !target.upstream });
        target.upstream = true;
        this.#tagsPushed = tags;
        if (deletes.length) await setDiscardedVersions(this.root, []);
        return { kind: "ok" };
      } catch (e) {
        const failure = asFailure(e);
        // The remote moved during the sync: bring its changes in and push again.
        if (failure.code !== "REJECTED" || attempt >= PUSH_ATTEMPTS) throw failure;
      }
    }
  }

  /** Bring the remote's changes into the work tree. Returns the conflicting files, if any (nothing touched then). */
  async #integrate(target: Target): Promise<string[] | undefined> {
    const git = gitPort();
    // Work saved while fetching.
    await this.#committer?.commit();
    if (await operationInProgress(this.root)) {
      throw new SyncFailure("BUSY", "A merge or rebase is in progress in this repository; sync will resume once it's finished.");
    }
    const { ahead, behind } = await this.#counts(target);
    if (!behind) return undefined;
    if (!ahead) {
      await git.fastForward(this.root, target.tracking);
      return undefined;
    }
    // Merge in memory first, so that a conflict leaves the work tree (and the editor) untouched.
    const prepared = await prepareMerge(this.root, target.tracking);
    if (prepared.files.length) {
      const open = openConflicts(prepared).files;
      if (open.length) return open.map((f) => f.path);
      // merge3 settled what git couldn't: a merge commit, since a rebase would stop at git's conflict.
      await commitMerge(this.root, prepared, {}, mergeMessage(target.remote, prepared, "merged paragraph by paragraph"));
      return undefined;
    }
    // A clean merge of the tips can still conflict commit by commit (the rebase undoes itself): merge the tips instead.
    if ((await git.rebase(this.root, target.tracking)).conflicts.length) await commitMerge(this.root, prepared, {}, mergeMessage(target.remote, prepared, "merged"));
    return undefined;
  }

  /** Versions discarded here that are still on the remote, by branch; the rest are forgotten. */
  async #versionDeletes(target: Target): Promise<string[]> {
    const discarded = await discardedVersions(this.root);
    if (!discarded.length) return [];
    const onRemote: string[] = [];
    for (const branch of discarded) {
      // The open version is never deleted from under the author (it was opened again since).
      if (branch === target.branch) continue;
      if (await gitPort().resolve(this.root, `refs/remotes/${target.remote}/${branch}`)) onRemote.push(branch);
    }
    if (!onRemote.length) await setDiscardedVersions(this.root, []);
    return onRemote;
  }

  /**
   * Forget versions deleted on the remote (discarded on another computer). A fetch of the version
   * branches alone, so pruning can't touch checkpoints made here and not yet pushed.
   */
  async #pruneVersions(target: Target, remote: Transfer): Promise<void> {
    const tracking = `refs/remotes/${target.remote}/${VERSION_PREFIX}`;
    const any = (await gitPort().refs(this.root, [tracking]).catch(() => [])).length > 0;
    if (any) await gitPort().fetch(this.root, target.remote, [`+refs/heads/${VERSION_PREFIX}*:${tracking}*`], { ...remote, prune: true });
  }

  async #resolveTarget(): Promise<Target | null> {
    const git = gitPort();
    const branch = await git.currentBranch(this.root).catch(() => null);
    if (!branch) throw new SyncFailure("DETACHED", "This copy isn't on a branch (detached HEAD), so it can't sync. Check out a branch first.");
    const config = await git.listConfig(this.root).catch(() => [] as [string, string][]);
    const get = (key: string) => config.findLast(([k]) => k === key)?.[1] ?? "";
    const remotes = [...new Set(config.map(([k]) => /^remote\.(.+)\.url$/.exec(k)?.[1]).filter((r): r is string => r !== undefined))];
    const configured = get(`branch.${branch}.remote`);
    const remote = remotes.includes(configured) ? configured : remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0]! : "";
    if (!remote) return null;
    const upstream = remote === configured && get(`branch.${branch}.merge`) !== "";
    const mergeRef = (upstream && get(`branch.${branch}.merge`)) || `refs/heads/${branch}`;
    const configuredFetch = config.filter(([k]) => k === `remote.${remote}.fetch`).map(([, v]) => v);
    const fetch = configuredFetch.length ? configuredFetch : [`+refs/heads/*:refs/remotes/${remote}/*`];
    return { remote, branch, mergeRef, tracking: `refs/remotes/${remote}/${mergeRef.replace(/^refs\/heads\//, "")}`, upstream, fetch };
  }

  async #counts(target: Target): Promise<{ ahead: number; behind: number }> {
    const git = gitPort();
    // Nothing on the remote yet: every local commit is ahead.
    if (!(await git.resolve(this.root, target.tracking))) return { ahead: await git.count(this.root, "HEAD"), behind: 0 };
    return git.aheadBehind(this.root, "HEAD", target.tracking);
  }

  #offline(): boolean {
    return this.#outcome?.kind === "failed" && this.#outcome.state === "offline";
  }

  /** The normal interval, or while offline a retry that backs off from `retryMs` up to it. */
  #nextDelay(): number {
    return this.#offline() ? Math.min(this.#retryMs * 2 ** (this.#failures - 1), this.#intervalMs) : this.#intervalMs;
  }

  #failure(e: unknown): Outcome {
    if (e instanceof SyncFailure) return { kind: "failed", state: "error", error: { code: e.code, message: e.message } };
    const failure = asFailure(e);
    const state = failure.code === "NETWORK" ? "offline" : failure.code === "AUTH" || failure.code === "SCOPE" ? "needs-sign-in" : "error";
    return { kind: "failed", state, error: { code: failure.code, message: failure.message, ...(failure.detail ? { detail: failure.detail } : {}) } };
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
}

/** What a sync's fetches and pushes carry: Writer's token for the remote, and the signal that stops them. */
interface Transfer {
  auth?: GitAuth;
  signal: AbortSignal;
}

/** A failure as the port reports it; anything else (a bug, a file error) as git's own failure. */
function asFailure(e: unknown): GitFailure {
  return e instanceof GitFailure ? e : gitFailure("GIT", e instanceof Error ? e.message : String(e));
}

/** "Merge changes from origin", with each file git couldn't merge and how it was settled. */
function mergeMessage(remote: string, prepared: PreparedMerge, how: string): string {
  const files = prepared.files.map((f) => `- ${f.path}: ${f.merged !== undefined ? "merged paragraph by paragraph" : how}`);
  return `Merge changes from ${remote}\n${files.length ? `\n${files.join("\n")}\n` : ""}`;
}
