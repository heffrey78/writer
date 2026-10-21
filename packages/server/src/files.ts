import { createHash } from "node:crypto";
import type { WriteHooks } from "./files-port/port.ts";
import { filesPort } from "./ports.ts";

export { TEMP_SUFFIX, type WriteHooks } from "./files-port/port.ts";

/** Largest file the API reads or writes. Scenes are a few kB; this leaves room for long chapters and bibles. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Text files the API writes. Reading is open to any non-hidden UTF-8 file. */
const WRITABLE = /\.(md|markdown|yaml|yml|txt|json)$/i;

/** Pictures: the cover and the bible's, in images/. GitHub refuses files over 100 MB, and so do we. */
export const IMAGES_DIR = "images";
export const MAX_IMAGE_BYTES = 100 * 1024 * 1024;

/** The images the API serves, by extension. Never SVG: it can carry script. */
export const IMAGE_TYPES: Readonly<Record<string, string>> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** An image's media type by its extension, or undefined if it isn't one the API serves. */
export function imageType(path: string): string | undefined {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? undefined : IMAGE_TYPES[path.slice(dot).toLowerCase()];
}

/** The format of image bytes the app saves, from their first bytes: JPEG or PNG, or undefined. */
export function sniffImage(bytes: Uint8Array): { ext: ".jpg" | ".png"; type: string } | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: ".jpg", type: "image/jpeg" };
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => bytes[i] === b)) return { ext: ".png", type: "image/png" };
  return undefined;
}

export type FileErrorCode = "BAD_PATH" | "NOT_FOUND" | "NOT_TEXT" | "TOO_LARGE" | "NOT_WRITABLE" | "NOT_IMAGE";

export class FileError extends Error {
  readonly code: FileErrorCode;

  constructor(code: FileErrorCode, message: string) {
    super(message);
    this.name = "FileError";
    this.code = code;
  }
}

export function hashText(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Check a repository-relative path: "/"-separated, no empty, "." or ".." segments, no hidden segments
 * (".git", ".github", temp files), no backslashes or NUL. Returns it unchanged.
 */
export function checkPath(path: string): string {
  const segments = path.split("/");
  if (
    !path ||
    path.length > 1024 ||
    /[\\\0]/.test(path) ||
    /^[A-Za-z]:/.test(path) ||
    segments.some((s) => s === "" || s.startsWith(".") || s === "node_modules")
  ) {
    throw new FileError("BAD_PATH", `Not a path inside the book: "${path}"`);
  }
  return path;
}

/** Whether a repository-relative path is one the API serves and the watcher reports. */
export function isVisible(path: string): boolean {
  try {
    checkPath(path);
    return true;
  } catch {
    return false;
  }
}

/** The absolute path of `path` under `root`, refusing symlinks that lead out of the novel. */
async function resolveInside(root: string, path: string): Promise<string> {
  return resolveChecked(root, checkPath(path));
}

/** The novel's vendored tools (the novel template's .github/gh-writer/), which a format migration refreshes (D11). */
export const TOOLS_DIR = ".github/gh-writer";

/** Where a book's GitHub workflows are: its kind's template's, which a conversion to another kind replaces. */
export const WORKFLOWS_DIR = ".github/workflows";

/**
 * Check that a path is one of the book's generated files, and return its full path: its vendored tools,
 * its template's workflows, or a diagram snapshot (diagrams/*.svg). Only migrations and conversions
 * write these.
 */
export async function writableToolPath(root: string, path: string): Promise<string> {
  const dir = [TOOLS_DIR, WORKFLOWS_DIR].find((d) => path.startsWith(`${d}/`)) ?? (/^diagrams\/[^/]+\.svg$/.test(path) ? "diagrams" : undefined);
  if (!dir) throw new FileError("NOT_WRITABLE", `Not one of the book's tools: "${path}"`);
  checkPath(path.slice(dir.length + 1));
  return resolveChecked(root, path);
}

async function resolveChecked(root: string, path: string): Promise<string> {
  const files = filesPort();
  const full = files.join(root, path);
  const realRoot = (await files.real(root)) ?? root;
  // The deepest existing ancestor must still be inside the root once symlinks are followed.
  for (let dir = files.dirname(full); ; ) {
    const real = await files.real(dir);
    if (real !== undefined) {
      if (files.relative(realRoot, real) === undefined) throw new FileError("BAD_PATH", `"${path}" leads outside the book.`);
      break;
    }
    const up = files.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  const link = await files.stat(full);
  if (link?.kind === "symlink") throw new FileError("BAD_PATH", `"${path}" is a symbolic link.`);
  if (link?.kind === "dir") throw new FileError("BAD_PATH", `"${path}" is a folder.`);
  return full;
}

export interface TextFile {
  content: string;
  hash: string;
}

/** A UTF-8 file in the novel, or undefined if it doesn't exist. */
export async function readText(root: string, path: string): Promise<TextFile | undefined> {
  const full = await resolveInside(root, path);
  const info = await filesPort().stat(full);
  if (!info) return undefined;
  if (info.size > MAX_FILE_BYTES) throw new FileError("TOO_LARGE", `"${path}" is larger than ${MAX_FILE_BYTES} bytes.`);
  const bytes = await filesPort().read(full);
  if (bytes === undefined) return undefined;
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new FileError("NOT_TEXT", `"${path}" isn't UTF-8 text.`);
  }
  return { content, hash: hashText(bytes) };
}

/** A file's bytes, or undefined if it doesn't exist. */
export async function readBytes(root: string, path: string, max = MAX_IMAGE_BYTES): Promise<{ bytes: Uint8Array; hash: string } | undefined> {
  return bytesAt(await resolveInside(root, path), path, max);
}

/** One of the novel's vendored tools, as bytes and their hash, or undefined if it isn't there. */
export async function readToolBytes(root: string, path: string): Promise<{ bytes: Uint8Array; hash: string } | undefined> {
  return bytesAt(await writableToolPath(root, path), path, MAX_TOOL_BYTES);
}

/** The vendored compiler with its type is the largest tool, at about 1.4 MB. */
const MAX_TOOL_BYTES = 20 * 1024 * 1024;

async function bytesAt(full: string, path: string, max: number): Promise<{ bytes: Uint8Array; hash: string } | undefined> {
  const info = await filesPort().stat(full);
  if (info?.kind !== "file") return undefined;
  if (info.size > max) throw new FileError("TOO_LARGE", `"${path}" is larger than ${max} bytes.`);
  const bytes = await filesPort().read(full);
  return bytes && { bytes, hash: hashText(bytes) };
}

/**
 * An image in images/ the API may serve: its full path, media type and size, or undefined if it
 * isn't there. Anything outside images/, or not an image by its extension, is BAD_PATH.
 */
export async function servableImage(root: string, path: string): Promise<{ full: string; type: string; size: number; mtimeMs: number } | undefined> {
  const type = imageType(path);
  if (!path.startsWith(`${IMAGES_DIR}/`) || !type) throw new FileError("BAD_PATH", `Only images in ${IMAGES_DIR}/ are served: "${path}"`);
  const full = await resolveInside(root, path);
  const info = await filesPort().stat(full);
  if (info?.kind !== "file") return undefined;
  if (info.size > MAX_IMAGE_BYTES) throw new FileError("TOO_LARGE", `"${path}" is larger than ${MAX_IMAGE_BYTES} bytes.`);
  return { full, type, size: info.size, mtimeMs: info.mtimeMs };
}

/**
 * A version of the picture at `path` in images/ (its size and modification time), for the app to put
 * in its URL so a replaced picture is fetched anew; undefined if it isn't a file in images/.
 */
export async function imageVersion(root: string, path: string | undefined): Promise<string | undefined> {
  if (!path?.startsWith(`${IMAGES_DIR}/`) || !isVisible(path)) return undefined;
  const info = await filesPort().stat(filesPort().join(root, path));
  return info?.kind === "file" ? `${info.size.toString(36)}-${Math.round(info.mtimeMs).toString(36)}` : undefined;
}

/** Check that image `bytes` may be written to `path` (in images/, JPEG or PNG, not too large), and return its full path. */
export async function writableImagePath(root: string, path: string, bytes: Uint8Array): Promise<string> {
  if (!path.startsWith(`${IMAGES_DIR}/`) || !imageType(path)) throw new FileError("NOT_WRITABLE", `Images are written to ${IMAGES_DIR}/ only: "${path}"`);
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new FileError("TOO_LARGE", `The image is larger than ${MAX_IMAGE_BYTES} bytes.`);
  if (!sniffImage(bytes)) throw new FileError("NOT_IMAGE", "That isn't a JPEG or PNG image.");
  return resolveInside(root, path);
}

/** Check that `content` may be written to `path`, and return its full path. */
export async function writablePath(root: string, path: string, content: string): Promise<string> {
  if (!WRITABLE.test(path)) throw new FileError("NOT_WRITABLE", `Only text files can be written (.md, .yaml, .txt, .json): "${path}"`);
  if (!content.isWellFormed()) throw new FileError("NOT_TEXT", "The content isn't valid Unicode text.");
  if (new TextEncoder().encode(content).byteLength > MAX_FILE_BYTES) throw new FileError("TOO_LARGE", `The content is larger than ${MAX_FILE_BYTES} bytes.`);
  return resolveInside(root, path);
}

/**
 * Replace `full` with `content` so that a crash at any point leaves the old file or the new one, never a
 * mix: the files port's write (a temp file in the same folder, flushed, renamed over the target, the
 * folder flushed). The file keeps its permissions.
 */
export function atomicWrite(full: string, content: string | Uint8Array, hooks: WriteHooks = {}): Promise<void> {
  return filesPort().write(full, content, hooks);
}

/** Whether two files' bytes are the same. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);
}

/** Every file under `dir` (a host path), as "/"-separated paths from it, sorted; none if it isn't there. */
export async function filesUnder(dir: string): Promise<string[]> {
  return (await filesPort().list(dir, { recursive: true })).filter((e) => e.kind === "file").map((e) => e.path);
}
