import { countWords, kindOf, loadBook, parseMarkdown, vocabulary, type Book, type BookKind } from "@writer/core";
import type { Committer } from "./committer.ts";
import { atomicWrite, writablePath } from "./files.ts";
import { commitSource } from "./git-source.ts";
import { text } from "./git-port/port.ts";
import { bookSource, gitPort } from "./ports.ts";

/** Checkpoints are annotated tags under this prefix; sync fetches and pushes them. */
export const CHECKPOINT_PREFIX = "refs/tags/checkpoint/";

const WORDS_TRAILER = "Words";
const AUTO_TRAILER = "Checkpoint";
/** The branch (version) it was made in: main, or version/<slug>. */
const VERSION_TRAILER = "Version";

export interface Checkpoint {
  /** The tag without its "checkpoint/" prefix, e.g. "2026-10-05-183012-before-the-big-cut": the id in URLs. */
  id: string;
  name: string;
  /** When it was made (ISO). */
  date: string;
  /** Manuscript words at the checkpoint. */
  words: number;
  /** Taken by Writer itself (before a restore), not named by the author. */
  auto: boolean;
  /** The branch it was made in, when it says (checkpoints made before versions don't). */
  branch?: string;
  commit: string;
}

export interface RestoreResult {
  /** The checkpoint taken just before the restore: restoring it undoes the restore. */
  undo: Checkpoint;
  /** The commit that made the restore, or null if nothing differed. */
  commit: string | null;
  /** The files the restore changed, relative to the novel. */
  files: string[];
}

export type CheckpointErrorCode = "BAD_NAME" | "NOT_FOUND" | "SCENE_NOT_FOUND" | "BLOCKED";

export class CheckpointError extends Error {
  readonly code: CheckpointErrorCode;

  constructor(code: CheckpointErrorCode, message: string) {
    super(message);
    this.name = "CheckpointError";
    this.code = code;
  }
}

export interface CheckpointDeps {
  /** Commits saved work, so a checkpoint holds everything written up to it. */
  committer: Committer;
  /** Runs a restore with writes and background commits held off. */
  exclusive?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Told when a checkpoint is made, so the next sync pushes it. */
  onCreate?: () => void;
  /** Clock for the date in tag names (tests). */
  now?: () => Date;
}

/**
 * Named checkpoints of a novel: annotated git tags checkpoint/<date>-<slug>, carrying the name and the
 * word count. The manuscript (manuscript/ and bible/), or one scene, can be restored from one; every
 * restore first takes an automatic checkpoint, which undoes it.
 */
export class Checkpoints {
  readonly root: string;
  #committer: Committer;
  #exclusive: NonNullable<CheckpointDeps["exclusive"]>;
  #onCreate: () => void;
  #now: () => Date;

  constructor(root: string, { committer, exclusive, onCreate = () => {}, now = () => new Date() }: CheckpointDeps) {
    this.root = root;
    this.#committer = committer;
    this.#exclusive = exclusive ?? ((fn) => committer.hold(fn));
    this.#onCreate = onCreate;
    this.#now = now;
  }

  /** Newest first: tag names start with a time that only goes up (see #create). */
  async list(): Promise<Checkpoint[]> {
    const tags = await gitPort().tags(this.root, CHECKPOINT_PREFIX.slice("refs/tags/".length));
    return tags.reverse().map((tag) => {
      const [subject = "", ...rest] = tag.message.trim().split("\n");
      const trailer = (key: string) => rest.map((l) => new RegExp(`^${key}: *(.*)$`).exec(l)?.[1]).find((v) => v !== undefined);
      return {
        id: tag.name.slice(CHECKPOINT_PREFIX.length - "refs/tags/".length),
        name: subject,
        date: tag.date ?? "",
        words: Number(trailer(WORDS_TRAILER) ?? 0),
        auto: trailer(AUTO_TRAILER) === "auto",
        ...(trailer(VERSION_TRAILER) ? { branch: trailer(VERSION_TRAILER)! } : {}),
        // A lightweight tag (made by hand) points at the commit itself.
        commit: tag.commit,
      };
    });
  }

  async get(id: string): Promise<Checkpoint> {
    const found = (await this.list()).find((c) => c.id === id);
    if (!found) throw new CheckpointError("NOT_FOUND", `No checkpoint "${id}".`);
    return found;
  }

  /** Commit saved work and mark it with `name`. */
  create(name: string): Promise<Checkpoint> {
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean || clean.length > 200) return Promise.reject(new CheckpointError("BAD_NAME", "Give the checkpoint a name of 1 to 200 characters."));
    return this.#exclusive(() => this.#create(clean, false));
  }

  /**
   * Bring back the whole manuscript (manuscript/ and bible/), or with `sceneId` that one scene, as it was
   * at checkpoint `id`. The scene is found by its ID, so it's restored where it is now even if it moved;
   * a scene since deleted comes back where it was. Restoring `undo` from the result undoes it.
   */
  restore(id: string, { sceneId }: { sceneId?: string } = {}): Promise<RestoreResult> {
    return this.#exclusive(async () => {
      const checkpoint = await this.get(id);
      const tag = `${CHECKPOINT_PREFIX}${id}`;
      const kind = await this.#kind();
      const w = vocabulary(kind);
      const scene = sceneId === undefined ? undefined : await this.#sceneAt(tag, sceneId, kind);
      const what = scene ? `“${scene.title}”` : `the ${w.content.one}`;
      const undo = await this.#create(`Before restoring ${what} from “${checkpoint.name}”`, true);
      const git = gitPort();

      let paths: string[];
      if (scene) {
        const target = (await this.#currentScenePath(sceneId!)) ?? scene.path;
        // The same checks as a save: a plain path inside the novel, no symlinks.
        await atomicWrite(await writablePath(this.root, target, scene.content), scene.content);
        await git.stage(this.root, { paths: [target] });
        paths = [target];
      } else {
        // Paths in neither the checkpoint nor the work tree would be an error for git.
        paths = [];
        // The whole book, for a restore: its sections and pieces, and its codex.
        for (const p of [kind.folders.content, kind.folders.codex]) {
          const atCheckpoint = (await git.listTree(this.root, tag, p)).length > 0;
          const now = (await git.listFiles(this.root, [p])).length > 0;
          if (atCheckpoint || now) paths.push(p);
        }
        // Removes what the checkpoint didn't have, in the index and the work tree.
        if (paths.length) await git.restore(this.root, tag, paths);
      }

      const files = paths.length ? (await git.stagedChanges(this.root, { paths })).map((c) => c.path) : [];
      if (!files.length) return { undo, commit: null, files };
      const message = `Restore ${scene ? `${w.piece.one} ${what}` : what} from checkpoint “${checkpoint.name}”`;
      return { undo, commit: await git.commit(this.root, message, { paths }), files };
    });
  }

  /**
   * An automatic checkpoint of `commit` (not necessarily the one checked out): what a discarded version
   * is kept as, so it can be brought back. Run inside the caller's exclusive section.
   */
  keep(name: string, commit: string, branch?: string): Promise<Checkpoint> {
    return this.#create(name, true, commit, branch);
  }

  async #create(name: string, auto: boolean, commit?: string, branch?: string): Promise<Checkpoint> {
    if (commit === undefined) {
      const result = await this.#committer.commit();
      if ("skipped" in result && result.skipped !== "NOTHING") {
        const blocked = (await this.#committer.status()).blocked;
        throw new CheckpointError("BLOCKED", `Your latest work couldn't be committed, so no checkpoint was made. ${blocked?.message ?? ""}`.trim());
      }
    }
    const words = commit === undefined ? await this.#words() : wordsIn(await loadBook(await commitSource(this.root, commit)));
    const git = gitPort();
    // A second after the newest checkpoint at the latest, so names sort in the order they were made even
    // within one second (a restore right after a checkpoint) or after the clock steps back.
    const stamps = (await git.tags(this.root, "checkpoint/")).map((t) => STAMP.exec(t.name.slice("checkpoint/".length))?.[0]);
    const newest = stamps.filter((s) => s !== undefined).sort().at(-1);
    let at = this.#now();
    if (newest && stamp(at) <= newest) at = new Date(parseStamp(newest).getTime() + 1000);
    const tag = `checkpoint/${stamp(at)}-${slug(name)}`;
    const made = branch ?? (await git.currentBranch(this.root).catch(() => null)) ?? "";
    const trailers = [`${WORDS_TRAILER}: ${words}`, ...(auto ? [`${AUTO_TRAILER}: auto`] : []), ...(made ? [`${VERSION_TRAILER}: ${made}`] : [])];
    await git.tag(this.root, tag, `${name}\n\n${trailers.join("\n")}`, commit ?? "HEAD");
    this.#onCreate();
    return this.get(tag.slice("checkpoint/".length));
  }

  /** Manuscript words in the work tree, which matches HEAD once saved work is committed. */
  async #words(): Promise<number> {
    return wordsIn(await loadBook(bookSource(this.root)));
  }

  /** The book's kind, for its folders and words. */
  async #kind(): Promise<BookKind> {
    const kind = await kindOf(bookSource(this.root));
    if (!kind) throw new Error("This copy of Writer doesn't know this kind of book, so it can't restore it.");
    return kind;
  }

  async #sceneAt(tag: string, sceneId: string, kind: BookKind): Promise<{ path: string; title: string; content: string }> {
    const git = gitPort();
    const files = (await git.listTree(this.root, tag, kind.folders.content)).map((e) => e.path).filter((f) => f.endsWith(".md"));
    for (const path of files) {
      const content = text((await git.readFile(this.root, tag, path)) ?? new Uint8Array());
      const { data } = parseMarkdown(content, path);
      const fm = (data ?? {}) as { id?: unknown; title?: unknown };
      if (fm.id === sceneId) return { path, title: typeof fm.title === "string" ? fm.title : sceneId, content };
    }
    throw new CheckpointError("SCENE_NOT_FOUND", `The checkpoint has no ${vocabulary(kind).piece.one} "${sceneId}".`);
  }

  async #currentScenePath(sceneId: string): Promise<string | undefined> {
    const novel = await loadBook(bookSource(this.root));
    return novel.allPieces.find((s) => s.id === sceneId)?.file;
  }
}

/** The manuscript's words. */
export function wordsIn(novel: Book): number {
  return novel.allPieces.reduce((sum, scene) => sum + countWords(scene.body), 0);
}

/** UTC date and time, for tag names that sort: 2026-10-05-183012. */
function stamp(d: Date): string {
  return d.toISOString().replace(/\.\d+Z$/, "").replace("T", "-").replaceAll(":", "");
}

const STAMP = /^\d{4}-\d{2}-\d{2}-\d{6}/;

function parseStamp(s: string): Date {
  return new Date(`${s.slice(0, 10)}T${s.slice(11, 13)}:${s.slice(13, 15)}:${s.slice(15, 17)}Z`);
}

/** A tag-safe slug of the name: "Before the big cut" → "before-the-big-cut". */
export function slug(name: string, fallback = "checkpoint"): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return s || fallback;
}
