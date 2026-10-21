import { entriesOf, recordEntries, recordType, recordTypesOf, storyTimeValue, typesThatAre, word, type Book, type BookKind, type FieldDef, type ModuleRecord, type Piece, type RecordTypeDef, type StoryTime, type Word } from "@writer/core";

/*
 * Story time (D14, #30): when each piece happens, a day of the story or a date, and how long it lasts,
 * and when the records other modules keep do (an off-page event); the book's items in that order; and
 * who would have to be in two places at once. A piece's time is the module's `when` field, with its
 * duration; a record's is its type's story-time field.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * Where something sits in story time, in milliseconds. `dated` instants are real dates (an `at`, or a
 * relative day placed through calendar.start); relative days without a calendar are on their own
 * scale (day 1 at 0), which can't be compared with dates.
 */
export interface StoryInstant {
  start: number;
  /** start + duration, or start when there's no duration. */
  end: number;
  dated: boolean;
}

/** An ISO 8601 duration in milliseconds (a year as 365 days, a month as 30), or undefined if it isn't one. */
export function durationMs(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const m = /^P(?!$)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso);
  if (!m) return undefined;
  const [y, mo, w, d, h, mi, s] = m.slice(1).map((v) => Number(v ?? 0)) as number[];
  return ((((y! * 365 + mo! * 30 + w! * 7 + d!) * 24 + h!) * 60 + mi!) * 60 + s!) * 1000;
}

/** Midnight UTC of an ISO date ("2024-03-01"), or undefined. */
function dateMs(date: string): number | undefined {
  const t = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? undefined : t;
}

/** A story time as an instant: dates as given; day N through `calendarStart` (day 1 is that date), or on the relative scale. */
export function storyInstant(when: StoryTime | undefined, duration: string | undefined, calendarStart?: string): StoryInstant | undefined {
  if (!when) return undefined;
  let start: number | undefined;
  let dated: boolean;
  if ("at" in when) {
    // A date-time without a zone is story time, not anyone's local time: read as UTC.
    const at = /T\d{2}:\d{2}(:\d{2})?$/.test(when.at) ? `${when.at}Z` : when.at.length === 10 ? `${when.at}T00:00:00Z` : when.at;
    const t = Date.parse(at);
    if (Number.isNaN(t)) return undefined;
    start = t;
    dated = true;
  } else {
    const [hh, mm] = (when.time ?? "00:00").split(":").map(Number) as [number, number];
    const base = calendarStart ? dateMs(calendarStart) : undefined;
    start = (base ?? 0) + (when.day - 1) * DAY + (hh * 60 + mm) * MINUTE;
    dated = base !== undefined;
  }
  return { start, end: start + (durationMs(duration) ?? 0), dated };
}

/**
 * The date Day 1 is when `date` is day `day` (heffrey78/gh-writer#239): Day 3 on 2026-10-12 makes Day 1 2026-10-10. Day 0
 * is the day before Day 1, as everywhere in story time.
 */
export function dayOneFor(date: string, day: number): string {
  return new Date(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - (day - 1) * DAY).toISOString().slice(0, 10);
}

/**
 * The items on days of the story that can't be placed among the dated ones: Day 1 has no date, and
 * the book has both. None when it's all one or the other.
 */
export function apartInTime(timeline: StoryTimeline): TimelineItem[] {
  const days = timeline.items.filter((i) => !i.at.dated);
  return days.length && days.length < timeline.items.length ? days : [];
}

/** The module's field: when a piece happens, with how long under `duration`. */
export const WHEN = { key: "when", durationKey: "duration" } as const;

/** When a piece happens, and for how long: its `when` field, read as story time. */
export function timeOf(piece: Piece): { when?: StoryTime; duration?: string } {
  const when = storyTimeValue(piece.fields[WHEN.key]);
  const duration = piece.fields[WHEN.durationKey];
  return { ...(when ? { when } : {}), ...(typeof duration === "string" && duration ? { duration } : {}) };
}

/** Where a piece is in story time, through the book's calendar: undefined for one without a time. */
export function pieceInstant(book: Book, piece: Piece): StoryInstant | undefined {
  const { when, duration } = timeOf(piece);
  return storyInstant(when, duration, book.config?.calendar?.start);
}

type StoryTimeFieldDef = FieldDef & { type: { kind: "story-time"; durationKey: string } };
const timeField = (kind: BookKind, type: RecordTypeDef) => type.fields(kind).find((f): f is StoryTimeFieldDef => f.type.kind === "story-time");

/** The record types of the kind's modules that happen in story time, those with a story-time field: an off-page event. */
export const timedTypes = (kind: BookKind): RecordTypeDef[] => recordTypesOf(kind).filter((t) => timeField(kind, t));

/** When a module's record happens, and for how long: its type's story-time field. */
export function recordTime(book: Book, record: ModuleRecord): { when?: StoryTime; duration?: string } {
  const type = recordType(book.kind, record.type);
  const f = type && timeField(book.kind, type);
  if (!f) return {};
  const when = storyTimeValue(record.fields[f.key]);
  const duration = record.fields[f.type.durationKey];
  return { ...(when ? { when } : {}), ...(typeof duration === "string" && duration ? { duration } : {}) };
}

/** What a module's record is called, in the forms sentences need, and after its title among pieces ("off page"). */
export function recordWords(book: Book, record: ModuleRecord): Word & { aside: string } {
  const type = recordType(book.kind, record.type);
  return { ...word(type?.noun ?? { label: record.type, plural: record.type }), aside: type?.aside ?? record.type };
}

/** A scene, or a module's record with its time as written (`when`). */
export type TimelineItem = { kind: "scene"; scene: Piece; at: StoryInstant } | { kind: "record"; record: ModuleRecord; when: StoryTime; at: StoryInstant };

export interface StoryTimeline {
  /** Scenes and the modules' records (off-page events) with a time, in story-time order: dated first, then relative days; reading order breaks ties. */
  items: TimelineItem[];
  /** Scenes in reading order that have no time. */
  undatedScenes: Piece[];
  undatedRecords: ModuleRecord[];
}

const itemId = (i: TimelineItem) => (i.kind === "scene" ? i.scene.id : i.record.id);

/** The book's scenes, and the records its modules keep in story time (off-page events), in story-time order. */
export function storyTimeline(novel: Book): StoryTimeline {
  const start = novel.config?.calendar?.start;
  const items: TimelineItem[] = [];
  const undatedScenes: Piece[] = [];
  const undatedRecords: ModuleRecord[] = [];
  for (const scene of novel.pieces) {
    const at = pieceInstant(novel, scene);
    if (at) items.push({ kind: "scene", scene, at });
    else undatedScenes.push(scene);
  }
  const timed = new Set(timedTypes(novel.kind).map((t) => t.key));
  for (const record of novel.moduleRecords) {
    if (!timed.has(record.type)) continue;
    const { when, duration } = recordTime(novel, record);
    const at = storyInstant(when, duration, start);
    if (at && when) items.push({ kind: "record", record, when, at });
    else undatedRecords.push(record);
  }
  const reading = (i: TimelineItem) => (i.kind === "scene" ? i.scene.position : Infinity);
  items.sort((a, b) => Number(b.at.dated) - Number(a.at.dated) || a.at.start - b.at.start || reading(a) - reading(b) || itemId(a).localeCompare(itemId(b)));
  return { items, undatedScenes, undatedRecords };
}

/**
 * Who is where in an item: the people a piece's fields name (its point of view too) and the places,
 * by their types; a record's (an event's), from its type's fields the same way.
 */
export function cast(book: Book, i: TimelineItem): { characters: Set<string>; locations: Set<string> } {
  const of = (is: "person" | "place") => new Set(typesThatAre(book, is).flatMap((t) => (i.kind === "scene" ? entriesOf(book, i.scene, t) : recordEntries(book, i.record, t))));
  return { characters: of("person"), locations: of("place") };
}

export interface Overlap {
  character: string;
  a: TimelineItem;
  b: TimelineItem;
}

/**
 * Someone in two places at once: a character in two items whose times overlap (on the same scale),
 * whose locations are given and share none. Items without a duration are moments: they overlap only
 * an item running across them, or a moment at the same time.
 */
export function overlaps(book: Book, timeline: StoryTimeline): Overlap[] {
  const out: Overlap[] = [];
  const { items } = timeline;
  for (let i = 0; i < items.length; i++) {
    const a = items[i]!;
    const ca = cast(book, a);
    if (!ca.locations.size) continue;
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j]!;
      if (b.at.dated !== a.at.dated) continue;
      // Sorted by start: once b starts after a has ended (or after a's moment), nothing later overlaps a.
      if (b.at.start > a.at.end || (b.at.start === a.at.end && a.at.end > a.at.start)) break;
      const together = b.at.start < a.at.end || b.at.start === a.at.start;
      if (!together) continue;
      const cb = cast(book, b);
      if (!cb.locations.size || [...ca.locations].some((l) => cb.locations.has(l))) continue;
      for (const character of ca.characters) if (cb.characters.has(character)) out.push({ character, a, b });
    }
  }
  return out;
}

/**
 * The scenes either side of a scene or a record (an event) in story time: the last one before it and the first after
 * it, on its own scale (dates, or relative days without a calendar). None for something undated.
 */
export function sceneNeighbours(timeline: StoryTimeline, id: string): { before?: Piece; after?: Piece } {
  const at = timeline.items.findIndex((i) => itemId(i) === id);
  if (at < 0) return {};
  const item = timeline.items[at]!;
  const scene = (i: TimelineItem | undefined) => (i?.kind === "scene" && i.at.dated === item.at.dated ? i.scene : undefined);
  let before: Piece | undefined;
  for (let i = at - 1; i >= 0 && !before; i--) before = scene(timeline.items[i]);
  let after: Piece | undefined;
  for (let i = at + 1; i < timeline.items.length && !after; i++) after = scene(timeline.items[i]);
  return { ...(before ? { before } : {}), ...(after ? { after } : {}) };
}
