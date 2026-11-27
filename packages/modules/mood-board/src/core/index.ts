import { isSeq, parseDocument, stringify, type Node } from "yaml";
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

/**
 * A board file's cards where the file has them, by their place in its list: a card that isn't one is
 * undefined, so every edit names a card by where it is in the file.
 */
export function cardsInFile(data: Record<string, unknown>): (BoardCard | undefined)[] {
  return cardsOf(data).map((raw) => {
    const card = readCard(raw);
    return "malformed" in card ? undefined : card;
  });
}

/** A board file's text read as the app reads it: its title and its cards in place, or none if it doesn't parse. */
export function readBoardText(fileText: string): { title: string; cards: (BoardCard | undefined)[] } | undefined {
  const doc = parseDocument(fileText);
  if (doc.errors.length) return undefined;
  const data = doc.toJS() as unknown;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
  const d = data as Record<string, unknown>;
  return { title: typeof d["title"] === "string" ? d["title"] : "", cards: cardsInFile(d) };
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

/** Where card `index`'s lines are in a board's file, from the start of its first line to the end of its last; none in a flow list. */
function cardLines(fileText: string, index: number): [number, number] | undefined {
  const cards = parseDocument(fileText).get("cards", true);
  if (!isSeq(cards) || cards.flow) return undefined;
  const item = cards.items[index] as Node | undefined;
  if (!item?.range) return undefined;
  const start = fileText.lastIndexOf("\n", item.range[0] - 1) + 1;
  const newline = fileText.indexOf("\n", Math.max(item.range[1] - 1, item.range[0]));
  return [start, newline < 0 ? fileText.length : newline + 1];
}

/** The cards as the file lists them, whatever they hold: for rewriting a list written as flow, which is rare. */
const rawCards = (fileText: string): unknown[] => {
  const data = parseDocument(fileText).toJS() as Record<string, unknown> | null;
  return data && Array.isArray(data["cards"]) ? data["cards"] : [];
};

/** A board's file with card `index` taken off: its lines go, and everything else stays. */
export function takeOffCard(fileText: string, index: number): string {
  const lines = cardLines(fileText, index);
  if (lines) {
    const out = fileText.slice(0, lines[0]) + fileText.slice(lines[1]);
    // The last card gone: an empty list, still a list.
    return rawCards(fileText).length === 1 ? editYaml(out, [{ path: ["cards"], value: [] }]) : out;
  }
  return editYaml(fileText, [{ path: ["cards"], value: rawCards(fileText).filter((_, i) => i !== index) }]);
}

/**
 * A board's file with card `index` brought to the front (drawn over the others, and read last) or sent
 * to the back (drawn under them, read first): its lines move, unchanged.
 */
export function reorderCard(fileText: string, index: number, to: "front" | "back"): string {
  const count = rawCards(fileText).length;
  if (count < 2 || (to === "front" && index === count - 1) || (to === "back" && index === 0)) return fileText;
  const lines = cardLines(fileText, index);
  const edge = cardLines(fileText, to === "front" ? count - 1 : 0);
  if (lines && edge) {
    let card = fileText.slice(lines[0], lines[1]);
    const rest = fileText.slice(0, lines[0]) + fileText.slice(lines[1]);
    if (!card.endsWith("\n")) card += "\n";
    // Where the edge card is once this one's lines are gone.
    const at = to === "back" ? edge[0] : edge[1] - (lines[1] - lines[0]);
    const before = rest.slice(0, at);
    return (before.endsWith("\n") || before === "" ? before : `${before}\n`) + card + rest.slice(at);
  }
  const cards = rawCards(fileText);
  const [card] = cards.splice(index, 1);
  return editYaml(fileText, [{ path: ["cards"], value: to === "front" ? [...cards, card] : [card, ...cards] }]);
}

/** A board's file with a card added on top, on a line of its own. */
export function addCard(fileText: string, card: BoardCard): string {
  const count = rawCards(fileText).length;
  const last = count ? cardLines(fileText, count - 1) : undefined;
  if (last) {
    const before = fileText.slice(0, last[1]);
    return (before.endsWith("\n") ? before : `${before}\n`) + cardLine(card) + fileText.slice(last[1]);
  }
  const doc = parseDocument(fileText);
  if (!count && !doc.has("cards")) return `${fileText.endsWith("\n") || fileText === "" ? fileText : `${fileText}\n`}cards:\n${cardLine(card)}`;
  if (!count) return fileText.replace(/^cards:.*$/m, `cards:\n${cardLine(card).trimEnd()}`);
  return editYaml(fileText, [{ path: ["cards", count], value: parseDocument(cardLine(card).replace(/^  - /, "")).toJS() }]);
}

/** Several cards added after the last, in order. */
export const addCards = (fileText: string, cards: readonly BoardCard[]): string => cards.reduce(addCard, fileText);

/** A new note's and entry's card, as the mock-ups draw them (#208). */
export const NOTE_SIZE: Pair = [252, 300];
export const ENTRY_SIZE: Pair = [196, 230];
/** A picture's card when its picture can't be read. */
export const PICTURE_SIZE: Pair = [240, 180];
const GAP = 40;

/** A new picture's card: the picture's own shape, its longest side `longest`. */
export function pictureSize(width: number, height: number, longest = 280): Pair {
  if (!(width > 0 && height > 0)) return PICTURE_SIZE;
  const scale = longest / Math.max(width, height);
  return [Math.max(48, Math.round(width * scale)), Math.max(36, Math.round(height * scale))];
}

/** Where cards put on a board from elsewhere go: to the right of everything on it, level with its top; at the origin on an empty board. */
export function besideAll(cards: readonly (BoardCard | undefined)[]): Pair {
  const on = cards.filter((c): c is BoardCard => !!c);
  if (!on.length) return [0, 0];
  return [Math.max(...on.map((c) => c.at[0] + c.size[0])) + GAP, Math.min(...on.map((c) => c.at[1]))];
}

/**
 * A note and some of its pictures laid out from `at`: the note's card (unless `withNote` is false),
 * then its pictures' cards in a column to its right, each tethered to the note on the board.
 */
export function noteCards(note: string, at: Pair, withNote: boolean, pictures: readonly { path: string; size: Pair }[]): BoardCard[] {
  const out: BoardCard[] = withNote ? [{ kind: "note", note, wordsOnly: false, at, size: NOTE_SIZE }] : [];
  const x = withNote ? at[0] + NOTE_SIZE[0] + GAP * 1.5 : at[0];
  let y = at[1];
  for (const p of pictures) {
    out.push({ kind: "note-picture", note, picture: p.path, at: [x, y], size: p.size });
    y += p.size[1] + GAP / 2;
  }
  return out;
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
