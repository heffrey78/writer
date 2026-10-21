import { kindByKey, kindOf, V2_KIND } from "@writer/core";
import { commitMessage, type FileChange } from "./commit-message.ts";
import { TEMP_SUFFIX } from "./files.ts";
import { GitFailure, gitFailure, NO_OBJECT, text, type Scope } from "./git-port/port.ts";
import { bookSource, gitPort, host } from "./ports.ts";

export interface CommitterOptions {
  /** Commit after this long without a save (ms). Default 2 minutes. */
  quietMs?: number;
  /** While saves keep coming, commit at least this often (ms). Default 10 minutes. */
  maxMs?: number;
  /** Timer source: tests pass a fake clock. Returns a cancel function. */
  schedule?: (fn: () => void, ms: number) => () => void;
}

export interface LastCommit {
  hash: string;
  summary: string;
  date: string;
}

export type BlockedCode = "IDENTITY" | "MERGE" | "ERROR";

export interface CommitStatus {
  /** idle: nothing waiting; pending: saves waiting for the timer; committing; blocked: a commit couldn't be made. */
  state: "idle" | "pending" | "committing" | "blocked";
  /** Files in the novel that differ from the last commit. */
  pendingChanges: number;
  lastCommit: LastCommit | null;
  blocked?: { code: BlockedCode; message: string };
}

export type CommitResult = { committed: LastCommit } | { skipped: "NOTHING" | BlockedCode };

// Atomic-write temp files are never committed, even if one is left behind by a crash.
const BOOK: Scope = { exclude: [`**/.*${TEMP_SUFFIX}`] };

/** Whether a merge, rebase, cherry-pick or revert is under way in the repository holding `root`. */
export function operationInProgress(root: string): Promise<boolean> {
  return gitPort().inProgress(root);
}

export const IDENTITY_MESSAGE = "git doesn't know your name and email yet, so your saved work can't be committed to your book's history. Give them under Your name and email (in the ⋯ menu), and it's committed.";

/** The name and email git signs with on this computer (the user's global configuration), if both are set. */
export async function globalIdentity(): Promise<{ name: string; email: string } | null> {
  const get = async (key: string) => (await gitPort().getConfig(null, key).catch(() => null)) ?? "";
  const [name, email] = [await get("user.name"), await get("user.email")];
  return name && email ? { name, email } : null;
}

/** Set the name and email git signs with on this computer (the user's global configuration). */
export async function setGlobalIdentity({ name, email }: { name: string; email: string }): Promise<void> {
  await gitPort().setConfig(null, "user.name", name);
  await gitPort().setConfig(null, "user.email", email);
}

/** Whether git has a name and email to commit with (config or GIT_AUTHOR_* / GIT_COMMITTER_*). */
export async function hasGitIdentity(root: string): Promise<boolean> {
  const get = async (key: string) => (await gitPort().getConfig(root, key).catch(() => null)) ?? "";
  const env = host().env();
  const name = env.GIT_AUTHOR_NAME || env.GIT_COMMITTER_NAME || (await get("user.name"));
  const email = env.GIT_AUTHOR_EMAIL || env.GIT_COMMITTER_EMAIL || (await get("user.email"));
  return Boolean(name && email);
}

const realSchedule = (fn: () => void, ms: number) => {
  const timer = setTimeout(fn, ms);
  timer.unref();
  return () => clearTimeout(timer);
};

/**
 * Commits a novel's saved work in the background: after a quiet period without saves, and at least
 * every `maxMs` while saving goes on. Only the novel's folder is staged and committed. Nothing is
 * committed during a merge or rebase, without a git identity, or when nothing changed.
 */
export class Committer {
  readonly root: string;
  #quietMs: number;
  #maxMs: number;
  #schedule: NonNullable<CommitterOptions["schedule"]>;
  #cancelQuiet?: () => void;
  #cancelMax?: () => void;
  #dirty = false;
  #committing = false;
  #running: Promise<CommitResult> | undefined;
  #lastCommit: LastCommit | null = null;
  #blocked: CommitStatus["blocked"];
  #held = 0;
  #listeners = new Set<() => void>();

  constructor(root: string, { quietMs = 120_000, maxMs = 600_000, schedule = realSchedule }: CommitterOptions = {}) {
    this.root = root;
    this.#quietMs = quietMs;
    this.#maxMs = maxMs;
    this.#schedule = schedule;
  }

  /** A save happened: restart the quiet timer, and start the cap if this is the first save since a commit. */
  notify(): void {
    const wasDirty = this.#dirty;
    this.#dirty = true;
    this.#cancelQuiet?.();
    this.#cancelQuiet = this.#schedule(() => this.#onTimer(), this.#quietMs);
    this.#cancelMax ??= this.#schedule(() => this.#onTimer(), this.#maxMs);
    if (!wasDirty) this.#changed();
  }

  /** Called after each commit attempt and when saves start waiting. Returns a function that removes it. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  /**
   * Run `fn` with background commits held off (sync rebasing the work tree, a checkpoint restore).
   * Explicit commit() calls still run; timers that come due meanwhile wait until `fn` has finished.
   */
  async hold<T>(fn: () => Promise<T>): Promise<T> {
    this.#held++;
    try {
      await this.idle();
      return await fn();
    } finally {
      if (--this.#held === 0 && this.#dirty && !this.#cancelQuiet) {
        this.#cancelQuiet = this.#schedule(() => this.#onTimer(), this.#quietMs);
      }
    }
  }

  /** Commit now if there is anything to commit. Concurrent calls share one run. */
  commit(): Promise<CommitResult> {
    this.#cancelTimers();
    this.#running ??= this.#commit().finally(() => (this.#running = undefined));
    return this.#running;
  }

  /** Resolves once a commit in progress has finished. */
  async idle(): Promise<void> {
    await this.#running?.catch(() => {});
  }

  async status(): Promise<CommitStatus> {
    const pendingChanges = await this.#pendingChanges().catch(() => 0);
    const state = this.#committing ? "committing" : this.#blocked ? "blocked" : this.#dirty || pendingChanges ? "pending" : "idle";
    return { state, pendingChanges, lastCommit: this.#lastCommit, ...(this.#blocked ? { blocked: this.#blocked } : {}) };
  }

  /** Commit what's waiting and stop the timers. */
  async close(): Promise<void> {
    this.#cancelTimers();
    await this.idle();
    if (this.#dirty) await this.commit().catch(() => {});
  }

  #onTimer(): void {
    if (this.#held) {
      // Picked up again when the hold ends.
      this.#cancelTimers();
      return;
    }
    void this.commit();
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }

  async #commit(): Promise<CommitResult> {
    this.#committing = true;
    // Saves from here on belong to the next commit.
    this.#dirty = false;
    try {
      const result = await this.#tryCommit();
      if ("committed" in result) {
        this.#lastCommit = result.committed;
        this.#blocked = undefined;
      } else if (result.skipped === "NOTHING") {
        this.#blocked = undefined;
      }
      return result;
    } catch (e) {
      const failure = e instanceof GitFailure ? e : gitFailure("GIT", e instanceof Error ? e.message : String(e));
      this.#block("ERROR", `Couldn't commit: ${failure.message}`);
      return { skipped: "ERROR" };
    } finally {
      this.#committing = false;
      this.#changed();
    }
  }

  async #tryCommit(): Promise<CommitResult> {
    const git = gitPort();
    if (await operationInProgress(this.root)) {
      return this.#block("MERGE", "A merge or rebase is in progress in this repository; saved work will be committed once it's finished.");
    }
    if (!(await hasGitIdentity(this.root))) return this.#block("IDENTITY", IDENTITY_MESSAGE);

    await git.stage(this.root, BOOK);
    const changes = await this.#stagedChanges();
    if (!changes.length) return { skipped: "NOTHING" };

    // Its kind is one this copy ships: a book of any other kind is never written to.
    const kind = (await kindOf(bookSource(this.root))) ?? kindByKey(V2_KIND);
    const { summary, body } = commitMessage(changes, kind);
    // No hooks: a background save must not run (or be stopped by) the author's commit hooks.
    await git.commit(this.root, `${summary}\n\n${body}`, BOOK);
    const { oid, committed } = await git.commitInfo(this.root, "HEAD");
    return { committed: { hash: oid, summary, date: committed } };
  }

  /** Retry a blocked commit after the next quiet period, keeping the work marked as unsaved to git. */
  #block(code: BlockedCode, message: string): CommitResult {
    this.#blocked = { code, message };
    this.#dirty = true;
    this.#cancelQuiet = this.#schedule(() => this.#onTimer(), this.#quietMs);
    return { skipped: code };
  }



  /** What's staged, with each file's text before and after (by blob, from git's objects). */
  async #stagedChanges(): Promise<FileChange[]> {
    const git = gitPort();
    const staged = await git.stagedChanges(this.root, BOOK);
    const blobs = await git.readBlobs(this.root, [...new Set(staged.flatMap((c) => [c.old, c.new]).filter((o) => o !== NO_OBJECT))]);
    const blob = (oid: string) => (oid === NO_OBJECT ? undefined : ((b) => (b ? text(b) : undefined))(blobs.get(oid)));
    return staged.map((c): FileChange => {
      if (c.status === "R") return { status: "R", path: c.path, oldPath: c.from!, before: blob(c.old), after: blob(c.new) };
      const status = c.status === "A" || c.status === "D" ? c.status : "M";
      return { status, path: c.path, before: status !== "A" ? blob(c.old) : undefined, after: status !== "D" ? blob(c.new) : undefined };
    });
  }

  async #pendingChanges(): Promise<number> {
    return (await gitPort().status(this.root, BOOK)).length;
  }

  #cancelTimers(): void {
    this.#cancelQuiet?.();
    this.#cancelMax?.();
    this.#cancelQuiet = undefined;
    this.#cancelMax = undefined;
  }
}
