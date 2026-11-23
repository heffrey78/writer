import { parse } from "yaml";
import type { Book, NotName } from "./model.ts";
import type { Diagnostic } from "./types.ts";

/*
 * The index's judgements (D19, #171): "Not a name here", a word in a piece that looks like an entry's
 * name but isn't it there, and "They're different", two entries that look alike but aren't the same.
 * Each is kept in a file of the index's own, in the kind's codex folder, one judgement per line, so
 * git's union driver merges two devices' additions without a conflict. They're read leniently: a line
 * that isn't one is skipped (and reported as a warning), never a reason not to load the book.
 */

export const NOT_NAMES_FILE = "not-names.yaml";
export const DIFFERENT_FILE = "different.yaml";

/** Where a book of `kind` keeps its judgements: in its codex folder (bible/ in a novel, index/ in a journal). */
export function judgementFiles(kind: Pick<Book["kind"], "folders">): { notNames: string; different: string } {
  return { notNames: `${kind.folders.codex}/${NOT_NAMES_FILE}`, different: `${kind.folders.codex}/${DIFFERENT_FILE}` };
}

/** What each file says about itself on its first line, for whoever reads it without the app. */
export const NOT_NAMES_HEADER = "# Words that look like an entry's name but aren't it here (Not a name here). One per line; kept by Writer.\n";
export const DIFFERENT_HEADER = "# Entries that look alike but aren't the same (They're different). One pair per line; kept by Writer.\n";

/** The lines a book's .gitattributes needs so two devices' judgements merge line by line. */
export function unionLines(kind: Pick<Book["kind"], "folders">): string[] {
  const files = judgementFiles(kind);
  return [`${files.notNames} merge=union`, `${files.different} merge=union`];
}

const ID = /^[a-z]{2,8}_[0-9a-hjkmnp-tv-z]{6}$/;

/** Each line of a judgements file that holds one, parsed; a line that doesn't is reported as a warning and skipped. */
function lines<T>(text: string, file: string, read: (item: unknown) => T | undefined, what: string): { items: T[]; diagnostics: Diagnostic[] } {
  const items: T[] = [];
  const diagnostics: Diagnostic[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    let item: T | undefined;
    if (line.startsWith("- ")) {
      try {
        item = read(parse(line.slice(2)));
      } catch {
        item = undefined;
      }
    }
    if (item === undefined) diagnostics.push({ severity: "warning", code: "W_JUDGEMENT", file, line: i + 1, message: `Line ${i + 1} isn't ${what}: it's left out` });
    else items.push(item);
  });
  return { items, diagnostics };
}

/** not-names.yaml: one `{ entry, piece, sentence, nth }` per line. */
export function readNotNames(text: string, file: string): { items: NotName[]; diagnostics: Diagnostic[] } {
  return lines(
    text,
    file,
    (v) => {
      if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
      const { entry, piece, sentence, nth } = v as Record<string, unknown>;
      if (typeof entry !== "string" || !ID.test(entry) || typeof piece !== "string" || !ID.test(piece) || typeof sentence !== "string" || !sentence.trim()) return undefined;
      if (typeof nth !== "number" || !Number.isInteger(nth) || nth < 0) return undefined;
      return { entry, piece, sentence, nth };
    },
    "a word that isn't a name ({ entry, piece, sentence, nth })",
  );
}

/** different.yaml: one pair of entry IDs per line, kept in order. */
export function readDifferent(text: string, file: string): { items: [string, string][]; diagnostics: Diagnostic[] } {
  return lines(
    text,
    file,
    (v) => (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "string" && ID.test(x)) && v[0] !== v[1] ? pair(v[0] as string, v[1] as string) : undefined),
    "a pair of entries ([one, other])",
  );
}

/** A pair of entries the same whichever way round it's given. */
export function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** A judgement as its line in not-names.yaml: the sentence quoted as JSON is, which YAML reads the same. */
export function notNameLine(n: NotName): string {
  return `- { entry: ${n.entry}, piece: ${n.piece}, sentence: ${JSON.stringify(n.sentence)}, nth: ${n.nth} }\n`;
}

export function differentLine([a, b]: [string, string]): string {
  const [x, y] = pair(a, b);
  return `- [${x}, ${y}]\n`;
}

/** Whether two entries were judged different. */
export function judgedDifferent(book: Pick<Book, "different">, a: string, b: string): boolean {
  const [x, y] = pair(a, b);
  return book.different.some(([p, q]) => p === x && q === y);
}

const byPieceCache = new WeakMap<readonly NotName[], Map<string, NotName[]>>();

/** The "Not a name here" judgements about one piece. */
export function notNamesIn(book: Pick<Book, "notNames">, piece: string): NotName[] {
  let byPiece = byPieceCache.get(book.notNames);
  if (!byPiece) {
    byPiece = new Map();
    for (const n of book.notNames) byPiece.set(n.piece, [...(byPiece.get(n.piece) ?? []), n]);
    byPieceCache.set(book.notNames, byPiece);
  }
  return byPiece.get(piece) ?? [];
}
