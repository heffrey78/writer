import type { EntityTypeDef } from "./ids.ts";
import type { BookKind } from "./kinds.ts";
import type {
  CompileFile,
  Diagnostic,
  EventRecord,
  NovelFile,
  RelationshipRecord,
  RelationshipTypeFile,
  PieceStatus,
  StoryTime,
} from "./types.ts";

/** A book loaded into memory. Collections are in reading order where that applies. */
export interface Book {
  /** What kind of book it is: data, so it travels with the model to the browser. */
  kind: BookKind;
  /** Its manifest's file: book.yaml (format 3), or novel.yaml (a novel in format 1 or 2). */
  manifest: string;
  config: NovelFile | undefined;
  entityTypes: EntityTypeDef[];
  relationshipTypes: RelationshipTypeFile[];
  /**
   * The levels of its kind the book uses, outermost first, as its _order.yaml says: a novel in parts
   * uses part and chapter, one without them only chapter. Empty when there's no order to go by.
   */
  levels: string[];
  /** Sections and pieces listed in order files, in reading order: each section before what it holds. */
  sections: Section[];
  pieces: Piece[];
  /** Every section and piece found on disk, including ones missing from order files. */
  allSections: Section[];
  allPieces: Piece[];
  entities: Entity[];
  relationships: Relationship[];
  events: StoryEvent[];
  /** The writer's notes (notes/, D12), not story facts. */
  notes: Note[];
  layouts: Record<string, { nodes: Record<string, { x: number; y: number }> }>;
  /** compile.yaml, if there is one. */
  compile?: CompileFile;
  /** Diagnostics found while loading (parse, schema and structure problems). */
  diagnostics: Diagnostic[];
}

/** A section of the book at one of its kind's levels, such as a part or a chapter. */
export interface Section {
  id: string;
  /** Its level's key in the book's kind: "part", "chapter". */
  level: string;
  /** A level that's `titled` always has one ("" when the file has none). */
  title?: string;
  synopsis?: string;
  /** What it holds, in order, as its file lists them: sections of the next level, or pieces. */
  childIds: string[];
  /** The section it's in; none at the book's outermost level. */
  parentId?: string;
  /** Its folder, and the _<level>.yaml in it. */
  dir: string;
  file: string;
}

export interface ThemeRef {
  id: string;
  strength?: number;
  note?: string;
}

export interface Piece {
  id: string;
  title: string;
  synopsis?: string;
  status: PieceStatus;
  characters: string[];
  locations: string[];
  /** Entries of custom types (not characters, locations, plotlines or themes) in the scene. */
  entities: string[];
  themes: ThemeRef[];
  when?: StoryTime;
  duration?: string;
  tags: string[];
  /**
   * The values of its kind's declared fields (BookKind.fields), as its front matter has them, by key:
   * what the card, the validator, comparisons and commit messages read. The properties above are the
   * Novel's same fields, typed, for the code that reads them as a novel's (until its modules own them).
   */
  fields: Record<string, unknown>;
  sectionId?: string;
  /** Position in reading order, or -1 if the scene is not in any order file. */
  position: number;
  body: string;
  bodyLine: number;
  file: string;
}

export interface Entity {
  id: string;
  /** Entity type key, e.g. "character". */
  type: string;
  name: string;
  aliases: string[];
  summary?: string;
  /** A picture: a repository path (the app saves them under images/). */
  image?: string;
  /** Where thumbnails of the picture centre: x and y, fractions of its width and height. */
  imageFocus?: [number, number];
  fields: Record<string, string | number | boolean>;
  tags: string[];
  body: string;
  bodyLine: number;
  file: string;
}

export interface Relationship extends RelationshipRecord {
  file: string;
  /** Index within relationships.yaml, for diagnostics. */
  index: number;
}

/** An off-page event: a file of its own in bible/events/ (format v2), or an item of bible/events.yaml (v1). */
export interface StoryEvent extends Omit<EventRecord, "note"> {
  /** The scene that dramatizes it. */
  scene?: string;
  /** Its note: Markdown prose with mentions (in bible/events.yaml, the one-line `note`). */
  body: string;
  bodyLine: number;
  file: string;
  /** Index within bible/events.yaml, for diagnostics; undefined for an event file. */
  index?: number;
}

/** A writer's note: notes/<slug>.md (D12). */
export interface Note {
  id: string;
  title: string;
  tags: string[];
  /** The scenes it belongs to (heffrey78/gh-writer#222). */
  scenes: string[];
  /** The scenes, of those, where it's pinned to the top of their notes. */
  pinned: string[];
  /** The ISO date the app made it. */
  created?: string;
  /** The event or scene it was promoted to, when kept. */
  became?: string;
  body: string;
  bodyLine: number;
  file: string;
}

export type RecordKind = "book" | "section" | "piece" | "entity" | "relationship" | "event" | "note";

export interface RecordRef {
  kind: RecordKind;
  id: string;
  file: string;
  /** Entity type key, for entities. */
  type?: string;
  /** Level key, for sections. */
  level?: string;
}

/** Every record with an ID, in discovery order. Duplicate IDs appear more than once. */
export function allRecords(novel: Book): RecordRef[] {
  const out: RecordRef[] = [];
  if (novel.config?.id) out.push({ kind: "book", id: novel.config.id, file: novel.manifest });
  // Outer levels first: of two sections with one ID, the outer one is found first.
  const depth = (s: Section) => novel.kind.levels.findIndex((l) => l.key === s.level);
  for (const s of [...novel.allSections].sort((a, b) => depth(a) - depth(b))) out.push({ kind: "section", id: s.id, file: s.file, level: s.level });
  for (const s of novel.allPieces) out.push({ kind: "piece", id: s.id, file: s.file });
  for (const e of novel.entities) out.push({ kind: "entity", id: e.id, file: e.file, type: e.type });
  for (const r of novel.relationships) out.push({ kind: "relationship", id: r.id, file: r.file });
  for (const e of novel.events) out.push({ kind: "event", id: e.id, file: e.file });
  for (const n of novel.notes) out.push({ kind: "note", id: n.id, file: n.file });
  return out;
}

/** Index of records by ID (first occurrence wins). */
export function indexById(novel: Book): Map<string, RecordRef> {
  const map = new Map<string, RecordRef>();
  for (const r of allRecords(novel)) if (!map.has(r.id)) map.set(r.id, r);
  return map;
}

export function entityById(novel: Book, id: string): Entity | undefined {
  return novel.entities.find((e) => e.id === id);
}

export function pieceById(novel: Book, id: string): Piece | undefined {
  return novel.allPieces.find((s) => s.id === id);
}

/** The innermost level of the book's kind: the one whose sections hold the pieces. */
export const pieceLevel = (book: Book) => book.kind.levels.at(-1)!.key;

/** The book's sections at a level, in reading order. */
export const sectionsAt = (book: Book, level: string) => book.sections.filter((s) => s.level === level);

/** The sections that hold the pieces (a novel's chapters), in reading order. */
export const pieceSections = (book: Book) => sectionsAt(book, pieceLevel(book));

/** The sections one level out from the pieces' (a novel's parts), in reading order: none in a book without that level. */
export function outerSections(book: Book): Section[] {
  const level = book.kind.levels.at(-2);
  return level ? sectionsAt(book, level.key) : [];
}

/** A section by its ID, listed or not. */
export const sectionById = (book: Book, id: string | undefined) => (id === undefined ? undefined : book.allSections.find((s) => s.id === id));

/** A section's label in the book's kind: "Part", "Chapter". */
export const levelLabel = (book: Book, level: string) => book.kind.levels.find((l) => l.key === level)?.label ?? level;

function positionOf(novel: Book, sceneId: string | undefined): number | undefined {
  if (sceneId === undefined) return undefined;
  const p = pieceById(novel, sceneId)?.position;
  return p === undefined || p < 0 ? undefined : p;
}

/**
 * Relationships in effect at a scene: `since` is inclusive, `until` exclusive.
 * A bound that does not resolve to an ordered scene is ignored (the validator reports it).
 */
export function relationshipsAt(novel: Book, sceneId: string): Relationship[] {
  const at = positionOf(novel, sceneId);
  if (at === undefined) return [];
  return novel.relationships.filter((r) => {
    const since = positionOf(novel, r.since);
    const until = positionOf(novel, r.until);
    return (since === undefined || since <= at) && (until === undefined || at < until);
  });
}

const MENTION = /\[([^\]\n]*)\]\(#([a-z]{2,8}_[0-9a-hjkmnp-tv-z]{6})\)/g;

export interface Mention {
  text: string;
  id: string;
  /** 1-based line within the body. */
  line: number;
}

/** A picture in Markdown prose: `![alt](src "caption")` (D10). */
export interface Picture {
  alt: string;
  src: string;
  caption?: string;
  /** 1-based line within the body. */
  line: number;
}

const PICTURE = /!\[([^\]\n]*)\]\(\s*<?([^\s)>]+)>?(?:\s+(?:"([^"\n]*)"|'([^'\n]*)'))?\s*\)/g;

/** The pictures in Markdown prose. */
export function pictures(body: string): Picture[] {
  const out: Picture[] = [];
  body.split("\n").forEach((lineText, i) => {
    for (const m of lineText.matchAll(PICTURE)) {
      const caption = m[3] ?? m[4];
      out.push({ alt: m[1]!, src: m[2]!, ...(caption ? { caption } : {}), line: i + 1 });
    }
  });
  return out;
}

/**
 * The repository path of a picture's `src`, written from the repository root as github.com reads it
 * (`/images/map.jpg` → `images/map.jpg`), or undefined for anything outside `images/`.
 */
export function picturePath(src: string): string | undefined {
  let path: string;
  try {
    path = decodeURI(src);
  } catch {
    return undefined;
  }
  if (!path.startsWith("/images/") || path.includes("\\") || /(^|\/)\.\.?(\/|$)/.test(path.slice(1))) return undefined;
  return path.slice(1);
}

/** Entity mentions (`[Name](#id)`) in Markdown prose. */
export function mentions(body: string): Mention[] {
  const out: Mention[] = [];
  body.split("\n").forEach((lineText, i) => {
    for (const m of lineText.matchAll(MENTION)) out.push({ text: m[1]!, id: m[2]!, line: i + 1 });
  });
  return out;
}
