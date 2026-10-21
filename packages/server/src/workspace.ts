import { EVENT_FILES_FORMAT, kindByKey, knownKind, loadBook, MANIFEST, parseYaml, picturePath, pictures, readManifest, SCHEMA_VERSION, slugify, uniqueFileName, V2_KIND, type BookKind, type FileSource, type Book } from "@writer/core";
import { BibleOperations } from "./bible.ts";
import { moduleServices, type ModuleService } from "./modules.ts";
import { Checkpoints } from "./checkpoints.ts";
import { ManuscriptOperations } from "./manuscript.ts";
import { Committer, type CommitStatus, type CommitterOptions } from "./committer.ts";
import { atomicWrite, FileError, hashText, IMAGES_DIR, imageVersion, isVisible, readText, servableImage, sniffImage, writableImagePath, writablePath, type TextFile, type WriteHooks } from "./files.ts";
import type { Library } from "./library.ts";
import { bookSource, filesPort, gitPort } from "./ports.ts";
import { githubRepoOf, type GitHub, type GitHubRepo } from "./github.ts";
import { IssueStore } from "./issues.ts";
import { Syncer, type SyncerOptions, type SyncStatus } from "./sync.ts";
import { Versions } from "./versions.ts";

/** A file that changed on disk. `hash` is null once the file is gone. */
export interface FileEvent {
  type: "add" | "change" | "unlink";
  path: string;
  hash: string | null;
}

export type WriteResult = { ok: true; hash: string } | { ok: false; current: TextFile | undefined };

/** What GET /sync reports: the sync state ("off" when sync is turned off), with the background commit status. */
export type NovelSyncStatus = (SyncStatus | { state: "off" }) & {
  commit: CommitStatus | { state: "off" };
  /** The GitHub repository the novel syncs with, or null when it isn't on GitHub. */
  github: GitHubRepo | null;
};

export interface WorkspaceOptions {
  /** Background commits; false turns them off. */
  commit?: CommitterOptions | false;
  /** Sync with the remote; false turns it off. */
  sync?: SyncerOptions | false;
  /** Writer's GitHub sign-in, used for GitHub remotes when there is one. */
  github?: GitHub;
}

/**
 * One open novel: reads, conflict-checked atomic writes, and a watcher that tells subscribers about
 * changes made outside the app (another editor, a git pull) but not about the server's own writes.
 */
export class NovelWorkspace {
  readonly root: string;
  /** Commits saved work in the background, unless turned off. */
  readonly committer: Committer | undefined;
  /** Syncs with the remote in the background, unless turned off. */
  readonly syncer: Syncer | undefined;
  readonly checkpoints: Checkpoints;
  /** Alternate versions of the novel: one open at a time. */
  readonly versions: Versions;
  /** Story bible changes, one commit each. */
  readonly bible: BibleOperations;
  /** Manuscript structure changes, one commit each. */
  readonly manuscript: ManuscriptOperations;
  /** The novel's GitHub issues, cached in the clone (with a GitHub connection; empty unless the novel is on GitHub). */
  readonly issues: IssueStore | undefined;
  /** What the kind's modules keep for the book (the drafting board's store), by module id. */
  readonly modules: ReadonlyMap<string, ModuleService>;
  /** The kind it was opened as: a book made another kind since (#39) is opened afresh, with that kind's modules. */
  readonly openedAs: string;
  /** Resolves when the workspace stops: event streams end then. */
  readonly stopped: Promise<void>;
  #stop!: () => void;
  #locks = new Map<string, Promise<unknown>>();
  /** path → hash of what the server last wrote there: a watcher event with that hash is an echo. */
  #written = new Map<string, string>();
  #listeners = new Set<(e: FileEvent) => void>();
  #unwatch?: () => Promise<void>;
  #ready?: Promise<void>;
  #kind: BookKind;
  /** Writes under way, and the exclusive task (sync, restore) that new writes wait for. */
  #writing = 0;
  #drained?: () => void;
  #exclusive?: Promise<unknown>;

  #github: GitHub | undefined;
  /** Pictures the prose stopped naming, their files deleted: kept so a save that names one again (an Undo) brings it back. */
  #dropped = new Map<string, { full: string; bytes: Uint8Array }>();

  /** The book in `root`, its kind read first (`kind` is kept, and read again when its manifest changes). */
  static async open(root: string, options: WorkspaceOptions = {}): Promise<NovelWorkspace> {
    return new NovelWorkspace(root, await readKind(root), options);
  }

  /** The book in `root`, of `kind` as just read from its manifest. */
  static made(root: string, kind: BookKind, options: WorkspaceOptions = {}): NovelWorkspace {
    return new NovelWorkspace(root, kind, options);
  }

  private constructor(root: string, kind: BookKind, { commit = {}, sync = {}, github }: WorkspaceOptions = {}) {
    this.root = root;
    this.#kind = kind;
    this.#github = github;
    this.committer = commit === false ? undefined : new Committer(root, commit);
    this.syncer =
      sync === false
        ? undefined
        : new Syncer(root, sync, {
            ...(this.committer ? { committer: this.committer } : {}),
            exclusive: (fn) => this.exclusive(fn),
            ...(github ? { auth: (url: string) => github.gitAuth(url), onAuthRefused: () => void github.recheck(), signInRefused: (url: string) => github.refused(url) } : {}),
          });
    this.checkpoints = new Checkpoints(root, {
      // Checkpoints commit saved work even when background commits are off.
      committer: this.committer ?? new Committer(root),
      exclusive: (fn) => this.exclusive(fn),
      onCreate: () => this.syncer?.tagsChanged(),
    });
    this.versions = new Versions(root, {
      committer: this.committer ?? new Committer(root),
      checkpoints: this.checkpoints,
      exclusive: (fn) => this.exclusive(fn),
      onChange: () => this.syncer?.branchChanged(),
    });
    this.bible = new BibleOperations(root, (fn) => this.exclusive(fn));
    this.manuscript = new ManuscriptOperations(root, (fn) => this.exclusive(fn), () => this.kind);
    this.issues = github ? new IssueStore(root, github, () => this.githubRepo(), async () => (await this.loadModel()).novel, () => this.kind) : undefined;
    this.openedAs = this.kind.key;
    this.modules = moduleServices(this.kind, this);
    // Issues and the modules' services (a board that's set up) are brought up to date with each sync
    // with GitHub, so a change on github.com shows within one cycle.
    let lastSync: string | null | undefined;
    this.syncer?.onChange(() => {
      void this.syncer
        ?.status()
        .then(async (s) => {
          if (s.lastSync === lastSync || !s.lastSync) return;
          lastSync = s.lastSync;
          void this.issues?.refresh().catch(() => {});
          for (const service of this.modules.values()) await service.synced?.().catch(() => {});
        })
        .catch(() => {});
    });
    this.stopped = new Promise((resolve) => (this.#stop = resolve));
    this.syncer?.start();
  }

  /** The GitHub connection, if the server has one: for a module's service that works with GitHub. */
  get github(): GitHub | undefined {
    return this.#github;
  }

  /** A module's service for the book, by the module's id: what its routes work with. */
  module<T extends ModuleService>(id: string): T | undefined {
    return this.modules.get(id) as T | undefined;
  }

  async syncStatus(): Promise<NovelSyncStatus> {
    const [sync, commit, github] = await Promise.all([this.syncer?.status() ?? { state: "off" as const }, this.committer?.status() ?? { state: "off" as const }, this.githubRepo()]);
    return { ...sync, commit, github };
  }

  /** The GitHub repository the novel's remote (origin, or the one it syncs with) is, if it's on GitHub. */
  async githubRepo(): Promise<GitHubRepo | null> {
    const remote = (this.syncer ? (await this.syncer.status()).remote : null) ?? "origin";
    const url = (await gitPort().remoteUrl(this.root, remote).catch(() => null)) ?? "";
    return url ? githubRepoOf(url, this.#github?.webUrl) : null;
  }

  /** Listen for changes to the sync or commit status. Returns a function that removes the listener. */
  onSyncChange(listener: () => void): () => void {
    const off = [this.syncer?.onChange(listener), this.committer?.onChange(listener)];
    return () => off.forEach((f) => f?.());
  }

  /**
   * Run `fn` alone: writes under way finish first, new ones wait until it's done, and background commits
   * are held off. For changes to the work tree that mustn't interleave with saves (a rebase, a restore).
   */
  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    while (this.#exclusive) await this.#exclusive.catch(() => {});
    const run = (async () => {
      if (this.#writing) await new Promise<void>((resolve) => (this.#drained = resolve));
      return this.committer ? this.committer.hold(fn) : fn();
    })();
    this.#exclusive = run;
    try {
      return await run;
    } finally {
      this.#exclusive = undefined;
    }
  }

  /**
   * Why this server mustn't write to the book, if it mustn't: a format newer than it reads, or a kind
   * of book it doesn't ship. Written by it, the book would be written wrong (D11, D15). Undefined otherwise.
   */
  async tooNew(): Promise<string | undefined> {
    const manifest = await readManifest(bookSource(this.root));
    if (!manifest) return undefined;
    if (manifest.version > SCHEMA_VERSION) return `This book is in format v${manifest.version}, newer than this copy of Writer reads (v${SCHEMA_VERSION}). Update Writer to change it.`;
    if (manifest.file !== MANIFEST && manifest.version > EVENT_FILES_FORMAT) return `This book's ${manifest.file} says format v${manifest.version}, which keeps a book's settings in ${MANIFEST}. Fix that to change it.`;
    if (manifest.file === MANIFEST && (manifest.kind === undefined || !knownKind(manifest.kind))) return `This is a book of a kind this copy of Writer doesn't know (“${manifest.kind ?? "none named"}”). Update Writer to change it.`;
    return undefined;
  }

  /**
   * The story model, with the hash of every file it was read from (the bases for writes), and a
   * version of each picture it shows from images/ (its size and time), so a replaced one is fetched anew.
   */
  /**
   * The book's kind, from its manifest alone, without reading the rest: book.yaml's `kind`, or a novel
   * for a book in format 1 or 2. A kind this build doesn't ship reads as a novel here; nothing is
   * written to such a book (tooNew).
   */
  get kind(): BookKind {
    return this.#kind;
  }

  async loadModel(): Promise<{ novel: Book; files: Record<string, string>; images: Record<string, string> }> {
    const files: Record<string, string> = {};
    const disk = bookSource(this.root);
    const source: FileSource = {
      list: (dir) => disk.list(dir),
      read: async (path) => {
        const bytes = await filesPort().read(filesPort().join(this.root, path));
        if (bytes === undefined) return undefined;
        files[path] = hashText(bytes);
        return decoder.decode(bytes);
      },
    };
    const novel = await loadBook(source);
    const images: Record<string, string> = {};
    const shown = [novel.config?.cover, ...novel.entities.map((e) => e.image)].filter((p): p is string => !!p);
    await Promise.all(
      [...new Set(shown)].map(async (path) => {
        const version = await imageVersion(this.root, path);
        if (version) images[path] = version;
      }),
    );
    return { novel, files, images };
  }

  read(path: string): Promise<TextFile | undefined> {
    return readText(this.root, path);
  }

  /**
   * Write `content` to `path` if the file on disk is still the one the client read: `base` is the hash
   * it read, or null for a file it expects not to exist. Otherwise nothing is written and the current
   * file comes back. Writes to one path run one at a time. `announce`: subscribers hear of it as of a
   * change made outside the app (one the server makes for GitHub, which open editors must take in).
   */
  write(path: string, content: string, base: string | null, hooks?: WriteHooks, { announce = false } = {}): Promise<WriteResult> {
    return this.#locked(path, () => this.#shared(async () => {
      const full = await writablePath(this.root, path, content);
      const current = await readText(this.root, path);
      if ((current?.hash ?? null) !== base) return { ok: false, current };
      const hash = hashText(content);
      if (current?.hash === hash) return { ok: true, hash };
      // Recorded before the write, since the watcher may see the file before atomicWrite returns.
      if (announce) this.#written.delete(path);
      else this.#written.set(path, hash);
      try {
        await atomicWrite(full, content, hooks);
      } catch (e) {
        this.#written.delete(path);
        throw e;
      }
      await this.#prosePictures(path, current?.content ?? "", content);
      this.committer?.notify();
      return { ok: true, hash };
    }));
  }

  /**
   * Save a picture for the prose (heffrey78/gh-writer#203): `bytes` (JPEG or PNG, resized by the app) at images/<slug>.jpg
   * or .png, the slug from `name` (with -2, -3… if taken). It isn't committed on its own: the scene that
   * names it is saved next, and the two go in one commit.
   */
  addPicture(name: string, bytes: Uint8Array): Promise<{ path: string }> {
    return this.#locked(IMAGES_DIR, () => this.#shared(async () => {
      const format = sniffImage(bytes);
      if (!format) throw new FileError("NOT_IMAGE", "That isn't a JPEG or PNG image.");
      const names = (await filesPort().list(filesPort().join(this.root, IMAGES_DIR))).map((e) => e.path);
      // A dropped picture's name stays taken, so an Undo can bring it back.
      const taken = new Set([...names, ...[...this.#dropped.keys()].map((p) => p.slice(IMAGES_DIR.length + 1))]);
      const path = `${IMAGES_DIR}/${uniqueFileName(name.trim() ? slugify(name) : "picture", format.ext, taken)}`;
      await atomicWrite(await writableImagePath(this.root, path, bytes), bytes);
      this.committer?.notify();
      return { path };
    }));
  }

  /**
   * After a piece is saved: a picture it no longer names, that no other piece, entry or the cover does,
   * has its file deleted (no picture is left behind in images/); one it names again whose file this
   * deleted is put back.
   */
  async #prosePictures(path: string, before: string, after: string): Promise<void> {
    if (!path.startsWith(`${this.kind.folders.content}/`) || !path.endsWith(".md")) return;
    const named = (text: string) => new Set(pictures(text).flatMap((p) => picturePath(p.src) ?? []));
    const was = named(before);
    const now = named(after);
    for (const picture of now) {
      const dropped = this.#dropped.get(picture);
      if (!dropped) continue;
      this.#dropped.delete(picture);
      if (!(await servableImage(this.root, picture).catch(() => undefined))) await atomicWrite(dropped.full, dropped.bytes);
    }
    const gone = [...was].filter((p) => !now.has(p) && p.startsWith(`${IMAGES_DIR}/`));
    if (!gone.length) return;
    const novel = await loadBook(bookSource(this.root));
    const kept = new Set<string | undefined>([novel.config?.cover, ...novel.entities.map((e) => e.image)]);
    for (const scene of novel.allPieces) for (const p of pictures(scene.body)) kept.add(picturePath(p.src));
    for (const picture of gone.filter((p) => !kept.has(p))) {
      const image = await servableImage(this.root, picture).catch(() => undefined);
      const bytes = image && (await filesPort().read(image.full));
      if (!image || !bytes) continue;
      await filesPort().remove(image.full);
      this.#dropped.set(picture, { full: image.full, bytes });
      // A few at most: enough for the Undo history of a session.
      if (this.#dropped.size > 20) this.#dropped.delete(this.#dropped.keys().next().value!);
    }
  }

  async #shared<T>(task: () => Promise<T>): Promise<T> {
    while (this.#exclusive) await this.#exclusive.catch(() => {});
    this.#writing++;
    try {
      return await task();
    } finally {
      if (--this.#writing === 0) {
        this.#drained?.();
        this.#drained = undefined;
      }
    }
  }

  /** Listen for outside changes. Resolves once the watcher is ready: changes from then on are reported. */
  async subscribe(listener: (e: FileEvent) => void): Promise<() => void> {
    this.#listeners.add(listener);
    await this.#watch();
    return () => {
      this.#listeners.delete(listener);
      if (!this.#listeners.size) void this.#stopWatching();
    };
  }

  /** End the event streams. */
  stop(): void {
    this.#listeners.clear();
    this.#stop();
  }

  /** End the event streams, stop syncing and watching, and commit any saved work still waiting. */
  async close(): Promise<void> {
    this.stop();
    await this.syncer?.close();
    await Promise.all([this.#stopWatching(), this.committer?.close()]);
  }

  #watch(): Promise<void> {
    this.#ready ??= filesPort()
      .watch(this.root, (path) => !isVisible(path), (type, path) => void this.#onChange(type, path))
      .then((stop) => void (this.#unwatch = stop));
    return this.#ready;
  }

  async #stopWatching(): Promise<void> {
    const ready = this.#ready;
    this.#ready = undefined;
    await ready;
    const stop = this.#unwatch;
    this.#unwatch = undefined;
    await stop?.();
  }

  async #onChange(type: FileEvent["type"], path: string): Promise<void> {
    let hash: string | null = null;
    // A hand edit of the manifest may make the book another kind (opened afresh as it, Workspaces.get).
    if (path === MANIFEST) this.#kind = await readKind(this.root);
    if (type !== "unlink") {
      const bytes = await filesPort().read(filesPort().join(this.root, path));
      if (bytes === undefined) return; // gone again; its unlink follows
      hash = hashText(bytes);
      if (this.#written.get(path) === hash) return;
    }
    this.#written.delete(path);
    for (const listener of this.#listeners) listener({ type, path, hash });
  }

  #locked<T>(path: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(path) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(task);
    const settled = run.catch(() => {});
    this.#locks.set(path, settled);
    void settled.then(() => {
      if (this.#locks.get(path) === settled) this.#locks.delete(path);
    });
    return run;
  }
}

/** The open workspaces, one per library novel. */
export class Workspaces {
  #library: Library;
  #options: WorkspaceOptions;
  #open = new Map<string, NovelWorkspace>();

  constructor(library: Library, options: WorkspaceOptions = {}) {
    this.#library = library;
    this.#options = options;
  }

  /** The workspace for a library novel, or undefined if there is no such novel. */
  async get(id: string): Promise<NovelWorkspace | undefined> {
    const entry = this.#library.get(id);
    if (!entry) return undefined;
    const kind = await readKind(entry.path);
    // Looked up after the read, and made with nothing awaited, so two requests at once share one.
    let ws = this.#open.get(id);
    // Opened afresh for another folder, or once the book is another kind: its modules are the new kind's.
    if (ws?.root !== entry.path || ws.openedAs !== kind.key) {
      void ws?.close();
      ws = NovelWorkspace.made(entry.path, kind, this.#options);
      this.#open.set(id, ws);
    }
    return ws;
  }

  /** Commit now wherever a commit was blocked for want of a git identity: one has just been given. */
  async retryIdentity(): Promise<void> {
    await Promise.all(
      [...this.#open.values()].map(async (ws) => {
        if ((await ws.committer?.status())?.blocked?.code === "IDENTITY") await ws.committer?.commit();
      }),
    );
  }

  /** End every event stream, so that the HTTP server can finish its requests. */
  stop(): void {
    for (const ws of this.#open.values()) ws.stop();
  }

  async close(): Promise<void> {
    await Promise.all([...this.#open.values()].map((ws) => ws.close()));
    this.#open.clear();
  }
}

const decoder = new TextDecoder();

/**
 * A book's kind, from its manifest alone, without reading the rest: book.yaml's `kind`, or a novel for a
 * book in format 1 or 2. A kind this build doesn't ship reads as a novel here; nothing is written to
 * such a book (tooNew).
 */
export async function readKind(root: string): Promise<BookKind> {
  const bytes = await filesPort().read(filesPort().join(root, MANIFEST));
  const key = bytes === undefined ? undefined : (parseYaml(decoder.decode(bytes), MANIFEST).data as { kind?: unknown } | undefined)?.kind;
  return (typeof key === "string" ? knownKind(key) : undefined) ?? kindByKey(V2_KIND);
}
