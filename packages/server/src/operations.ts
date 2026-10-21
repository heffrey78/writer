import { parentOf } from "./book-paths.ts";
import { hasGitIdentity, IDENTITY_MESSAGE } from "./committer.ts";
import { atomicWrite, readBytes, readToolBytes, writableImagePath, writablePath, writableToolPath } from "./files.ts";
import { filesPort, gitPort } from "./ports.ts";

/** One file an operation writes (new text, or an image's bytes) or deletes (null). */
export interface FileWrite {
  path: string;
  content: string | Uint8Array | null;
  /** The hash the caller read: the change is refused if the file is different now. Null: must not exist. Omitted: not checked. */
  base?: string | null;
  /** One of the book's generated files (its tools in .github/gh-writer/, workflows, diagram snapshots), written only by a migration or conversion. */
  tool?: true;
}

export type OperationErrorCode = "BAD_REQUEST" | "NOT_FOUND" | "STALE" | "REFERENCED" | "BLOCKED" | "NEEDS_MIGRATION" | "NOTES_LEFT";

export class OperationError extends Error {
  readonly code: OperationErrorCode;
  /** More for the client: the references that block a delete, the file that changed. */
  readonly details: Record<string, unknown>;

  constructor(code: OperationErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "OperationError";
    this.code = code;
    this.details = details;
  }
}

export interface OperationResult {
  /** The commit that recorded it, or null if nothing changed. */
  commit: string | null;
  /** The files written or deleted. */
  files: string[];
}

/**
 * Apply `changes` to the novel at `root` as one unit and commit them as `message`. Every file is
 * checked against its base first; then they're written one by one (each atomically), and if any write
 * fails, the ones already made are put back as they were. Only these paths are committed: other saved
 * work stays for the background committer. Run it inside the workspace's exclusive section.
 */
export async function transaction(root: string, changes: FileWrite[], message: string): Promise<OperationResult> {
  if (!changes.length) return { commit: null, files: [] };
  if (!(await hasGitIdentity(root))) throw new OperationError("BLOCKED", IDENTITY_MESSAGE);

  // What's there now, for the base checks and to put back: as bytes, since images are among them.
  const before = new Map<string, Uint8Array | null>();
  for (const change of changes) {
    const current = change.tool ? await readToolBytes(root, change.path) : await readBytes(root, change.path);
    if (change.base !== undefined && (current?.hash ?? null) !== change.base) {
      throw new OperationError("STALE", `“${change.path}” changed since it was read.`, { path: change.path });
    }
    before.set(change.path, current?.bytes ?? null);
  }

  const done: string[] = [];
  try {
    for (const change of changes) {
      const { content } = change;
      if (content === null) await remove(root, change.path);
      else if (change.tool) await atomicWrite(await writableToolPath(root, change.path), content);
      else if (typeof content === "string") await atomicWrite(await writablePath(root, change.path, content), content);
      else await atomicWrite(await writableImagePath(root, change.path, content), content);
      done.push(change.path);
    }
  } catch (e) {
    for (const path of done.reverse()) {
      const old = before.get(path)!;
      if (old === null) await remove(root, path).catch(() => {});
      else await atomicWrite(filesPort().join(root, path), old).catch(() => {});
    }
    throw e;
  }

  const paths = [...new Set(changes.map((c) => c.path))];
  await gitPort().stage(root, { paths });
  return { commit: await gitPort().commit(root, message, { paths }), files: paths };
}

/** Delete a file, and the folders it leaves empty up to the novel's root. */
async function remove(root: string, path: string): Promise<void> {
  const files = filesPort();
  await files.remove(files.join(root, path));
  for (let dir = parentOf(path); dir !== ""; dir = parentOf(dir)) {
    if (!(await files.removeEmptyDir(files.join(root, dir)))) break;
  }
}
