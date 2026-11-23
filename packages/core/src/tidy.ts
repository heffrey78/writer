import type { EntryFieldDef } from "./ids.ts";
import { entryPresences, type EntryPresence } from "./entry-presence.ts";
import { fieldsAt, fieldsOfType } from "./entry-fields.ts";
import { judgedDifferent } from "./judgements.ts";
import type { Book, Entity, NotName } from "./model.ts";
import { namesNotLinkedIn, notNameHolds, type Passage } from "./passages.ts";

/*
 * Tidy up (#137, #172): what has drifted in a book's index, gathered in one place. Names written
 * without a link across the book, entries never in it, entries that might be the same one twice,
 * entries with no summary, declared fields left empty, and "Not a name here" judgements whose word
 * is gone. In core, so the CLI could report them too.
 */

/** Why two entries might be the same: the same name, one name the start of the other's, or spelled nearly alike. */
export type SameBecause = "same name" | "one begins the other" | "spelled alike";

export interface TidyReport {
  /** Each entry whose names are written as plain words somewhere, with every such passage, most first. */
  notLinked: { entry: Entity; passages: Passage[] }[];
  /** Entries no piece is about or names. */
  absent: Entity[];
  /** Pairs of entries of one type that might be the same, not judged different. */
  same: { a: Entity; b: Entity; because: SameBecause }[];
  noSummary: Entity[];
  /** Entries leaving fields their type declares empty, with the fields. */
  emptyFields: { entry: Entity; fields: EntryFieldDef[] }[];
  /** "Not a name here" judgements that no longer find their word. */
  dormant: NotName[];
}

export interface TidyCounts {
  notLinked: number;
  absent: number;
  same: number;
  noSummary: number;
  emptyFields: number;
}

/** The book's index, checked: every list Tidy up shows. */
export function tidyReport(book: Book, presences: ReadonlyMap<string, EntryPresence> = entryPresences(book)): TidyReport {
  const byId = new Map(book.entities.map((e) => [e.id, e]));
  const plain = new Map<string, Passage[]>();
  for (const piece of book.pieces) {
    for (const { id, passages } of namesNotLinkedIn(book, piece)) if (byId.has(id)) plain.set(id, [...(plain.get(id) ?? []), ...passages]);
  }
  return {
    notLinked: [...plain].map(([id, passages]) => ({ entry: byId.get(id)!, passages })).sort((x, y) => y.passages.length - x.passages.length || x.entry.name.localeCompare(y.entry.name)),
    absent: book.entities.filter((e) => !presences.get(e.id)?.count),
    same: mightBeTheSame(book),
    noSummary: book.entities.filter((e) => !e.summary?.trim()),
    emptyFields: book.entities.flatMap((e) => {
      const fields = fieldsAt(book, e).fields;
      const empty = fieldsOfType(book, e.type).filter((f) => fields[f.key] === undefined);
      return empty.length ? [{ entry: e, fields: empty }] : [];
    }),
    dormant: book.notNames.filter((n) => !notNameHolds(book, n)),
  };
}

/** What each of Tidy up's lists counts: every name not linked, and every field left empty. */
export function tidyCounts(r: TidyReport): TidyCounts {
  return {
    notLinked: r.notLinked.reduce((n, x) => n + x.passages.length, 0),
    absent: r.absent.length,
    same: r.same.length,
    noSummary: r.noSummary.length,
    emptyFields: r.emptyFields.reduce((n, x) => n + x.fields.length, 0),
  };
}

/** A name as it's compared: accents and case set aside, spacing collapsed. */
export function foldName(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** The fewest single-letter changes from one to the other, or more than `most` (counting stops there). */
function distance(a: string, b: string, most: number): number {
  if (Math.abs(a.length - b.length) > most) return most + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let least = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      least = Math.min(least, row[j]!);
    }
    if (least > most) return most + 1;
    prev = row;
  }
  return prev[b.length]!;
}

/** Why two names might be one entry's, if they might: equal, one a word the other begins with, or a letter or two apart. */
function alike(x: string, y: string): SameBecause | undefined {
  if (x === y) return "same name";
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  // "Ben" and "Benjamin": a name of one word that starts a word of the other.
  if (short.length >= 3 && !short.includes(" ") && long.split(" ").some((w) => w.length > short.length && w.startsWith(short))) return "one begins the other";
  const most = short.length >= 8 ? 2 : short.length >= 4 ? 1 : 0;
  if (most && distance(x, y, most) <= most) return "spelled alike";
  return undefined;
}

const RANK: Record<SameBecause, number> = { "same name": 0, "one begins the other": 1, "spelled alike": 2 };

/** Pairs of entries of one type whose names or other names are alike, not judged different; the likeliest first. */
export function mightBeTheSame(book: Book): { a: Entity; b: Entity; because: SameBecause }[] {
  const out: { a: Entity; b: Entity; because: SameBecause }[] = [];
  for (const type of book.entityTypes) {
    const entries = book.entities.filter((e) => e.type === type.key).map((e) => ({ e, names: [...new Set([e.name, ...e.aliases].map(foldName).filter((n) => n.length > 1))] }));
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [a, b] = [entries[i]!, entries[j]!];
        if (judgedDifferent(book, a.e.id, b.e.id)) continue;
        let because: SameBecause | undefined;
        for (const x of a.names) for (const y of b.names) {
          const why = alike(x, y);
          if (why && (!because || RANK[why] < RANK[because])) because = why;
        }
        if (because) out.push({ a: a.e, b: b.e, because });
      }
    }
  }
  return out.sort((x, y) => RANK[x.because] - RANK[y.because]);
}
