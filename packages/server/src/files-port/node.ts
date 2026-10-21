import { randomBytes } from "node:crypto";
import { copyFile, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, rmdir, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { watch } from "chokidar";
import { TEMP_SUFFIX, type FileKind, type FilesPort } from "./port.ts";

/** The files port over node:fs, and chokidar for watching. */

const missing = (e: unknown) => ["ENOENT", "ENOTDIR"].includes((e as NodeJS.ErrnoException).code ?? "");
const kindOf = (e: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): FileKind =>
  e.isSymbolicLink() ? "symlink" : e.isDirectory() ? "dir" : e.isFile() ? "file" : "other";

async function syncDir(dir: string): Promise<void> {
  // Windows can't open a folder for fsync; NTFS journals the rename itself.
  if (process.platform === "win32") return;
  const handle = await open(dir, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export const nodeFilesPort: FilesPort = {
  read: (path) =>
    readFile(path).then(
      (b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength),
      (e: unknown) => {
        if (missing(e) || (e as NodeJS.ErrnoException).code === "EISDIR") return undefined;
        throw e;
      },
    ),
  stat: async (path) => {
    const info = await lstat(path).catch((e: unknown) => {
      if (missing(e)) return undefined;
      throw e;
    });
    return info && { kind: kindOf(info), size: info.size, mtimeMs: info.mtimeMs };
  },
  list: async (path, { recursive = false } = {}) => {
    const entries = await readdir(path, { withFileTypes: true, recursive }).catch((e: unknown) => {
      if (missing(e)) return [];
      throw e;
    });
    return entries
      .map((e) => ({ path: relative(path, join(e.parentPath, e.name)).split(sep).join("/"), kind: kindOf(e) }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  },
  write: async (full, content, hooks = {}) => {
    const dir = dirname(full);
    await mkdir(dir, { recursive: true });
    const mode = (await stat(full).catch(() => undefined))?.mode;
    const temp = join(dir, `.${basename(full)}.${randomBytes(6).toString("hex")}${TEMP_SUFFIX}`);
    const handle = await open(temp, "wx", mode === undefined ? 0o644 : mode & 0o777);
    try {
      await (typeof content === "string" ? handle.writeFile(content, "utf8") : handle.writeFile(content));
      await handle.sync();
    } catch (e) {
      await handle.close();
      await unlink(temp).catch(() => {});
      throw e;
    }
    await handle.close();
    try {
      await hooks.beforeRename?.(temp);
      await rename(temp, full);
    } catch (e) {
      await unlink(temp).catch(() => {});
      throw e;
    }
    await syncDir(dir);
  },
  remove: (path) =>
    unlink(path).catch((e: unknown) => {
      if (!missing(e)) throw e;
    }),
  removeTree: (path) => rm(path, { recursive: true, force: true }),
  removeEmptyDir: (path) =>
    rmdir(path).then(
      () => true,
      () => false,
    ),
  rename: (from, to) => rename(from, to),
  makeDir: async (path) => void (await mkdir(path, { recursive: true })),
  copy: (from, to) => copyFile(from, to),
  real: (path) => realpath(path).catch(() => undefined),

  join: (root, ...parts) => join(root, ...parts.flatMap((p) => p.split("/"))),
  dirname: (path) => dirname(path),
  relative: (root, path) => {
    const rel = relative(root, path);
    return rel.startsWith("..") || rel.startsWith(sep) || /^[A-Za-z]:/.test(rel) ? undefined : rel.split(sep).join("/");
  },

  watch: async (root, ignore, onChange) => {
    const rel = (abs: string) => relative(root, abs).split(sep).join("/");
    const watcher = watch(root, {
      ignoreInitial: true,
      ignored: (abs) => {
        const path = rel(abs);
        return path !== "" && ignore(path);
      },
    });
    for (const type of ["add", "change", "unlink"] as const) watcher.on(type, (abs: string) => onChange(type, rel(abs)));
    await new Promise<void>((resolve) => watcher.once("ready", () => resolve()));
    return () => watcher.close();
  },
};
