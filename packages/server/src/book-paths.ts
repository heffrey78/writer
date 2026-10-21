/** Paths inside a book, which are "/"-separated whatever the host: their parts, without node:path (D16). */

/** The folder a path is in ("" at the top). */
export function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** A path's last part: its file or folder name, less `ext` if it ends with it (as path.posix.basename). */
export function nameOf(path: string, ext = ""): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return ext && name !== ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name;
}

/** The folder a path is in, as path.posix.dirname says it: "." at the top. */
export function dirnameOf(path: string): string {
  return parentOf(path) || ".";
}
