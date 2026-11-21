import type { EntryPresence } from "./entry-presence.ts";
import type { BookKind } from "./kinds.ts";
import type { Book, Entity, Piece } from "./model.ts";
import { proseText } from "./words.ts";

/*
 * Finding entries in the index (#134): by anything an entry says, saying where each matched, and
 * narrowing them by filters the workspace keeps in its address. Pure functions of the loaded book,
 * so the app finds the same on every platform.
 */

/** The part of an entry a search matched, best first: its name before its notes. */
export type EntryMatchWhere = "name" | "alias" | "summary" | "field" | "tag" | "notes";

const RANK: Record<EntryMatchWhere, number> = { name: 0, alias: 1, summary: 2, field: 3, tag: 4, notes: 5 };

export interface EntryMatch {
  entity: Entity;
  /** The best part of it the search matched. */
  where: EntryMatchWhere;
  /** What matched there: the other name, the tag, the field as "key: value", or a few words around it in the summary or the notes. */
  text?: string;
  /** Where the match is in `text`, for marking it: [start, end). */
  at?: [number, number];
  /** Lower is better: by `where`. */
  rank: number;
}

const folds = new Map<string, string>();

/**
 * A character as a search compares it: through its capital to its small letter (so "ß" and "ss" are
 * the same, and "ᾀ" and its capital "ἈΙ"), without accents, a final "ς" as "σ".
 */
function fold(ch: string): string {
  let f = folds.get(ch);
  if (f === undefined) folds.set(ch, (f = ch.toUpperCase().toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "").replace(/ς/g, "σ")));
  return f;
}

/**
 * Text as a search compares it: without accents and case. "Miréla" and "mirela" are the same.
 * Character by character, so a piece of text folds as it does within the whole (where a match is
 * mapped back to what it matched); plain ASCII, most of a book, just in lower case.
 */
export function searchable(text: string): string {
  return text.replace(/[^\x00-\x7f]/gu, fold).toLowerCase();
}

/** A search's terms: its words, each to be found somewhere in an entry. None for an empty search. */
export function searchTerms(query: string): string[] {
  return searchable(query).split(/\s+/).filter(Boolean);
}

/** An entry's notes as words a reader sees: links' targets and Markdown's markers left out. */
function notesText(markdown: string): string {
  return proseText(markdown)
    .replace(/^[ \t]*(?:#{1,6}|>|[-*+])[ \t]+/gm, "")
    .replace(/(\*\*|__|[*_~`])/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface Part {
  where: EntryMatchWhere;
  text: string;
  /** Long text, shown as a few words around the match. */
  long?: boolean;
}

function parts(entity: Entity): Part[] {
  return [
    { where: "name", text: entity.name },
    ...entity.aliases.map((a): Part => ({ where: "alias", text: a })),
    ...(entity.summary ? [{ where: "summary", text: entity.summary, long: true } as Part] : []),
    ...Object.entries(entity.fields).map(([k, v]): Part => ({ where: "field", text: `${k.replace(/_/g, " ")}: ${String(v)}` })),
    ...entity.tags.map((t): Part => ({ where: "tag", text: t })),
    ...(entity.body.trim() ? [{ where: "notes", text: notesText(entity.body), long: true } as Part] : []),
  ];
}

/**
 * Where `text` has `term`, as offsets into `text` itself. Folding accents can change a string's
 * length, so the folded text is mapped back character by character.
 */
function find(text: string, term: string): [number, number] | undefined {
  // For each UTF-16 unit of the folded text, the original character it came from: [start, end).
  let folded = "";
  const from: number[] = [];
  const to: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = searchable(ch);
    for (let k = 0; k < f.length; k++) {
      from.push(i);
      to.push(i + ch.length);
    }
    folded += f;
    i += ch.length;
  }
  const at = folded.indexOf(term);
  if (at < 0) return undefined;
  return [from[at]!, to[at + term.length - 1]!];
}

/** About `words` words each side of a match in long text, with … where it was cut. */
function excerpt(text: string, [start, end]: [number, number], words = 8): { text: string; at: [number, number] } {
  const before = text.slice(0, start).split(/(?<=\s)/);
  const after = text.slice(end).split(/(?=\s)/);
  const head = before.slice(-words - 1).join("");
  const tail = after.slice(0, words + 1).join("");
  const cutHead = head.length < start;
  const cutTail = tail.length < text.length - end;
  const lead = (cutHead ? "…" : "") + head.trimStart();
  return { text: `${lead}${text.slice(start, end)}${tail.trimEnd()}${cutTail ? "…" : ""}`, at: [lead.length, lead.length + (end - start)] };
}

/**
 * Whether an entry matches a search, and where: every term must be somewhere in it (its name, other
 * names, summary, fields, tags or notes). The part said is the best one holding the first term, long
 * text as `around` words each side of the match. Undefined when it doesn't match; for an empty
 * search, a match on its name.
 */
/** Each entry's parts and their folded text, worked out once per entry as loaded: a search runs on every keystroke. */
const partsCache = new WeakMap<Entity, { all: Part[]; folded: string[] }>();

export function matchEntry(entity: Entity, query: string, { around = 8 }: { around?: number } = {}): EntryMatch | undefined {
  const terms = searchTerms(query);
  if (!terms.length) return { entity, where: "name", rank: 0 };
  let cached = partsCache.get(entity);
  if (!cached) {
    const all = parts(entity);
    partsCache.set(entity, (cached = { all, folded: all.map((p) => searchable(p.text)) }));
  }
  const { all, folded } = cached;
  if (!terms.every((t) => folded.some((f) => f.includes(t)))) return undefined;
  const best = all.findIndex((_, i) => folded[i]!.includes(terms[0]!));
  const part = all[best]!;
  const at = find(part.text, terms[0]!)!;
  const shown = part.long ? excerpt(part.text, at, around) : { text: part.text, at };
  return { entity, where: part.where, ...(part.where === "name" ? {} : shown), rank: RANK[part.where] };
}

/** The book's entries matching a search, in the book's order, each saying where it matched. */
export function searchEntries(book: Book, query: string): EntryMatch[] {
  return book.entities.flatMap((e) => matchEntry(e, query) ?? []);
}

/** What the index's list is narrowed to: each filter given must hold. */
export interface EntryFilters {
  /** Of one of these types (keys). */
  types?: readonly string[];
  /** With every one of these tags. */
  tags?: readonly string[];
  /** With this field, holding this value (compared as a search compares). */
  field?: { key: string; value: string };
  /** In a piece of this section (any level: a part holds its chapters' pieces). */
  in?: string;
  /** Named by this field of a piece (a kind's field key: a novel's point of view, `pov`), in `in` if that's given too. */
  role?: string;
  /** Not in any piece yet. */
  absent?: boolean;
}

/** Whether a piece's field value names an entry: an ID, a list of IDs, or a list of `{ id, … }`. */
export function fieldNames(value: unknown, id: string): boolean {
  if (value === id) return true;
  return Array.isArray(value) && value.some((v) => v === id || (typeof v === "object" && v !== null && (v as { id?: unknown }).id === id));
}

/** The pieces in reading order that are in a section, at any depth. */
export function piecesInSection(book: Book, sectionId: string): Piece[] {
  const parent = new Map(book.allSections.map((s) => [s.id, s.parentId]));
  const within = (id: string | undefined): boolean => {
    for (let at = id, seen = 0; at !== undefined && seen < 64; at = parent.get(at), seen++) if (at === sectionId) return true;
    return false;
  };
  return book.pieces.filter((p) => within(p.sectionId));
}

/**
 * The entries that pass the filters, in the order given. `presences` (entryPresences) says where
 * each is, for `in` and `absent`.
 */
export function filterEntries(book: Book, entities: readonly Entity[], filters: EntryFilters, presences: ReadonlyMap<string, EntryPresence>): Entity[] {
  const pieces = filters.in !== undefined ? piecesInSection(book, filters.in) : undefined;
  const inSection = pieces && new Set(pieces.map((p) => p.id));
  const tags = filters.tags?.map(searchable);
  return entities.filter((e) => {
    if (filters.types?.length && !filters.types.includes(e.type)) return false;
    if (tags?.length) {
      const has = new Set(e.tags.map(searchable));
      if (!tags.every((t) => has.has(t))) return false;
    }
    if (filters.field) {
      const v = e.fields[filters.field.key];
      if (v === undefined || searchable(String(v)) !== searchable(filters.field.value.trim())) return false;
    }
    const p = presences.get(e.id);
    if (filters.absent && (p?.count ?? 0) > 0) return false;
    if (filters.role !== undefined) {
      const key = filters.role;
      if (!(pieces ?? book.pieces).some((piece) => fieldNames(piece.fields[key], e.id))) return false;
    } else if (inSection && !p?.scenes.some((s) => s.mark !== "absent" && inSection.has(s.scene.id))) return false;
    return true;
  });
}

/** How the index's list is sorted: by where entries first or last appear, by name, or by how many pieces they're in. */
export type EntrySort = "first" | "last" | "name" | "most";

/** A kind's list's sort until the writer picks one: a journal's people last written about first. */
export const defaultEntrySort = (kind: BookKind): EntrySort => (kind.newestFirst ? "last" : "first");

/** Entries sorted, ties by name. Entries not in the book yet come after those that are, by first or last appearance. */
export function sortEntries(book: Book, entities: readonly Entity[], sort: EntrySort, presences: ReadonlyMap<string, EntryPresence>): Entity[] {
  const position = new Map(book.pieces.map((p, i) => [p.id, i]));
  const at = (e: Entity, end: "first" | "last") => {
    const piece = presences.get(e.id)?.[end];
    return piece ? (position.get(piece.id) ?? Infinity) : Infinity;
  };
  const byName = (a: Entity, b: Entity) => a.name.localeCompare(b.name);
  const order: Record<EntrySort, (a: Entity, b: Entity) => number> = {
    first: (a, b) => at(a, "first") - at(b, "first") || byName(a, b),
    // Last written about first; never written about at the end.
    last: (a, b) => {
      const x = at(a, "last");
      const y = at(b, "last");
      return x === y ? byName(a, b) : x === Infinity ? 1 : y === Infinity ? -1 : y - x;
    },
    name: byName,
    most: (a, b) => (presences.get(b.id)?.count ?? 0) - (presences.get(a.id)?.count ?? 0) || byName(a, b),
  };
  return [...entities].sort(order[sort]);
}

/** Each piece body's words as a search compares them, by its text: worked out once while it's unchanged. */
const foldedCache = new Map<string, string>();

/** The pieces, in reading order, whose words have every word of a search: a way on into the book's own find. */
export function piecesMatching(book: Book, query: string): Piece[] {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  return book.pieces.filter((p) => {
    let folded = foldedCache.get(p.body);
    if (folded === undefined) {
      if (foldedCache.size >= 4000) foldedCache.delete(foldedCache.keys().next().value!);
      foldedCache.set(p.body, (folded = searchable(proseText(p.body))));
    }
    return terms.every((t) => folded.includes(t));
  });
}
