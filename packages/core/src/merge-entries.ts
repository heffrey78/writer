import type { YamlEdit, YamlPath } from "./edit.ts";
import type { Book, Entity } from "./model.ts";
import { backlinks, mentionsOf } from "./queries.ts";

/*
 * Merging two entries of a type (#137, #173): every reference to the one going made a reference to
 * the one kept. What it reaches is told first (mergeReach); the server rewrites the files (swapEdits,
 * swapMentions) in one commit.
 */

/** What merging `other` into `keep` changes: pieces naming it, entries and records whose fields do, relationships, notes. */
export interface MergeReach {
  pieces: number;
  entries: number;
  records: number;
  relationships: number;
  notes: number;
}

export function mergeReach(book: Book, keep: Entity, other: Entity): MergeReach {
  const links = backlinks(book, other.id);
  return {
    pieces: links.scenes.length,
    entries: new Set(links.entries.filter(({ entry }) => entry.id !== keep.id).map(({ entry }) => entry.id)).size,
    records: links.records.length,
    relationships: links.relationships.length,
    notes: mentionsOf(book, other.id).filter((r) => r.kind === "note").length,
  };
}

/** What a list item is, to tell two the same after the swap: an ID, or the ID of a `{ id, … }`. */
const identity = (v: unknown): unknown => (typeof v === "object" && v !== null && !Array.isArray(v) && "id" in v ? (v as { id: unknown }).id : typeof v === "object" ? JSON.stringify(v) : v);

/** `value` with every `other` made `keep`, and a list left with one of each once it names `keep` twice. */
export function swapped(value: unknown, other: string, keep: string): unknown {
  if (value === other) return keep;
  if (Array.isArray(value)) {
    const seen = new Set<unknown>();
    return value.map((v) => swapped(v, other, keep)).filter((v) => {
      const id = identity(v);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, swapped(v, other, keep)]));
  return value;
}

/**
 * The edits that make `data` (a file's YAML, or a piece's front matter) name `keep` where it named
 * `other`: at the deepest place each change is, so the rest of the file keeps its layout and comments.
 * A list that changes is written whole, one of each.
 */
export function swapEdits(data: unknown, other: string, keep: string, path: YamlPath = []): YamlEdit[] {
  if (data === other) return [{ path, value: keep }];
  if (Array.isArray(data)) {
    const after = swapped(data, other, keep);
    return JSON.stringify(after) === JSON.stringify(data) ? [] : [{ path, value: after }];
  }
  if (typeof data === "object" && data !== null) return Object.entries(data).flatMap(([k, v]) => swapEdits(v, other, keep, [...path, k]));
  return [];
}

/** Prose with every mention of `other` made a mention of `keep`, the words shown left as written. */
export function swapMentions(body: string, other: string, keep: string): string {
  return body.split(`](#${other})`).join(`](#${keep})`);
}
