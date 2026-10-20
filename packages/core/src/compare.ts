import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toString } from "mdast-util-to-string";
import { gfm } from "micromark-extension-gfm";
import { chapterTitle, describeRelationship } from "./diagrams.ts";
import { entryIds, fieldName, itemsOf, itemText } from "./fields.ts";
import type { FieldDef } from "./kinds.ts";
import { pieceSections, sectionById, type Section, type Entity, type Book, type ModuleRecord, type Relationship, type Piece } from "./model.ts";
import { recordTypesOf } from "./modules.ts";
import type { StoryTime } from "./types.ts";
import { diffParagraphs, diffSequences, type ParagraphDiff } from "./word-diff.ts";
import { countWords } from "./words.ts";

/*
 * Two states of a novel side by side (heffrey78/gh-writer#17): two versions, a checkpoint and now. Everything is matched
 * by ID, so a renamed or moved scene is the same scene. The prose of one scene is compared word by
 * word on demand (compareProse); the rest says what changed in plain words.
 */

export { diffParagraphs, diffWords, type DiffOp, type DiffPart, type ParagraphDiff } from "./word-diff.ts";

export type ChangeStatus = "added" | "removed" | "changed" | "unchanged";

/** A field that differs: missing on one side when it was added or removed. Lists read "Ada Varn, Ben Varn". */
export interface FieldChange {
  label: string;
  before?: string;
  after?: string;
}

export interface WordChange {
  before: number;
  after: number;
}

export interface SceneComparison {
  id: string;
  /** Its title now (or, removed, as it was). */
  title: string;
  status: ChangeStatus;
  /** In another chapter, or in another place among the scenes both have. */
  moved: boolean;
  /** The chapter it was in, when that's another one. */
  movedFrom?: string;
  fields: FieldChange[];
  /** Its text differs (compareProse shows how). */
  prose: boolean;
  words: WordChange;
}

export interface ChapterComparison {
  id: string;
  title: string;
  status: ChangeStatus;
  moved: boolean;
  fields: FieldChange[];
  scenes: SceneComparison[];
  words: WordChange;
}

export interface EntryComparison {
  id: string;
  name: string;
  /** Its type's label: "Character". */
  type: string;
  status: Exclude<ChangeStatus, "unchanged">;
  fields: FieldChange[];
}

export interface RelationshipComparison {
  id: string;
  status: Exclude<ChangeStatus, "unchanged">;
  /** As sentences: "Ada Varn: Allied with Ben Varn, until “The Betrayal”". */
  before?: string;
  after?: string;
}

/** A module's record that changed: an off-page event. */
export interface RecordComparison {
  /** Its type's key: "event". */
  type: string;
  id: string;
  title: string;
  status: Exclude<ChangeStatus, "unchanged">;
  fields: FieldChange[];
}

export interface Comparison {
  words: WordChange;
  /** How many scenes were added, removed, changed (text or details) and moved. */
  counts: { added: number; removed: number; changed: number; moved: number };
  /** The chapters in reading order as they are now, removed ones where they were. Every scene is listed. */
  chapters: ChapterComparison[];
  /** Only what changed. */
  entries: EntryComparison[];
  relationships: RelationshipComparison[];
  /** The modules' records, by type in the order the kind lists its modules. */
  records: RecordComparison[];
}

/** What changed from `before` to `after`. */
export function compareNovels(before: Book, after: Book): Comparison {
  const sceneA = new Map(before.allPieces.map((s) => [s.id, s]));
  const sceneB = new Map(after.allPieces.map((s) => [s.id, s]));
  const chapterA = new Map(pieceSections(before).map((c) => [c.id, c]));
  const chapterB = new Map(pieceSections(after).map((c) => [c.id, c]));

  // Moved: scenes (and chapters) both have, out of the longest run they share in reading order.
  const movedScenes = outOfOrder(
    before.allPieces.map((s) => s.id).filter((id) => sceneB.has(id)),
    after.allPieces.map((s) => s.id).filter((id) => sceneA.has(id)),
  );
  const movedChapters = outOfOrder(
    pieceSections(before).map((c) => c.id).filter((id) => chapterB.has(id)),
    pieceSections(after).map((c) => c.id).filter((id) => chapterA.has(id)),
  );

  const scene = (id: string, chapter: Section): SceneComparison => {
    const a = sceneA.get(id);
    const b = sceneB.get(id);
    const fields = sceneFields(before, a, after, b);
    const prose = (a?.body ?? "") !== (b?.body ?? "");
    const fromChapter = a?.sectionId !== undefined && b && a.sectionId !== b.sectionId ? chapterA.get(a.sectionId) : undefined;
    const status: ChangeStatus = !a ? "added" : !b ? "removed" : prose || fields.length ? "changed" : "unchanged";
    return {
      id,
      title: (b ?? a)!.title,
      status,
      moved: !!a && !!b && (movedScenes.has(id) || a.sectionId !== b.sectionId),
      ...(fromChapter && chapter.id !== fromChapter.id ? { movedFrom: chapterTitle(before, fromChapter) } : {}),
      fields,
      prose,
      words: { before: a ? countWords(a.body) : 0, after: b ? countWords(b.body) : 0 },
    };
  };

  const chapters: ChapterComparison[] = [];
  for (const id of interleave(pieceSections(before).map((c) => c.id), pieceSections(after).map((c) => c.id))) {
    const a = chapterA.get(id);
    const b = chapterB.get(id);
    const chapter = (b ?? a)!;
    // A chapter's scenes now, and those it had that are gone from the book, where they were.
    const kept = b ? b.childIds : [];
    const gone = (a?.childIds ?? []).filter((s) => !sceneB.has(s));
    const ids = interleave(a?.childIds.filter((s) => kept.includes(s) || gone.includes(s)) ?? [], kept);
    const scenes = ids.filter((s) => sceneA.has(s) || sceneB.has(s)).map((s) => scene(s, chapter));
    const fields = [
      field("Title", a && chapterTitle(before, a), b && chapterTitle(after, b), !!a && !!b),
      field("Synopsis", a?.synopsis, b?.synopsis, !!a && !!b),
      field(after.kind.levels.at(-2)?.label ?? "", a && partTitle(before, a), b && partTitle(after, b), !!a && !!b),
    ].filter((f): f is FieldChange => !!f);
    const words = scenes.reduce((w, s) => ({ before: w.before + s.words.before, after: w.after + s.words.after }), { before: 0, after: 0 });
    // A chapter whose scenes left is changed, though they're listed where they went.
    const lost = (a?.childIds ?? []).some((s) => sceneB.has(s) && !kept.includes(s));
    const status: ChangeStatus = !a ? "added" : !b ? "removed" : fields.length || lost || scenes.some((s) => s.status !== "unchanged" || s.moved) ? "changed" : "unchanged";
    chapters.push({ id, title: chapterTitle(b ? after : before, chapter), status, moved: !!a && !!b && movedChapters.has(id), fields, scenes, words });
  }

  const all = chapters.flatMap((c) => c.scenes);
  return {
    words: { before: wordsOf(before), after: wordsOf(after) },
    counts: {
      added: all.filter((s) => s.status === "added").length,
      removed: all.filter((s) => s.status === "removed").length,
      changed: all.filter((s) => s.status === "changed").length,
      moved: all.filter((s) => s.moved).length,
    },
    chapters,
    entries: compareEntries(before, after),
    relationships: compareRelationships(before, after),
    records: compareRecords(before, after),
  };
}

/** One scene's text, before and after, paragraph by paragraph with reworded paragraphs word by word. Hidden notes are left out. */
export function compareProse(before: string | undefined, after: string | undefined): ParagraphDiff[] {
  return diffParagraphs(before === undefined ? [] : proseParagraphs(before), after === undefined ? [] : proseParagraphs(after));
}

/** A scene body's paragraphs as read: a mention is its words, a link its text; hidden notes are left out; a break is "* * *". */
export function proseParagraphs(markdown: string): string[] {
  const tree = fromMarkdown(markdown.replace(/\r\n?/g, "\n"), { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const out: string[] = [];
  // Soft line breaks (hard-wrapped prose) read as spaces.
  const read = (node: Nodes) => toString(node, { includeHtml: false }).replace(/[ \t]*\n[ \t]*/g, " ").trim();
  const walk = (node: Nodes) => {
    switch (node.type) {
      case "html":
        return;
      case "thematicBreak":
        out.push("* * *");
        return;
      case "blockquote":
      case "list":
      case "listItem":
        for (const child of node.children) walk(child);
        return;
      // A table row by row, its cells set apart; a picture by its description and caption (D10).
      case "table":
        for (const row of node.children) out.push(row.children.map((cell) => read(cell)).join(" | "));
        return;
      case "paragraph": {
        const content = node.children.filter((c) => !(c.type === "text" && !c.value.trim()));
        const image = content.length === 1 && content[0]!.type === "image" ? content[0]! : undefined;
        if (image) {
          out.push(`Picture: ${image.alt ?? ""}${image.title ? ` — ${image.title}` : ""}`.trim());
          return;
        }
        const text = read(node);
        if (text) out.push(text);
        return;
      }
      default: {
        const text = read(node);
        if (text) out.push(text);
      }
    }
  };
  for (const child of tree.children) walk(child);
  return out;
}

const wordsOf = (novel: Book) => novel.allPieces.reduce((n, s) => n + countWords(s.body), 0);

/** Items not in the longest common subsequence of two orders of the same items. */
function outOfOrder(a: string[], b: string[]): Set<string> {
  const moved = new Set<string>();
  for (const run of diffSequences(a, b)) if (run.op === "ins") run.items.forEach((id) => moved.add(id));
  return moved;
}

/** The IDs in `after`'s order, with those only in `before` placed after the one that preceded them there. */
function interleave(before: string[], after: string[]): string[] {
  const out = [...after];
  const present = new Set(after);
  let anchor = -1;
  for (const id of before) {
    if (present.has(id)) {
      anchor = out.indexOf(id);
      continue;
    }
    out.splice(++anchor, 0, id);
    present.add(id);
  }
  return out;
}

/**
 * A field's change, or undefined when it's the same. `both`: the record is on both sides (a record
 * added or removed lists its fields as values on one side only).
 */
function field(label: string, before: string | undefined, after: string | undefined, both = true): FieldChange | undefined {
  const a = before || undefined;
  const b = after || undefined;
  if (a === b) return undefined;
  if (!both && !a && !b) return undefined;
  return { label, ...(a !== undefined ? { before: a } : {}), ...(b !== undefined ? { after: b } : {}) };
}

const names = (novel: Book, ids: readonly string[] | undefined) => (ids ?? []).map((id) => novel.entities.find((e) => e.id === id)?.name ?? id).join(", ") || undefined;
const nameOf = (novel: Book, id: string | undefined) => (id ? (novel.entities.find((e) => e.id === id)?.name ?? id) : undefined);

function partTitle(novel: Book, chapter: Section): string | undefined {
  return sectionById(novel, chapter.parentId)?.title;
}

function when(time: StoryTime | undefined): string | undefined {
  if (!time) return undefined;
  if ("at" in time) return time.at;
  return `Day ${time.day}${time.time ? `, ${time.time}` : ""}`;
}

function sceneFields(novelA: Book, a: Piece | undefined, novelB: Book, b: Piece | undefined): FieldChange[] {
  // Added and removed scenes are listed as such; their fields aren't changes.
  if (!a || !b) return [];
  // The kind's fields, as the piece's card reads them: names, and what each item carries.
  const read = (novel: Book, s: Piece, f: FieldDef) =>
    f.type.kind === "entities"
      ? itemsOf(s.fields[f.key]).map((item) => `${nameOf(novel, entryIds(f, [item])[0])}${itemText(f, item)}`).join(", ") || undefined
      : names(novel, entryIds(f, s.fields[f.key]));
  return [
    field("Title", a.title, b.title),
    field("Synopsis", a.synopsis, b.synopsis),
    field("Status", a.status, b.status),
    ...novelB.kind.fields.flatMap((f) =>
      f.type.kind === "story-time"
        ? [field(f.label, when(a.fields[f.key] as StoryTime | undefined), when(b.fields[f.key] as StoryTime | undefined)), field("Duration", str(a.fields[f.type.durationKey]), str(b.fields[f.type.durationKey]))]
        : [field(fieldName(f), read(novelA, a, f), read(novelB, b, f))],
    ),
    field("Tags", a.tags.join(", "), b.tags.join(", ")),
  ].filter((f): f is FieldChange => !!f);
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

function typeLabel(novel: Book, entity: Entity): string {
  return novel.entityTypes.find((t) => t.key === entity.type)?.label ?? entity.type;
}

function compareEntries(before: Book, after: Book): EntryComparison[] {
  const a = new Map(before.entities.map((e) => [e.id, e]));
  const out: EntryComparison[] = [];
  const entryFields = (x: Entity | undefined, y: Entity | undefined) => {
    const keys = [...new Set([...Object.keys(x?.fields ?? {}), ...Object.keys(y?.fields ?? {})])];
    const both = !!x && !!y;
    return [
      field("Name", x?.name, y?.name, both),
      field("Other names", x?.aliases.join(", "), y?.aliases.join(", "), both),
      field("Summary", x?.summary, y?.summary, both),
      ...keys.map((k) => field(k, x?.fields[k]?.toString(), y?.fields[k]?.toString(), both)),
      field("Tags", x?.tags.join(", "), y?.tags.join(", "), both),
      field("Image", x?.image, y?.image, both),
      field("Notes", x?.body.trim(), y?.body.trim(), both),
    ].filter((f): f is FieldChange => !!f);
  };
  for (const y of after.entities) {
    const x = a.get(y.id);
    const fields = x ? entryFields(x, y) : [];
    if (!x || fields.length) out.push({ id: y.id, name: y.name, type: typeLabel(after, y), status: x ? "changed" : "added", fields });
  }
  for (const x of before.entities) if (!after.entities.some((e) => e.id === x.id)) out.push({ id: x.id, name: x.name, type: typeLabel(before, x), status: "removed", fields: [] });
  return out;
}

function compareRelationships(before: Book, after: Book): RelationshipComparison[] {
  const sentence = (novel: Book, r: Relationship) => `${nameOf(novel, r.from)}: ${describeRelationship(novel, r.from, r)}`;
  const same = (x: Relationship, y: Relationship) => x.from === y.from && x.to === y.to && x.type === y.type && x.since === y.since && x.until === y.until && x.note === y.note;
  const a = new Map(before.relationships.map((r) => [r.id, r]));
  const b = new Map(after.relationships.map((r) => [r.id, r]));
  const out: RelationshipComparison[] = [];
  for (const y of after.relationships) {
    const x = a.get(y.id);
    if (!x) out.push({ id: y.id, status: "added", after: sentence(after, y) });
    else if (!same(x, y)) out.push({ id: y.id, status: "changed", before: sentence(before, x), after: sentence(after, y) });
  }
  for (const x of before.relationships) if (!b.has(x.id)) out.push({ id: x.id, status: "removed", before: sentence(before, x) });
  return out;
}

/** The modules' records that changed: their title, their type's fields as a piece's are read, and their prose. */
function compareRecords(before: Book, after: Book): RecordComparison[] {
  const out: RecordComparison[] = [];
  for (const type of recordTypesOf(after.kind)) {
    const fields = type.fields(after.kind);
    const of = (book: Book) => book.moduleRecords.filter((r) => r.type === type.key);
    const a = new Map(of(before).map((r) => [r.id, r]));
    const changes = (x: ModuleRecord, y: ModuleRecord) =>
      [
        field("Title", x.title, y.title),
        ...fields.flatMap((f) =>
          f.type.kind === "story-time"
            ? [field(f.label, when(x.fields[f.key] as StoryTime | undefined), when(y.fields[f.key] as StoryTime | undefined)), field("Duration", str(x.fields[f.type.durationKey]), str(y.fields[f.type.durationKey]))]
            : [field(fieldName(f), names(before, entryIds(f, x.fields[f.key])), names(after, entryIds(f, y.fields[f.key])))],
        ),
        field("Note", x.body, y.body),
      ].filter((f): f is FieldChange => !!f);
    for (const y of of(after)) {
      const x = a.get(y.id);
      const changed = x ? changes(x, y) : [];
      if (!x || changed.length) out.push({ type: type.key, id: y.id, title: y.title, status: x ? "changed" : "added", fields: changed });
    }
    for (const x of of(before)) if (!of(after).some((r) => r.id === x.id)) out.push({ type: type.key, id: x.id, title: x.title, status: "removed", fields: [] });
  }
  return out;
}
