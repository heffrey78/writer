/**
 * The git port (D16): every git operation the server needs, named for what it needs, not for a git
 * command. The host gives the server one (ports.ts): on Node, git itself (node.ts); on Android, libgit2
 * (packages/git2-port). Both pass one contract suite (test/git-port.test.ts). docs/architecture/d16-spike.md
 * maps the operations to the commands the server ran before.
 *
 * `dir` is a book's folder: the repository's top, or a folder in it. Paths given and returned are
 * relative to it, and listing, staging and committing stay inside it (or inside `paths` in it), except
 * the in-memory merge's, which are the repository's (see `prefix`). Nothing here imports node:.
 */

/** Stable codes for what went wrong, so the UI can say what to do. */
export type GitErrorCode = "AUTH" | "SCOPE" | "NOT_FOUND" | "NETWORK" | "REJECTED" | "DESTINATION_EXISTS" | "GIT_MISSING" | "BAD_REPO" | "NOT_FAST_FORWARD" | "GIT";

export class GitFailure extends Error {
  readonly code: GitErrorCode;
  /** git's own output, for a "details" disclosure. */
  readonly detail: string;

  constructor(code: GitErrorCode, message: string, detail = "") {
    super(message);
    this.name = "GitFailure";
    this.code = code;
    this.detail = detail;
  }
}

export const GUIDANCE: Record<Exclude<GitErrorCode, "GIT" | "NOT_FAST_FORWARD">, string> = {
  AUTH:
    "GitHub didn't accept your credentials, or none are set up. Connect Writer to GitHub (Connect GitHub, at the top of the page); or for an https:// address, run `gh auth setup-git` " +
    "(or sign in with Git Credential Manager); for a git@github.com: address, add an SSH key to GitHub " +
    "(https://github.com/settings/keys) and load it with ssh-add. Then try again.",
  SCOPE:
    "GitHub won't let Writer add or change the book's GitHub workflows (.github/workflows) without the workflow permission. " +
    "Reconnect to GitHub with a code to grant it: Sign out of GitHub, then Connect GitHub. (With gh's account, run `gh auth refresh -s workflow` first.)",
  NOT_FOUND: "No repository at that address. Check the owner and name, and that your GitHub account can see it.",
  NETWORK: "Couldn't reach the server. Check your connection and try again.",
  REJECTED: "The remote has changes this copy doesn't have yet: bring them in, then push again.",
  DESTINATION_EXISTS: "The destination folder already exists and isn't empty. Choose another folder.",
  GIT_MISSING: "git isn't installed or isn't on the PATH. Install git (https://git-scm.com) and restart Writer.",
  BAD_REPO: "That isn't a repository address. Use owner/name or a URL such as https://github.com/owner/name.",
};

/** A failure with a code and git's (or libgit2's) own words: the guidance for the code, or the words. */
export function gitFailure(code: GitErrorCode, detail: string): GitFailure {
  if (code === "GIT" || code === "NOT_FAST_FORWARD") return new GitFailure(code, `git failed: ${reason(detail)}`, detail);
  return new GitFailure(code, GUIDANCE[code], detail);
}

/**
 * The line of git's output that says why: a remote's refusal ("! [remote rejected] main -> main (why)")
 * or what it printed ("remote: …"), rather than the summary git ends with ("failed to push some refs").
 */
function reason(detail: string): string {
  const lines = detail.split("\n").map((l) => l.trim()).filter(Boolean);
  const rejected = lines.find((l) => /\[remote rejected\]/.test(l));
  const why = rejected && /\((.+)\)\s*$/.exec(rejected)?.[1];
  if (why && !/^pre-receive hook declined$/.test(why)) return why;
  const remote = lines.find((l) => /^remote: \S/.test(l) && !/^remote: (error: )?$/.test(l));
  if (remote) return remote.replace(/^remote: (error: )?/, "");
  return lines.findLast((l) => !/failed to push some refs/.test(l)) ?? lines.at(-1) ?? detail;
}

const OWNER_REPO = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/;
const URL_SCHEMES = /^(https?|ssh|git|file):\/\//;
const SCP_LIKE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/;

/**
 * The clone URL for what the author typed: "owner/name" means GitHub over https; URLs and
 * git@host:path pass through. Anything else, including a leading "-" that git would read
 * as an option, is BAD_REPO.
 */
export function cloneUrl(repo: string): string {
  const r = repo.trim();
  const m = OWNER_REPO.exec(r);
  if (m) return `https://github.com/${m[1]}/${m[2]!.replace(/\.git$/, "")}.git`;
  if ((URL_SCHEMES.test(r) || SCP_LIKE.test(r)) && !/\s/.test(r)) return r;
  throw new GitFailure("BAD_REPO", GUIDANCE.BAD_REPO);
}

/** The folder name a clone of `url` gets: its last path segment without ".git". */
export function repoName(url: string): string {
  const name = url.replace(/[/\\]+$/, "").replace(/\.git$/, "").split(/[/:\\]/).pop() ?? "";
  return name && name !== ".." && name !== "." ? name : "novel";
}

/** Writer's GitHub token for one host's https remotes (e.g. "https://github.com"), for one command. */
export interface GitAuth {
  origin: string;
  token: string;
}

/** The credentials for a remote URL, if Writer has any for it. */
export type GitAuthSource = (url: string) => Promise<GitAuth | undefined>;

/** How far a clone has got, as git reports it. */
export interface CloneProgress {
  stage: string;
  /** Percent through the stage. */
  progress: number;
  processed: number;
  total: number;
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

/** A path as `git status --porcelain` gives it: its index (x) and work tree (y) letters; `from` for a rename. */
export interface StatusEntry {
  path: string;
  x: string;
  y: string;
  from?: string;
}

/** A change as `--raw -M` gives it, with the blobs before and after (all zeros where there's none). */
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

/** How one path ends up in a tree built from another (repository paths). */
export type TreeEdit = { path: string; remove: true } | { path: string; content: Uint8Array | string; mode?: string } | { path: string; oid: string; mode: string };

/** Which files an operation covers: `paths` in the folder (all of it by default), less those matching `exclude` (pathspec globs). */
export interface Scope {
  paths?: string[];
  exclude?: string[];
}

export const NO_OBJECT = "0000000000000000000000000000000000000000";

export interface GitPort {
  /** Which git this is: "git 2.56.0", "libgit2 1.9.7". */
  version(): Promise<string>;

  // The repository.
  init(dir: string, branch: string): Promise<void>;
  isRepo(dir: string): Promise<boolean>;
  clone(url: string, dest: string, options?: { auth?: GitAuth; onProgress?: (p: CloneProgress) => void; signal?: AbortSignal }): Promise<void>;
  /** The repository's git folder, absolute. */
  gitDir(dir: string): Promise<string>;
  /** Where the folder is in the repository: "" at its top, else its path with a trailing "/". */
  prefix(dir: string): Promise<string>;
  /** Whether a merge, rebase, cherry-pick or revert is under way, or files are left unmerged. */
  inProgress(dir: string): Promise<boolean>;

  // Refs: commits, branches, tags.
  /** A revision's commit, or null. */
  resolve(dir: string, rev: string): Promise<string | null>;
  /** The branch HEAD names, born or not; null when detached. */
  currentBranch(dir: string): Promise<string | null>;
  /** Refs whose names start with one of `prefixes`, by name. */
  refs(dir: string, prefixes: string[]): Promise<Ref[]>;
  /** Tags whose names start with `prefix`, by name. */
  tags(dir: string, prefix?: string): Promise<Tag[]>;
  /** An annotated tag at `rev` (HEAD), the message cleaned up as git tag -m does. */
  tag(dir: string, name: string, message: string, rev?: string): Promise<void>;
  /** A branch at `start`, switched to; with `track`, `start` is a remote branch ("origin/x") it tracks. */
  createBranch(dir: string, name: string, start: string, options?: { track?: boolean }): Promise<void>;
  /** Switch to a branch, keeping local changes it doesn't touch and refusing ones it would overwrite. */
  switchBranch(dir: string, name: string): Promise<void>;
  deleteBranch(dir: string, name: string): Promise<void>;
  /** Every commit `rev` is or descends from. */
  ancestors(dir: string, rev: string): Promise<string[]>;

  // Configuration and remotes. `dir` null: the global (user's) configuration.
  getConfig(dir: string | null, key: string): Promise<string | null>;
  setConfig(dir: string | null, key: string, value: string): Promise<void>;
  /** Every entry of the repository's configuration (all levels), as [key, value]. */
  listConfig(dir: string): Promise<[string, string][]>;
  remoteUrl(dir: string, name: string): Promise<string | null>;
  addRemote(dir: string, name: string, url: string): Promise<void>;

  // The work tree and index.
  status(dir: string, scope?: Scope): Promise<StatusEntry[]>;
  /** git add -A: new, changed and deleted files. */
  stage(dir: string, scope?: Scope): Promise<void>;
  /** git rm: from the index and the work tree. */
  remove(dir: string, paths: string[]): Promise<void>;
  /** The tracked files in `paths`. */
  listFiles(dir: string, paths: string[]): Promise<string[]>;
  stagedChanges(dir: string, scope?: Scope): Promise<Change[]>;
  /**
   * A commit of what's staged in the scope, on HEAD, the message cleaned up as git commit -m does, and
   * no hooks; null if nothing in it was staged.
   */
  commit(dir: string, message: string, scope?: Scope): Promise<string | null>;
  /** HEAD amended with what's staged: its message and author kept. */
  amend(dir: string): Promise<string>;
  commitInfo(dir: string, rev: string): Promise<CommitInfo>;
  /** git restore --source=<rev> --staged --worktree -- <paths>: what `rev` has comes back, what it hasn't goes. */
  restore(dir: string, rev: string, paths: string[]): Promise<void>;
  /** git merge --ff-only: NOT_FAST_FORWARD if it isn't one; a local change it would overwrite stops it. */
  fastForward(dir: string, rev: string): Promise<void>;

  // History.
  log(dir: string, options?: { rev?: string; path?: string; limit?: number }): Promise<LogEntry[]>;
  /** Each commit's changes in `path`, oldest first, merges left out, renames found. */
  history(dir: string, path?: string): Promise<{ oid: string; authored: string; files: Change[] }[]>;
  /** The newest `limit` commits that deleted files in `path`, newest first, with the files. */
  deletions(dir: string, path: string, limit: number): Promise<{ oid: string; committed: string; files: string[] }[]>;
  readFile(dir: string, rev: string, path: string): Promise<Uint8Array | null>;
  /** The files in the tree at `rev` (in `path`). */
  listTree(dir: string, rev: string, path?: string): Promise<TreeEntry[]>;
  readBlobs(dir: string, oids: string[]): Promise<Map<string, Uint8Array>>;
  count(dir: string, rev: string): Promise<number>;
  aheadBehind(dir: string, a: string, b: string): Promise<{ ahead: number; behind: number }>;
  mergeBase(dir: string, a: string, b: string): Promise<string | null>;
  isAncestor(dir: string, a: string, b: string): Promise<boolean>;

  // Merging, in memory: paths are the repository's.
  /** The merge of two commits: a tree, and the paths that didn't merge (what the tree holds for those is the adapter's). */
  mergeTrees(dir: string, ours: string, theirs: string): Promise<{ tree: string; conflicts: string[] }>;
  buildTree(dir: string, base: string, edits: TreeEdit[]): Promise<string>;
  /** A commit object, the message as given. */
  commitTree(dir: string, tree: string, parents: string[], message: string): Promise<string>;
  /** Our commits replayed on `onto`; on a conflict, nothing done and the repository's paths returned. */
  rebase(dir: string, onto: string): Promise<{ conflicts: string[] }>;

  // Remotes.
  /** `signal` cuts the transfer short (a book closed mid-sync). */
  fetch(dir: string, remote: string, refspecs: string[], options?: { prune?: boolean; auth?: GitAuth; signal?: AbortSignal }): Promise<void>;
  push(dir: string, remote: string, refspecs: string[], options?: { setUpstream?: boolean; auth?: GitAuth; signal?: AbortSignal }): Promise<void>;
}

const decoder = new TextDecoder();
/** Bytes git gave as text. */
export const text = (bytes: Uint8Array): string => decoder.decode(bytes);
