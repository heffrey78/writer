import { stringify } from "yaml";
import { defineModule, editYaml, type Book, type BookModule, type FileTypeDef, type Finding, type ModuleFile } from "@writer/core";
import boardSchema from "../../schemas/board.schema.json" with { type: "json" };

/*
 * Mood boards (D14, #195): pages where pictures, notes, a note's pictures and index entries are cards,
 * each placed and sized by hand, several to a book. Each board is a file of its own, boards/<slug>.yaml,
 * naming notes and entries by ID and pictures by path, so nothing is copied and a renamed note or entry
 * changes nothing in it. Its cards are listed in reading order, which is also front to back, one card a
 * line, so moving one changes one line.
 */

/** Where a card's top left corner is and how big it is, in the board's own units: the same on every screen. */
export type Pair = [number, number];

/** A card on a board, as the module reads it. */
export type BoardCard =
  /** A picture alone, in images/: no border and no note, its description kept on the board. */
  | { kind: "picture"; picture: string; description?: string; at: Pair; size: Pair }
  /** A note: its first picture and its words cut short, or its words only. */
  | { kind: "note"; note: string; wordsOnly: boolean; at: Pair; size: Pair }
  /** One of a note's pictures as a card of its own, tethered to its note: its description is the note's. */
  | { kind: "note-picture"; note: string; picture: string; at: Pair; size: Pair }
  /** An index entry: its picture and card fields. */
  | { kind: "entry"; entry: string; at: Pair; size: Pair };

export interface Board {
  id: string;
  title: string;
  cards: BoardCard[];
  file: string;
}

/** What a note's card says for `picture` to show its words only. */
export const WORDS_ONLY = "none";

const pair = (v: unknown): Pair | undefined =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n)) ? [v[0], v[1]] : undefined;
const text = (v: unknown) => (typeof v === "string" ? v : undefined);

/**
 * A card as the file has it, or why it isn't one: a picture alone, a note, a note's picture or an
 * entry, each with where it is and its size. The schema has checked each key's own value.
 */
export function readCard(raw: unknown): BoardCard | { malformed: string; schema?: true } {
  // What the schema says of a card (a mapping, with where it is and its size) it reports itself.
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { malformed: "isn't a card: a picture, a note, a note's picture or an entry", schema: true };
  const c = raw as Record<string, unknown>;
  const at = pair(c["at"]), size = pair(c["size"]);
  if (!at || !size || size[0] <= 0 || size[1] <= 0) return { malformed: "needs where it is (`at: [x, y]`) and its size (`size: [width, height]`)", schema: true };
  const note = text(c["note"]), entry = text(c["entry"]), picture = text(c["picture"]);
  if (note && entry) return { malformed: "names a note and an entry: a card is one or the other" };
  if (entry) {
    if (picture !== undefined || c["description"] !== undefined) return { malformed: "is an entry's, which shows the entry's own picture: it has no `picture` or `description`" };
    return { kind: "entry", entry, at, size };
  }
  if (note) {
    if (c["description"] !== undefined) return { malformed: "is a note's, whose pictures are described in the note: it has no `description`" };
    if (picture === undefined || picture === WORDS_ONLY) return { kind: "note", note, wordsOnly: picture === WORDS_ONLY, at, size };
    return { kind: "note-picture", note, picture, at, size };
  }
  if (picture === undefined || picture === WORDS_ONLY) return { malformed: "names nothing to show: a picture (`picture: images/…`), a note or an entry" };
  const description = text(c["description"]);
  return { kind: "picture", picture, ...(description !== undefined ? { description } : {}), at, size };
}

const cardsOf = (data: Record<string, unknown>): unknown[] => (Array.isArray(data["cards"]) ? data["cards"] : []);

/** A board as the module reads it: its cards in order, leaving out any that isn't one (the check reports it). */
export function readBoard(file: ModuleFile): Board {
  const cards = cardsOf(file.data).flatMap((raw) => {
    const card = readCard(raw);
    return "malformed" in card ? [] : [card];
  });
  return { id: file.id, title: file.title, cards, file: file.file };
}

/** The book's boards, in file-name order. */
export const boardsOf = (book: Book): Board[] => book.moduleFiles.filter((f) => f.type === BOARD.key).map(readBoard);

/** The pictures a card shows of its own, as repository paths: a picture alone's, a note's picture's. */
const cardPicture = (card: BoardCard) => (card.kind === "picture" || card.kind === "note-picture" ? [card.picture] : []);

export const BOARD: FileTypeDef = {
  key: "board",
  prefix: "board",
  folder: "boards",
  schema: boardSchema,
  // A picture on a board is kept while the board shows it, even once it leaves its note.
  pictures: (data) => [...new Set(cardsOf(data).flatMap((raw) => {
    const card = readCard(raw);
    return "malformed" in card ? [] : cardPicture(card);
  }))],
};

/** The first line of every board the app writes. */
const HEADER = "# A mood board. Kept by Writer.\n";

/** A card on one line of its board's file, as a flow mapping: `- { note: note_4k8h2c, at: [556, 36], size: [252, 300] }`. */
export function cardLine(card: BoardCard): string {
  const fields: Record<string, unknown> =
    card.kind === "picture" ? { picture: card.picture, ...(card.description !== undefined ? { description: card.description } : {}) }
    : card.kind === "note" ? { note: card.note, ...(card.wordsOnly ? { picture: WORDS_ONLY } : {}) }
    : card.kind === "note-picture" ? { note: card.note, picture: card.picture }
    : { entry: card.entry };
  const flow = stringify({ ...fields, at: card.at, size: card.size }, { collectionStyle: "flow", flowCollectionPadding: true, lineWidth: 0 }).trim();
  return `  - ${flow}\n`;
}

/** A new board's file: its ID, title and cards, each card on a line of its own. */
export function boardFile(board: Omit<Board, "file">): string {
  const head = stringify({ id: board.id, title: board.title }, { lineWidth: 0 });
  return HEADER + head + (board.cards.length ? `cards:\n${board.cards.map(cardLine).join("")}` : "cards: []\n");
}

/** A board's file with card `index` moved and sized: only that card's line changes, and comments stay. */
export function placeCard(fileText: string, index: number, { at, size }: { at?: Pair; size?: Pair }): string {
  return editYaml(fileText, [...(at ? [{ path: ["cards", index, "at"], value: at }] : []), ...(size ? [{ path: ["cards", index, "size"], value: size }] : [])]);
}

/** Cards that aren't one of the four kinds: the file breaks the format in a way its schema can't say. */
function malformedCards(book: Book): Finding[] {
  return book.moduleFiles.filter((f) => f.type === BOARD.key).flatMap((f) =>
    cardsOf(f.data).flatMap((raw, i): Finding[] => {
      const card = readCard(raw);
      return "malformed" in card && !card.schema ? [{ file: f.file, pointer: `/cards/${i}`, message: `Card ${i + 1} ${card.malformed}` }] : [];
    }),
  );
}

/** Cards naming a note or an entry the book doesn't have: shown as missing, until they're taken off. */
function unknownCards(book: Book): Finding[] {
  const notes = new Set(book.notes.map((n) => n.id));
  const entries = new Set(book.entities.map((e) => e.id));
  return boardsOf(book).flatMap((board) => {
    const out: Finding[] = [];
    cardsOf(book.moduleFiles.find((f) => f.file === board.file)!.data).forEach((raw, i) => {
      const card = readCard(raw);
      if ("malformed" in card) return;
      if (card.kind === "entry" && !entries.has(card.entry)) out.push({ file: board.file, pointer: `/cards/${i}/entry`, message: `The board “${board.title}” shows ${card.entry}, which isn't in the book` });
      if ((card.kind === "note" || card.kind === "note-picture") && !notes.has(card.note)) out.push({ file: board.file, pointer: `/cards/${i}/note`, message: `The board “${board.title}” shows the note ${card.note}, which isn't in the book` });
    });
    return out;
  });
}

export const moodBoard: BookModule = defineModule({
  id: "mood-board",
  label: "Mood boards",
  files: [BOARD],
  checks: [
    { code: "E_SCHEMA", severity: "error", find: malformedCards },
    { code: "W_BOARD_UNKNOWN", severity: "warning", find: unknownCards },
  ],
});
