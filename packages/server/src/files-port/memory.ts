import { TEMP_SUFFIX, type FileEventType, type FileInfo, type FilesPort, type ListEntry } from "./port.ts";

/**
 * The files port in memory, for tests of the engine without a disk: "/"-separated absolute paths, folders
 * made as files are written into them, no symlinks. Changes made through it reach its watchers, as an
 * outside change would. `files` seeds it, by path.
 */
export function memoryFilesPort(seed: Record<string, string | Uint8Array> = {}): FilesPort & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>(["/"]);
  const times = new Map<string, number>();
  const watchers = new Set<{ root: string; ignore: (p: string) => boolean; onChange: (t: FileEventType, p: string) => void }>();
  const encoder = new TextEncoder();
  let clock = 0;
  let n = 0;

  const norm = (path: string) => `/${path.split("/").filter(Boolean).join("/")}`;
  const parent = (path: string) => norm(path.split("/").slice(0, -1).join("/"));
  const under = (dir: string, path: string) => (dir === "/" ? path !== "/" : path.startsWith(`${dir}/`));
  const makeDirs = (dir: string) => {
    for (let d = norm(dir); ; d = parent(d)) {
      dirs.add(d);
      if (d === "/") break;
    }
  };
  const tell = (type: FileEventType, path: string) => {
    for (const w of watchers) {
      if (!under(w.root, path)) continue;
      const rel = path.slice(w.root === "/" ? 1 : w.root.length + 1);
      if (!w.ignore(rel)) w.onChange(type, rel);
    }
  };
  const put = (path: string, data: Uint8Array) => {
    const existed = files.has(path);
    makeDirs(parent(path));
    files.set(path, data);
    times.set(path, ++clock);
    tell(existed ? "change" : "add", path);
  };
  const drop = (path: string) => {
    if (!files.delete(path)) return;
    times.delete(path);
    tell("unlink", path);
  };
  for (const [path, data] of Object.entries(seed)) put(norm(path), typeof data === "string" ? encoder.encode(data) : data);

  const port: FilesPort & { files: Map<string, Uint8Array> } = {
    files,
    read: async (path) => files.get(norm(path)),
    stat: async (path): Promise<FileInfo | undefined> => {
      const p = norm(path);
      if (files.has(p)) return { kind: "file", size: files.get(p)!.byteLength, mtimeMs: times.get(p)! };
      return dirs.has(p) ? { kind: "dir", size: 0, mtimeMs: 0 } : undefined;
    },
    list: async (path, { recursive = false } = {}) => {
      const dir = norm(path);
      if (!dirs.has(dir)) return [];
      const out: ListEntry[] = [];
      const rel = (p: string) => p.slice(dir === "/" ? 1 : dir.length + 1);
      for (const d of dirs) if (under(dir, d) && (recursive || parent(d) === dir)) out.push({ path: rel(d), kind: "dir" });
      for (const f of files.keys()) if (under(dir, f) && (recursive || parent(f) === dir)) out.push({ path: rel(f), kind: "file" });
      return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    },
    write: async (path, data, hooks = {}) => {
      const p = norm(path);
      const temp = `${parent(p)}/.${p.split("/").at(-1)}.${(++n).toString(16)}${TEMP_SUFFIX}`;
      const bytes = typeof data === "string" ? encoder.encode(data) : new Uint8Array(data);
      makeDirs(parent(p));
      files.set(temp, bytes);
      try {
        await hooks.beforeRename?.(temp);
      } catch (e) {
        files.delete(temp);
        throw e;
      }
      files.delete(temp);
      put(p, bytes);
    },
    remove: async (path) => drop(norm(path)),
    removeTree: async (path) => {
      const p = norm(path);
      for (const f of [...files.keys()]) if (f === p || under(p, f)) drop(f);
      for (const d of [...dirs]) if (d === p || under(p, d)) dirs.delete(d);
    },
    removeEmptyDir: async (path) => {
      const p = norm(path);
      if ([...files.keys(), ...dirs].some((x) => under(p, x))) return false;
      return dirs.delete(p);
    },
    rename: async (from, to) => {
      const [f, t] = [norm(from), norm(to)];
      const data = files.get(f);
      if (data === undefined) throw Object.assign(new Error(`ENOENT: no such file, rename '${from}'`), { code: "ENOENT" });
      drop(f);
      put(t, data);
    },
    makeDir: async (path) => makeDirs(path),
    copy: async (from, to) => {
      const data = files.get(norm(from));
      if (data === undefined) throw Object.assign(new Error(`ENOENT: no such file, copy '${from}'`), { code: "ENOENT" });
      put(norm(to), new Uint8Array(data));
    },
    real: async (path) => {
      const p = norm(path);
      return files.has(p) || dirs.has(p) ? p : undefined;
    },
    join: (root, ...parts) => norm([root, ...parts].join("/")),
    dirname: (path) => parent(norm(path)),
    relative: (root, path) => {
      const [r, p] = [norm(root), norm(path)];
      if (p === r) return "";
      return under(r, p) ? p.slice(r === "/" ? 1 : r.length + 1) : undefined;
    },
    watch: async (root, ignore, onChange) => {
      const w = { root: norm(root), ignore, onChange };
      watchers.add(w);
      return async () => void watchers.delete(w);
    },
  };
  return port;
}
