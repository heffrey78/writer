/**
 * D16 spike (#45): the git operations Writer's server uses, as a port an engine could be given. Each is
 * named for what the app needs, not for a git command: docs/architecture/d16-spike.md maps them to the
 * commands the server runs today. Paths are relative to the repository's top.
 */

/** The server's GitFailure codes, and NOT_FAST_FORWARD for a fast-forward that isn't one. */
export type GitPortCode = "AUTH" | "SCOPE" | "NOT_FOUND" | "NETWORK" | "REJECTED" | "DESTINATION_EXISTS" | "NOT_FAST_FORWARD" | "GIT";

export class GitPortError extends Error {
  readonly code: GitPortCode;
  constructor(code: GitPortCode, message: string) {
    super(message);
    this.name = "GitPortError";
    this.code = code;
  }
}

export interface Ref {
  name: string;
  oid: string | null;
  /** The commit's committer date, as %cI; null for a ref to a tag object. */
  date: string | null;
  symref: string | null;
}

export interface Tag {
  name: string;
  /** The commit it points at. */
  commit: string;
  annotated: boolean;
  /** The tagger's date for an annotated tag, else the commit's. */
  date: string | null;
  message: string;
}

/** A path in `git status --porcelain`: its index (x) and work tree (y) letters; `from` for a rename. */
export interface StatusEntry {
  path: string;
  x: string;
  y: string;
  from?: string;
}

/** A change as `--name-status -M --raw` gives it. */
export interface Change {
  status: "A" | "M" | "D" | "R" | "C" | "T";
  path: string;
  from?: string;
  old: string;
  new: string;
}

export interface LogEntry {
  oid: string;
  parents: string[];
  committed: string;
  authored: string;
  summary: string;
}

export interface CommitInfo {
  oid: string;
  tree: string;
  parents: string[];
  message: string;
  author: { name: string; email: string };
  authored: string;
  committed: string;
}

export interface TreeEntry {
  path: string;
  mode: string;
  oid: string;
}

/** How one path ends up in a tree built from another. */
export type TreeEdit = { path: string; remove: true } | { path: string; content: Buffer; mode?: string } | { path: string; oid: string; mode: string };

/** Writer's token for a remote on GitHub. */
export interface Auth {
  token: string;
}

export interface GitPort {
  readonly name: string;
  version(): Promise<string>;

  // The repository.
  init(dir: string, branch: string): Promise<void>;
  isRepo(dir: string): Promise<boolean>;
  clone(url: string, dest: string, auth?: Auth): Promise<void>;

  // Refs: commits, branches, tags.
  /** A revision's commit, or null. */
  resolve(dir: string, rev: string): Promise<string | null>;
  /** The branch HEAD names, born or not; null when detached. */
  currentBranch(dir: string): Promise<string | null>;
  refs(dir: string, prefix: string): Promise<Ref[]>;
  tags(dir: string): Promise<Tag[]>;
  /** A branch at `from`, switched to; `track` its upstream ("origin/x"). */
  createBranch(dir: string, name: string, from: string, track?: string): Promise<void>;
  switchBranch(dir: string, name: string): Promise<void>;
  deleteBranch(dir: string, name: string): Promise<void>;
  /** An annotated tag at HEAD. */
  tag(dir: string, name: string, message: string): Promise<void>;

  // Configuration and remotes.
  getConfig(dir: string, key: string): Promise<string | null>;
  setConfig(dir: string, key: string, value: string): Promise<void>;
  remoteUrl(dir: string, name: string): Promise<string | null>;
  addRemote(dir: string, name: string, url: string): Promise<void>;

  // The work tree and index.
  status(dir: string): Promise<StatusEntry[]>;
  /** git add -A (of `paths`, or everything). */
  stage(dir: string, paths?: string[]): Promise<void>;
  /** git rm. */
  remove(dir: string, paths: string[]): Promise<void>;
  stagedChanges(dir: string): Promise<Change[]>;
  /** A commit of the index on HEAD, the message cleaned up as git commit -m does; or HEAD amended. */
  commit(dir: string, message: string, options?: { amend?: boolean }): Promise<string>;
  commitInfo(dir: string, rev: string): Promise<CommitInfo>;
  /** git restore --source=<rev> --staged --worktree -- <paths>. */
  restore(dir: string, rev: string, paths: string[]): Promise<void>;
  /** git merge --ff-only: NOT_FAST_FORWARD if it isn't one; a local change it would overwrite stops it. */
  fastForward(dir: string, rev: string): Promise<void>;

  // History.
  log(dir: string, options?: { rev?: string; path?: string; limit?: number }): Promise<LogEntry[]>;
  /** Each commit's changes, oldest first, merges left out. */
  history(dir: string): Promise<{ oid: string; authored: string; files: Change[] }[]>;
  readFile(dir: string, rev: string, path: string): Promise<Buffer | null>;
  listTree(dir: string, rev: string, path?: string): Promise<TreeEntry[]>;
  readBlobs(dir: string, oids: string[]): Promise<Map<string, Buffer>>;
  count(dir: string, rev: string): Promise<number>;
  aheadBehind(dir: string, a: string, b: string): Promise<{ ahead: number; behind: number }>;
  mergeBase(dir: string, a: string, b: string): Promise<string | null>;
  isAncestor(dir: string, a: string, b: string): Promise<boolean>;

  // Merging, in memory.
  /** The merge of two commits: a tree, and the paths that didn't merge (what the tree holds for those is the adapter's). */
  mergeTrees(dir: string, ours: string, theirs: string): Promise<{ tree: string; conflicts: string[] }>;
  buildTree(dir: string, base: string, edits: TreeEdit[]): Promise<string>;
  /** A commit object, the message as given. */
  commitTree(dir: string, tree: string, parents: string[], message: string): Promise<string>;
  /** Our commits replayed on `onto`; on a conflict, nothing done and the paths returned. */
  rebase(dir: string, onto: string): Promise<{ conflicts: string[] }>;

  // Remotes.
  fetch(dir: string, remote: string, refspecs: string[], options?: { prune?: boolean; auth?: Auth }): Promise<void>;
  push(dir: string, remote: string, refspecs: string[], options?: { setUpstream?: boolean; auth?: Auth }): Promise<void>;
}
