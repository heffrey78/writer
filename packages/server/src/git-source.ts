import { memorySource, type FileSource } from "@writer/core";
import { text } from "./git-port/port.ts";
import { gitPort } from "./ports.ts";

/*
 * A novel as it was at a commit, for reading without touching the work tree: a version's last
 * commit, a checkpoint, or the latest one. One listing of its tree and one read of its blobs bring in
 * the story's files; anything else (images, fonts) is read when asked for.
 */

/** What the loader reads; everything else waits until it's asked for. */
const STORY_FILE = /\.(md|ya?ml|txt|json)$/;

export interface CommitSource extends FileSource {
  /** The commit, in full. */
  commit: string;
}

const cache = new Map<string, CommitSource>();
const CACHE_SIZE = 8;

/** The novel in `root` as it was at `rev` (a commit, branch or tag). Commits don't change, so a few are kept. */
export async function commitSource(root: string, rev: string): Promise<CommitSource> {
  const commit = await gitPort().resolve(root, rev);
  if (!commit) throw new Error(`No commit ${rev}.`);
  const key = `${root}\0${commit}`;
  const cached = cache.get(key);
  if (cached) return cached;

  // The novel's folder of the commit, with paths relative to it; files only (not a submodule's commit).
  const blobs = new Map<string, string>();
  for (const e of await gitPort().listTree(root, commit)) if (e.mode !== "160000") blobs.set(e.path, e.oid);
  const story = [...blobs].filter(([path]) => STORY_FILE.test(path) && !path.startsWith(".github/"));
  const read = new Set(story.map(([path]) => path));
  const texts = await readBlobs(root, story.map(([, oid]) => oid));
  const files: Record<string, string> = {};
  story.forEach(([path], i) => (files[path] = texts[i]!));
  for (const path of blobs.keys()) files[path] ??= "";

  const listed = memorySource(files);
  const source: CommitSource = {
    commit,
    list: (dir) => listed.list(dir),
    async read(path) {
      const oid = blobs.get(path);
      if (oid === undefined) return undefined;
      return read.has(path) ? files[path] : (await readBlobs(root, [oid]))[0];
    },
  };
  cache.set(key, source);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return source;
}

/** The blobs' contents as text, in order. */
async function readBlobs(root: string, oids: string[]): Promise<string[]> {
  if (!oids.length) return [];
  const blobs = await gitPort().readBlobs(root, oids);
  return oids.map((oid) => text(blobs.get(oid) ?? new Uint8Array()));
}
