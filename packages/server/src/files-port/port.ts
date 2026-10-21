import type { DirEntry, FileSource } from "@writer/core";

/**
 * The files port (D16): the server's reach into the disk, as primitives. The rules about which paths a
 * book may have, symlinks that lead out of it, and writes refused when a file changed underneath stay
 * in the server (files.ts), over these, so every host keeps them alike. On Node it's node:fs (node.ts);
 * on Android, the app's storage; in tests, memory (memory.ts). One contract suite holds each to it
 * (test/files-port.test.ts). Nothing here imports node:.
 *
 * Paths are the host's own, absolute, made with `join` from a root and "/"-separated parts.
 */

export type FileKind = "file" | "dir" | "symlink" | "other";

export interface FileInfo {
  kind: FileKind;
  size: number;
  mtimeMs: number;
}

export interface ListEntry {
  /** From the folder listed, "/"-separated. */
  path: string;
  kind: FileKind;
}

/** What `write` lets a test do between writing the temporary file and putting it in place. */
export interface WriteHooks {
  /** Called once the temp file is on disk, before it replaces the target (fault-injection tests). */
  beforeRename?: (temp: string) => void | Promise<void>;
}

export type FileEventType = "add" | "change" | "unlink";

/** Suffix of the temporary files atomic writes leave behind if the process dies mid-write. */
export const TEMP_SUFFIX = ".ghw-tmp";

export interface FilesPort {
  /** A file's bytes, or undefined if there's no file there. */
  read(path: string): Promise<Uint8Array | undefined>;
  /** What's at `path`, not following a symlink there; undefined if nothing is. */
  stat(path: string): Promise<FileInfo | undefined>;
  /** A folder's entries (or with `recursive`, everything under it), by path; empty if it isn't a folder. */
  list(path: string, options?: { recursive?: boolean }): Promise<ListEntry[]>;
  /**
   * Put `data` at `path` so that a crash at any point leaves the old file or the new one, never a mix:
   * a temporary file (`.<name>.<random>` + TEMP_SUFFIX) in the same folder, made with its parents if
   * missing, flushed to disk, renamed over the target, and the folder flushed so the rename lasts. The
   * file keeps its permissions.
   */
  write(path: string, data: string | Uint8Array, hooks?: WriteHooks): Promise<void>;
  /** A file gone; nothing if it isn't there. */
  remove(path: string): Promise<void>;
  /** A folder and everything in it gone; nothing if it isn't there. */
  removeTree(path: string): Promise<void>;
  /** An empty folder gone: false (and kept) if it isn't empty. */
  removeEmptyDir(path: string): Promise<boolean>;
  rename(from: string, to: string): Promise<void>;
  /** A folder, with its parents. */
  makeDir(path: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  /** `path` with every symlink in it followed; undefined if nothing is there. */
  real(path: string): Promise<string | undefined>;

  /** `root` joined with "/"-separated parts, as this host writes paths. */
  join(root: string, ...parts: string[]): string;
  dirname(path: string): string;
  /** `path` under `root`, "/"-separated; undefined if it isn't under it. */
  relative(root: string, path: string): string | undefined;

  /**
   * Report additions, changes and removals of files under `root` made by anyone (another app, git, a
   * sync), by path from `root`; `ignore` (by path from `root`) leaves some out. Resolves once watching,
   * with the function that stops it.
   */
  watch(root: string, ignore: (path: string) => boolean, onChange: (type: FileEventType, path: string) => void): Promise<() => Promise<void>>;
}

const decoder = new TextDecoder();

/** A book's files through a files port, as core's loader reads them. Hidden entries (".git", ".github", ...) are not listed. */
export function portSource(files: FilesPort, root: string): FileSource {
  return {
    async list(dir) {
      return (await files.list(dir ? files.join(root, ...dir.split("/")) : root))
        .filter((e) => !e.path.startsWith("."))
        .map((e): DirEntry => ({ name: e.path, dir: e.kind === "dir" }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async read(path) {
      const bytes = await files.read(files.join(root, ...path.split("/")));
      return bytes === undefined ? undefined : decoder.decode(bytes);
    },
  };
}
