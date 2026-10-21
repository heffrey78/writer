import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { countWords, parseMarkdown, wordChange, writingDays, type CommitWords } from "@writer/core";
import type { Hono } from "hono";
import { body, operation, type Env } from "./bible-routes.ts";
import { NO_OBJECT, text, type Change as GitChange } from "./git-port/port.ts";
import { gitPort } from "./ports.ts";

/*
 * The novel's writing history (heffrey78/gh-writer#20, D8): for every commit reachable from HEAD that changed scenes,
 * the words it added and removed, word-diffed against its parent. Merges are skipped: the commits
 * they join are counted themselves. Results are kept per commit in the clone's .git, so only new
 * commits are diffed; a fresh clone works them all out again, the same.
 */

/** Bumped when the counting changes, so cached results from an older method are worked out again. */
const METHOD = 1;
const CACHE = "gh-writer/stats.json";

interface Cache {
  method: number;
  commits: Record<string, { date: string; added: number; removed: number }>;
}

/** One scene file a commit changed: its blob before and after (undefined: not there). */
interface Change {
  before?: string;
  after?: string;
  path: string;
}

/** Whether a path is a piece: Markdown in the kind's content folder. */
const isPiece = (content: string, path: string) => path.startsWith(`${content}/`) && path.endsWith(".md");

/** What each commit since the start did to the pieces in the `content` folder (the kind's), oldest first. */
export async function writingHistory(root: string, content: string): Promise<CommitWords[]> {
  const git = gitPort();
  // No commits yet: no history.
  const log = await git.history(root, content).catch(() => []);
  const commits = log.map((c) => ({ commit: c.oid, date: c.authored, changes: pieceChanges(c.files, content) }));
  const cacheFile = join(await git.gitDir(root), CACHE);
  const cache = await readCache(cacheFile);

  const todo = commits.filter((c) => !cache.commits[c.commit]);
  if (todo.length) {
    const blobs = [...new Set(todo.flatMap((c) => c.changes.flatMap((ch) => [ch.before, ch.after]).filter((b): b is string => b !== undefined)))];
    const texts = await readBlobs(root, blobs);
    const body = (oid: string | undefined, path: string) => {
      if (oid === undefined) return undefined;
      const text = texts.get(oid) ?? "";
      return /^---\r?\n/.test(text) ? parseMarkdown(text, path).body : text;
    };
    for (const c of todo) {
      let added = 0;
      let removed = 0;
      for (const ch of c.changes) {
        const change = wordChange(body(ch.before, ch.path), body(ch.after, ch.path));
        added += change.added;
        removed += change.removed;
      }
      cache.commits[c.commit] = { date: c.date, added, removed };
    }
    await writeCache(cacheFile, cache);
  }
  return commits.map((c) => ({ commit: c.commit, ...cache.commits[c.commit]! }));
}

/**
 * Words added and removed by saved work not committed yet: each scene file that differs from the
 * last commit (or is new), word-diffed against it. What the history will say once it's committed.
 */
export async function uncommittedChange(root: string, content: string): Promise<{ added: number; removed: number }> {
  const git = gitPort();
  // Changed since HEAD, staged or not, and new: as git status sees the content folder.
  const changed = await git.status(root, { paths: [content] }).catch(() => []);
  const paths = [...new Set(changed.map((e) => e.path))].filter((p) => isPiece(content, p));
  if (!paths.length) return { added: 0, removed: 0 };
  const at = new Map<string, string>();
  for (const path of paths) {
    const bytes = await git.readFile(root, "HEAD", path).catch(() => null);
    if (bytes) at.set(`HEAD:./${path}`, text(bytes));
  }
  const before = at;
  const body = (text: string | undefined, path: string) => (text === undefined ? undefined : /^---\r?\n/.test(text) ? parseMarkdown(text, path).body : text);
  let added = 0;
  let removed = 0;
  for (const path of paths) {
    const now = await readFile(join(root, path), "utf8").catch(() => undefined);
    const change = wordChange(body(before.get(`HEAD:./${path}`), path), body(now, path));
    added += change.added;
    removed += change.removed;
  }
  return { added, removed };
}

/** git log's records: each commit's hash, author date and the scene files it changed. */
/**
 * A commit's changes to pieces, with their blobs before and after. A piece moved in or out of the
 * content folder counts as added or removed; within it, as itself. A copy leaves its source where it
 * was: only the new file is new.
 */
function pieceChanges(files: GitChange[], content: string): Change[] {
  const changes: Change[] = [];
  for (const f of files) {
    const [from, to] = [f.from ?? f.path, f.path];
    const [was, now] = [isPiece(content, from), isPiece(content, to)];
    if (!was && !now) continue;
    changes.push({
      path: now ? to : from,
      ...(was && f.old !== NO_OBJECT && f.status !== "C" ? { before: f.old } : {}),
      ...(now && f.new !== NO_OBJECT ? { after: f.new } : {}),
    });
  }
  return changes;
}

/** Blobs' texts by object ID, from git's objects; a missing one is left out. */
async function readBlobs(root: string, oids: string[]): Promise<Map<string, string>> {
  const blobs = await gitPort().readBlobs(root, oids);
  return new Map([...blobs].map(([oid, bytes]) => [oid, text(bytes)]));
}

async function readCache(file: string): Promise<Cache> {
  try {
    const cache = JSON.parse(await readFile(file, "utf8")) as Cache;
    if (cache.method === METHOD && cache.commits && typeof cache.commits === "object") return cache;
  } catch {
    // None yet, or unreadable: worked out again.
  }
  return { method: METHOD, commits: {} };
}

async function writeCache(file: string, cache: Cache): Promise<void> {
  await mkdir(join(file, ".."), { recursive: true });
  // Another request may be writing it too: each writes a whole file of its own, then renames.
  const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}`;
  await writeFile(temp, JSON.stringify(cache));
  await rename(temp, file);
}

/**
 * GET /:id/stats  { days, words, target, pending }: the open version's writing days (words added,
 * removed, net, and the book's length at each day's end), the manuscript's words now (as saved),
 * novel.yaml's target, and the words added and removed by saved work not yet committed.
 */
export function statsRoutes(routes: Hono<Env>): void {
  /** PUT /:id/target  { words?, date?, daily? } (null removes one) → { commit, files }: novel.yaml's targets, one commit. */
  routes.put("/:id/target", async (c) => {
    const raw = await body(c);
    const pick = (k: string) => (k in raw ? (raw[k] as never) : undefined);
    return operation(c, () => c.var.ws.bible.updateTarget({ words: pick("words"), date: pick("date"), daily: pick("daily") }));
  });

  routes.get("/:id/stats", async (c) => {
    const { novel } = await c.var.ws.loadModel();
    const words = novel.allPieces.reduce((n, s) => n + countWords(s.body), 0);
    const { content } = novel.kind.folders;
    const days = writingDays(await writingHistory(c.var.ws.root, content), words);
    return c.json({ days, words, target: novel.config?.target ?? null, pending: await uncommittedChange(c.var.ws.root, content) });
  });
}
