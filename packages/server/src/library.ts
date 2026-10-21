import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { knownKind, knownKinds, MANIFEST, newId, NOVEL_MANIFEST, parseYaml, readManifest, slugify } from "@writer/core";
import { cloneUrl, gitFailure, repoName, type CloneProgress, type GitAuthSource } from "./git-port/port.ts";
import { bookSource, filesPort, gitPort } from "./ports.ts";
import { NeedsIdentity, TEMPLATES, templateOf, writeNewBook, type NewNovel } from "./new-book.ts";

/** A novel the author has opened or cloned. */
export interface LibraryEntry {
  id: string;
  /** Absolute path of the folder holding novel.yaml. */
  path: string;
  title: string;
  /** The author named in novel.yaml, if any. */
  author?: string;
  /** The cover named in novel.yaml, a path in the novel (images/cover.jpg), if any. */
  cover?: string;
  /** The origin remote, without any credentials embedded in it. */
  remote?: string;
  /** ISO timestamp. */
  lastOpened: string;
}

export interface LibraryNotice {
  code: "MISSING" | "UNREADABLE";
  message: string;
  path: string;
}

export type LibraryErrorCode = "NOT_A_DIRECTORY" | "NOT_A_REPO" | "NOT_A_NOVEL" | "UNKNOWN_NOVEL" | "NOT_EMPTY" | "NEEDS_IDENTITY" | "UNKNOWN_KIND";

export class LibraryError extends Error {
  readonly code: LibraryErrorCode;

  constructor(code: LibraryErrorCode, message: string) {
    super(message);
    this.name = "LibraryError";
    this.code = code;
  }
}

export interface CloneOptions {
  /** Where to clone to. Default: a folder named after the repository in the library's clone directory. */
  into?: string;
  onProgress?: (e: CloneProgress) => void;
  signal?: AbortSignal;
  /** Writer's GitHub credentials for the clone URL, if any. */
  auth?: GitAuthSource;
}

interface LibraryFile {
  version: 1;
  novels: LibraryEntry[];
}

/** The per-user platform config directory for Writer, or $WRITER_CONFIG_DIR. */
export function defaultConfigDir(): string {
  const env = process.env;
  if (env.WRITER_CONFIG_DIR) return resolve(env.WRITER_CONFIG_DIR);
  return platformConfigDir("writer");
}

/**
 * gh-writer's config directory, whose library.json lists the books to offer to import (#2):
 * $WRITER_GH_WRITER_CONFIG_DIR, else gh-writer's own. None when Writer's config is elsewhere
 * ($WRITER_CONFIG_DIR, as tests and experiments set it): that's a world of its own.
 */
export function ghWriterConfigDir(): string | undefined {
  const env = process.env;
  if (env.WRITER_GH_WRITER_CONFIG_DIR) return resolve(env.WRITER_GH_WRITER_CONFIG_DIR);
  if (env.WRITER_CONFIG_DIR) return undefined;
  return platformConfigDir("gh-writer");
}

function platformConfigDir(app: string): string {
  const env = process.env;
  if (process.platform === "win32") return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), app);
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", app);
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), app);
}

/**
 * The author's novels, kept in library.json in the config directory. Entries whose folder has gone
 * are dropped when the library is read, and each drop leaves a notice for the UI.
 */
export class Library {
  readonly file: string;
  /** Where new novels and clones go unless the author says otherwise. */
  readonly cloneDir: string;
  /** The templates new books are made from, a folder each by the kind's key. */
  readonly templatesDir: string;
  /** What changed behind the author's back: shown once by the UI, kept for the server's lifetime. */
  readonly notices: LibraryNotice[] = [];
  #novels: LibraryEntry[] = [];
  #saving: Promise<void> = Promise.resolve();

  private constructor(file: string, cloneDir: string, templatesDir: string) {
    this.file = file;
    this.cloneDir = cloneDir;
    this.templatesDir = templatesDir;
  }

  static async open({
    configDir = defaultConfigDir(),
    cloneDir = join(homedir(), "writer"),
    templatesDir = TEMPLATES,
  }: { configDir?: string; cloneDir?: string; templatesDir?: string } = {}): Promise<Library> {
    const library = new Library(join(configDir, "library.json"), cloneDir, templatesDir);
    await library.#load();
    await library.list();
    return library;
  }

  /** Every novel whose folder still exists, most recently opened first. */
  async list(): Promise<LibraryEntry[]> {
    const present = await Promise.all(this.#novels.map(async (n) => (await filesPort().stat(n.path).catch(() => undefined))?.kind === "dir"));
    const gone = this.#novels.filter((_, i) => !present[i]);
    if (gone.length) {
      for (const n of gone) {
        this.notices.push({ code: "MISSING", path: n.path, message: `"${n.title}" was removed from the library: its folder ${n.path} is gone.` });
      }
      this.#novels = this.#novels.filter((_, i) => present[i]);
      await this.#save();
    }
    return [...this.#novels].sort((a, b) => b.lastOpened.localeCompare(a.lastOpened));
  }

  get(id: string): LibraryEntry | undefined {
    return this.#novels.find((n) => n.id === id);
  }

  /**
   * gh-writer's books that aren't in this library (#2): those in its library.json whose folder is
   * still a book. Its library stays as it is; importing adds the folders here, not copies.
   */
  async ghWriterBooks(configDir = ghWriterConfigDir()): Promise<{ path: string; title: string }[]> {
    if (!configDir) return [];
    let theirs: { path?: unknown; title?: unknown }[];
    try {
      theirs = (JSON.parse(decoder.decode(await filesPort().read(join(configDir, "library.json")))) as { novels?: { path?: unknown; title?: unknown }[] }).novels ?? [];
    } catch {
      return [];
    }
    const mine = new Set((await this.list()).map((n) => n.path));
    const out: { path: string; title: string }[] = [];
    for (const n of theirs) {
      if (typeof n.path !== "string" || mine.has(n.path)) continue;
      const cover = await coverOf(n.path).catch(() => undefined);
      if (cover) out.push({ path: n.path, title: cover.title });
    }
    return out;
  }

  /** Add gh-writer's books to this library: those added, and those that couldn't be, with why. */
  async importGhWriter(configDir = ghWriterConfigDir()): Promise<{ added: LibraryEntry[]; failed: { path: string; error: string }[] }> {
    const added: LibraryEntry[] = [];
    const failed: { path: string; error: string }[] = [];
    for (const { path } of await this.ghWriterBooks(configDir)) {
      try {
        added.push(await this.add(path));
      } catch (e) {
        failed.push({ path, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { added, failed };
  }

  /** Check that `dir` is a git repository holding a book (book.yaml, or novel.yaml for a novel in format 1 or 2), and add it (or refresh its entry). */
  async add(folder: string): Promise<LibraryEntry> {
    const dir = expandHome(folder);
    const info = await filesPort().stat(dir).catch(() => undefined);
    // A symlink to a folder is one too: what it leads to is checked.
    const real = info && (await filesPort().real(dir));
    const kind = info?.kind === "symlink" && real ? (await filesPort().stat(real))?.kind : info?.kind;
    if (kind !== "dir" || !real) throw new LibraryError("NOT_A_DIRECTORY", `${resolve(dir)} isn't a folder.`);
    const path = real;

    if (!(await gitPort().isRepo(path))) throw new LibraryError("NOT_A_REPO", `${path} isn't a git repository. A book needs one to keep its history and sync with GitHub.`);

    const cover = await coverOf(path);
    if (!cover) throw new LibraryError("NOT_A_NOVEL", `${path} has no ${MANIFEST} or ${NOVEL_MANIFEST}, so it isn't a book Writer can open.`);
    const remote = await remoteOf(path);

    const lastOpened = new Date().toISOString();
    const existing = this.#novels.find((n) => n.path === path);
    const entry: LibraryEntry = { id: existing?.id ?? newId("lib"), path, ...cover, ...(remote ? { remote } : {}), lastOpened };
    this.#novels = [...this.#novels.filter((n) => n !== existing), entry];
    await this.#save();
    return entry;
  }

  /** Forget a novel. Its folder is left alone. */
  async remove(id: string): Promise<boolean> {
    const before = this.#novels.length;
    this.#novels = this.#novels.filter((n) => n.id !== id);
    if (this.#novels.length === before) return false;
    await this.#save();
    return true;
  }

  /** Record that the author opened a novel. */
  async touch(id: string): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new LibraryError("UNKNOWN_NOVEL", `No book ${id} in the library.`);
    entry.lastOpened = new Date().toISOString();
    await this.refresh(id);
  }

  /**
   * Read a novel's title, author and cover from its novel.yaml, and its origin remote, again: the
   * shelf shows them, and the remote may have been added since the novel joined the library.
   */
  async refresh(id: string): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new LibraryError("UNKNOWN_NOVEL", `No book ${id} in the library.`);
    const [cover, remote] = await Promise.all([coverOf(entry.path), remoteOf(entry.path)]);
    if (remote) entry.remote = remote;
    else delete entry.remote;
    if (cover) {
      entry.title = cover.title;
      for (const key of ["author", "cover"] as const) {
        const value = cover[key];
        if (value) entry[key] = value;
        else delete entry[key];
      }
    }
    await this.#save();
  }

  /** Clone a novel with the system git and add it. A failed clone leaves no folder behind. */
  async clone(repo: string, { into, onProgress, signal, auth }: CloneOptions = {}): Promise<LibraryEntry> {
    const url = cloneUrl(repo);
    const dest = resolve(into ? expandHome(into) : join(this.cloneDir, repoName(url)));
    const files = filesPort();
    const existing = (await files.stat(dest))?.kind === "dir" ? await files.list(dest) : undefined;
    if (existing?.length) throw gitFailure("DESTINATION_EXISTS", `destination path '${dest}' already exists and is not an empty directory`);
    const cleanUp = () => files.removeTree(dest).then(() => (existing ? files.makeDir(dest) : undefined));

    await files.makeDir(files.dirname(dest));
    try {
      const credentials = await auth?.(url);
      await gitPort().clone(url, dest, { ...(credentials ? { auth: credentials } : {}), ...(onProgress ? { onProgress } : {}), ...(signal ? { signal } : {}) });
    } catch (e) {
      await cleanUp();
      throw e;
    }
    try {
      return await this.add(dest);
    } catch (e) {
      await cleanUp();
      if (e instanceof LibraryError && e.code === "NOT_A_NOVEL") {
        throw new LibraryError("NOT_A_NOVEL", `${url} has no ${MANIFEST} or ${NOVEL_MANIFEST}, so it isn't a book Writer can open. Nothing was kept.`);
      }
      throw e;
    }
  }

  /** Where a new novel called `title` goes unless the author picks a folder. */
  defaultFolder(title: string): string {
    return join(this.cloneDir, slugify(title) || "novel");
  }

  /** The kinds of book it can start, each with a template: their keys and names ("Novel", "Journal"). */
  async kinds(): Promise<{ key: string; label: string }[]> {
    const has = await Promise.all(knownKinds().map(async (k) => (await filesPort().stat(templateOf(k.key, this.templatesDir)).catch(() => undefined))?.kind === "dir"));
    return knownKinds().flatMap((k, i) => (has[i] ? [{ key: k.key, label: k.label }] : []));
  }

  /**
   * Start a book of `kind` (a novel by default) from its kind's template in `into` (default: a folder
   * named after the title in the clone directory), which must be new or empty, and add it. A failure
   * leaves nothing behind.
   */
  async create({ into, kind = "novel", ...novel }: NewNovel & { into?: string }): Promise<LibraryEntry> {
    const template = templateOf(kind, this.templatesDir);
    const files = filesPort();
    if (!knownKind(kind) || (await files.stat(template).catch(() => undefined))?.kind !== "dir") throw new LibraryError("UNKNOWN_KIND", `Writer can't start a book of the kind “${kind}”.`);
    const dest = resolve(into ? expandHome(into) : this.defaultFolder(novel.title));
    const info = await files.stat(dest).catch(() => undefined);
    if (info && info.kind !== "dir") throw new LibraryError("NOT_A_DIRECTORY", `${dest} is a file, not a folder. Choose another folder.`);
    const existing = info && (await files.list(dest));
    if (existing?.length) throw new LibraryError("NOT_EMPTY", `${dest} already exists and isn't empty. Choose another folder, or a new name.`);
    const cleanUp = () => files.removeTree(dest).then(() => (existing ? files.makeDir(dest) : undefined));

    await files.makeDir(dest);
    try {
      await writeNewBook(template, dest, novel);
      return await this.add(dest);
    } catch (e) {
      await cleanUp();
      if (e instanceof NeedsIdentity) throw new LibraryError("NEEDS_IDENTITY", e.message);
      throw e;
    }
  }

  async #load(): Promise<void> {
    const bytes = await filesPort().read(this.file);
    if (bytes === undefined) return;
    const text = decoder.decode(bytes);
    try {
      const data = JSON.parse(text) as LibraryFile;
      this.#novels = Array.isArray(data.novels) ? data.novels.filter(isEntry) : [];
    } catch {
      const backup = `${this.file}.unreadable-${Date.now()}`;
      await filesPort().rename(this.file, backup);
      this.notices.push({ code: "UNREADABLE", path: backup, message: `The library file couldn't be read, so the library starts empty. The old file is at ${backup}.` });
    }
  }

  /** Saves are queued, and each replaces the file atomically. */
  #save(): Promise<void> {
    const data: LibraryFile = { version: 1, novels: this.#novels };
    this.#saving = this.#saving
      .catch(() => {})
      .then(async () => {
        await filesPort().write(this.file, `${JSON.stringify(data, null, 2)}\n`);
      });
    return this.#saving;
  }
}

/**
 * What the shelf shows of a book, from its manifest (book.yaml, or a novel's novel.yaml): the title
 * (the folder's name without one), the author and the cover image's path. Undefined without a manifest.
 */
async function coverOf(path: string): Promise<{ title: string; author?: string; cover?: string } | undefined> {
  const manifest = await readManifest(bookSource(path));
  if (!manifest) return undefined;
  const data = parseYaml(manifest.text, manifest.file).data as { title?: unknown; author?: unknown; cover?: unknown } | undefined;
  const title = typeof data?.title === "string" && data.title.trim() ? data.title.trim() : basename(path);
  const author = typeof data?.author === "string" ? data.author.trim() : "";
  const cover = typeof data?.cover === "string" ? data.cover.trim() : "";
  return { title, ...(author ? { author } : {}), ...(cover ? { cover } : {}) };
}

/** https://user:token@host/… → https://host/… (an ssh URL's user is not a secret, and stays). */
/** The novel's origin remote, without any credentials embedded in it. */
async function remoteOf(path: string): Promise<string | undefined> {
  return gitPort()
    .remoteUrl(path, "origin")
    .then((url) => (url ? withoutCredentials(url) : undefined))
    .catch(() => undefined);
}

function withoutCredentials(url: string): string {
  return url.replace(/^(https?:\/\/)[^@/]*@/i, "$1");
}

function isEntry(n: unknown): n is LibraryEntry {
  const e = n as LibraryEntry;
  return typeof e === "object" && e !== null && typeof e.id === "string" && typeof e.path === "string" && typeof e.title === "string" && typeof e.lastOpened === "string";
}

/**
 * A path as a person types it: a leading ~ is their home folder, as in a shell. Without this,
 * "~/writer/novel" would be a folder named "~" wherever Writer happened to start.
 */
export function expandHome(path: string): string {
  const p = path.trim();
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(homedir(), p.slice(2));
  return p;
}

const decoder = new TextDecoder();
