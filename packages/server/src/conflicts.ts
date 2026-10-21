import { merge3, type MergeChunk } from "@writer/core";
import { hashText } from "./files.ts";
import { text, type TreeEdit } from "./git-port/port.ts";
import { gitPort } from "./ports.ts";

/** A file both sides changed in ways that don't merge by themselves. */
export interface ConflictFile {
  /** Relative to the novel's folder. */
  path: string;
  /** Hash of our version (as the files API reports it), or null if we deleted the file: sent back with the resolution. */
  ours: string | null;
  /** Whether each side still has the file. */
  inOurs: boolean;
  inTheirs: boolean;
  /** Not text: only one side or the other can be kept. */
  binary: boolean;
  /** The merge, with conflicts where both sides changed the same paragraph or field. */
  chunks: MergeChunk[];
}

export interface Conflicts {
  /** The remote commit being merged: sent back with the resolution, which is refused if the remote moved. */
  upstream: string;
  files: ConflictFile[];
}

/** How a conflicting file ends up: new text, the file deleted (null), or one side's version kept as it is. */
export type FileResolution = { ours: string | null } & ({ content: string | null } | { keep: "ours" | "theirs" });

export type ConflictErrorCode = "NO_CONFLICT" | "STALE" | "BAD_RESOLUTION";

export class ConflictError extends Error {
  readonly code: ConflictErrorCode;

  constructor(code: ConflictErrorCode, message: string) {
    super(message);
    this.name = "ConflictError";
    this.code = code;
  }
}

/** One conflicted path of a prepared merge. */
interface PreparedFile extends ConflictFile {
  /** Repository-relative. */
  repoPath: string;
  /** The merged text, when merge3 settled every conflict by itself. */
  merged?: string;
}

export interface PreparedMerge {
  head: string;
  upstream: string;
  /** git's merge of the two: the tree for every path that merged cleanly. */
  tree: string;
  files: PreparedFile[];
}

/** What a merge commit does with a path that git couldn't merge. */
type Settled = { content: string } | { keep: string } | { remove: true };

/**
 * Merge HEAD with `upstream` in memory: git merges what it can, and each path it can't is merged
 * again with core's merge3, paragraph by paragraph and front matter field by field. Nothing in the
 * work tree changes.
 */
export async function prepareMerge(root: string, upstreamRef: string): Promise<PreparedMerge> {
  const git = gitPort();
  const rev = async (r: string) => {
    const commit = await git.resolve(root, r);
    if (!commit) throw new Error(`No commit ${r}.`);
    return commit;
  };
  const [head, upstream] = [await rev("HEAD"), await rev(upstreamRef)];
  const base = await git.mergeBase(root, head, upstream);
  // Repository paths: the merge's are the whole repository's.
  const { tree, conflicts } = await git.mergeTrees(root, head, upstream);
  const prefix = await git.prefix(root);
  const blob = (rev: string, repoPath: string) => readRepoFile(root, prefix, rev, repoPath);

  const files: PreparedFile[] = [];
  for (const repoPath of conflicts) {
    const [b, o, t] = await Promise.all([base ? blob(base, repoPath) : undefined, blob(head, repoPath), blob(upstream, repoPath)]);
    const path = prefix && repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : repoPath;
    const binary = [b, o, t].some((x) => x !== undefined && x.includes(0));
    const common = { path, repoPath, ours: o === undefined ? null : hashText(o), inOurs: o !== undefined, inTheirs: t !== undefined, binary };
    const str = (x: Uint8Array | undefined) => (x ? text(x) : "");
    if (binary || o === undefined || t === undefined) {
      // Deleted on one side, or not text: a whole-file choice.
      files.push({ ...common, chunks: [{ type: "conflict", base: binary ? "" : str(b), ours: binary ? "" : str(o), theirs: binary ? "" : str(t) }] });
      continue;
    }
    const merged = merge3(str(b), str(o), str(t));
    files.push({ ...common, chunks: merged.chunks, ...(merged.text !== undefined ? { merged: merged.text } : {}) });
  }
  return { head, upstream, tree, files };
}

/** The conflicts the author has to settle: files merge3 couldn't settle alone. */
export function openConflicts(prepared: PreparedMerge): Conflicts {
  return {
    upstream: prepared.upstream,
    files: prepared.files.filter((f) => f.merged === undefined).map(({ repoPath: _r, merged: _m, ...file }) => file),
  };
}

/**
 * Commit the merge of `prepared`: the files merge3 settled, plus `resolutions` (by novel path) for the
 * rest, and move the branch and work tree to it. The commit has both sides as parents, so every local
 * commit stays in history. HEAD must not have moved since `prepared` was made.
 */
export async function commitMerge(root: string, prepared: PreparedMerge, resolutions: Record<string, FileResolution>, message: string): Promise<string> {
  const settled = new Map<string, Settled>();
  for (const file of prepared.files) {
    if (file.merged !== undefined) {
      settled.set(file.repoPath, { content: file.merged });
      continue;
    }
    const r = resolutions[file.path];
    if (!r) throw new ConflictError("BAD_RESOLUTION", `No resolution for "${file.path}".`);
    if (r.ours !== file.ours) throw new ConflictError("STALE", `"${file.path}" changed since the conflict was shown.`);
    if ("keep" in r) {
      const side = r.keep === "ours" ? prepared.head : prepared.upstream;
      settled.set(file.repoPath, (r.keep === "ours" ? file.inOurs : file.inTheirs) ? { keep: side } : { remove: true });
    } else if (r.content === null) settled.set(file.repoPath, { remove: true });
    else if (file.binary) throw new ConflictError("BAD_RESOLUTION", `"${file.path}" isn't text: keep one side.`);
    else settled.set(file.repoPath, { content: r.content });
  }
  const extra = Object.keys(resolutions).filter((p) => !prepared.files.some((f) => f.path === p));
  if (extra.length) throw new ConflictError("BAD_RESOLUTION", `No conflict in ${extra.map((p) => `"${p}"`).join(", ")}.`);

  // The tree is built in memory, so the index and the work tree are untouched until the end.
  const git = gitPort();
  const prefix = await git.prefix(root);
  /** The path's mode and blob at `rev` (repository path), or undefined. */
  const entry = async (rev: string, repoPath: string) => {
    const path = fromFolder(prefix, repoPath);
    return (await git.listTree(root, rev, path)).find((e) => e.path === path);
  };
  const edits: TreeEdit[] = [];
  for (const [repoPath, how] of settled) {
    if ("remove" in how) edits.push({ path: repoPath, remove: true });
    else if ("keep" in how) {
      const kept = (await entry(how.keep, repoPath))!;
      edits.push({ path: repoPath, oid: kept.oid, mode: kept.mode });
    } else {
      // Merged text keeps our file's mode (or theirs, for a file both added).
      const mode = (await entry(prepared.head, repoPath))?.mode ?? (await entry(prepared.upstream, repoPath))?.mode ?? "100644";
      edits.push({ path: repoPath, content: how.content, mode });
    }
  }
  const tree = await git.buildTree(root, prepared.tree, edits);
  const commit = await git.commitTree(root, tree, [prepared.head, prepared.upstream], message);
  // HEAD is the merge's first parent, so this fast-forwards the branch, index and work tree to it.
  await git.fastForward(root, commit);
  return commit;
}

/** Resolutions as a request sends them, by path; undefined when malformed. */
export function parseResolutions(value: unknown): Record<string, FileResolution> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, FileResolution> = {};
  for (const [path, r] of Object.entries(value as Record<string, unknown>)) {
    if (!r || typeof r !== "object") return undefined;
    const { ours, content, keep } = r as { ours?: unknown; content?: unknown; keep?: unknown };
    if (ours !== null && typeof ours !== "string") return undefined;
    if (keep === "ours" || keep === "theirs") out[path] = { ours, keep };
    else if (content === null || (typeof content === "string" && content.isWellFormed())) out[path] = { ours, content };
    else return undefined;
  }
  return out;
}

/** A file's bytes at `rev`, by its repository path, or undefined if it isn't there. */
async function readRepoFile(root: string, prefix: string, rev: string, repoPath: string): Promise<Uint8Array | undefined> {
  return (await gitPort().readFile(root, rev, fromFolder(prefix, repoPath))) ?? undefined;
}

/** A repository path as the book's folder (at `prefix`) reaches it: inside it, or by "../" outside it. */
function fromFolder(prefix: string, repoPath: string): string {
  return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : `${"../".repeat(prefix.split("/").filter(Boolean).length)}${repoPath}`;
}
