import { carrierOf, carryingField, entryIds, type Book, type BookKind, type FieldDef } from "@writer/core";
import { recordWords, storyTimeline, timeOf, type StoryInstant, type TimelineItem } from "./time.ts";

/*
 * The timeline's data (D14, #30): the book's items in story time, in lanes, with the jumps between
 * them and the flashbacks. The app draws it and the snapshots are written from it.
 */

/**
 * How the timeline's lanes run: by the entry that carries each piece (its point of view), "carrier";
 * or by the entries of a field the kind runs lanes by, named by its entry type ("location", "plotline").
 */
export type LaneMode = string;

/** The fields the timeline can run lanes by. */
export const laneFields = (kind: BookKind): FieldDef[] => kind.fields.filter((f) => f.lanes && "entityType" in f.type);

/** The ways the timeline's lanes can run, in order: by carrier (for a kind with one), then by each lanes field's entry type. */
export const laneModes = (kind: BookKind): LaneMode[] => [...(carryingField(kind) ? ["carrier"] : []), ...laneFields(kind).map((f) => ("entityType" in f.type ? f.type.entityType : f.key))];

/** The timeline's lanes when none are chosen: its first way. */
export const defaultLanes = (kind: BookKind): LaneMode => laneModes(kind)[0] ?? "carrier";

export interface Lane {
  id: string;
  name: string;
}

export const itemId = (i: TimelineItem) => (i.kind === "scene" ? i.scene.id : i.record.id);
export const itemTitle = (i: TimelineItem) => (i.kind === "scene" ? i.scene.title : i.record.title);

/**
 * The lanes an item runs in: its carrier (point of view), or the entries its lanes field names (a
 * record's field of the same key, as an event's locations); none of them, the "none" lane. A record has
 * no carrier: its own lane, named for what's said of it among pieces ("off page").
 */
export function lanesOf(book: Book, i: TimelineItem, mode: LaneMode): string[] {
  if (mode === "carrier") return i.kind === "scene" ? [carrierOf(book.kind, i.scene) ?? NONE] : [asideLane(book, i)];
  const f = laneFields(book.kind).find((x) => "entityType" in x.type && x.type.entityType === mode);
  const ids = !f ? [] : entryIds(f, i.kind === "scene" ? i.scene.fields[f.key] : i.record.fields[f.key]);
  return ids.length ? ids : [NONE];
}

export const NONE = "(none)";
/** A record's lane by carrier: "(off page)". */
const asideLane = (book: Book, i: TimelineItem & { kind: "record" }) => `(${recordWords(book, i.record).aside})`;

const DAY = 86_400_000;
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** How far apart two moments in story time are, in words: "same time", "3 hours later", "4 days later", "14 years later". */
export function jump(from: StoryInstant, to: StoryInstant): string {
  if (from.dated !== to.dated) return "";
  const ms = to.start - from.start;
  if (ms <= 0) return "same time";
  const hours = Math.round(ms / 3_600_000);
  if (ms < DAY) return hours < 1 ? `${Math.max(1, Math.round(ms / 60_000))} min later` : `${plural(hours, "hour")} later`;
  const days = Math.round(ms / DAY);
  if (days < 60) return `${plural(days, "day")} later`;
  const months = Math.round(days / 30.4);
  if (months < 24) return `${plural(months, "month")} later`;
  return `${plural(Math.round(days / 365.25), "year")} later`;
}

/** When, in words: a date (and time), or "Day 3, 18:30" (with its date when the calendar gives one). */
export function when(i: TimelineItem): string {
  const w = i.kind === "scene" ? timeOf(i.scene).when : i.when;
  const date = new Date(i.at.start);
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  if (w && "day" in w) return `Day ${w.day}${w.time ? `, ${w.time}` : ""}${i.at.dated ? ` (${day})` : ""}`;
  return w && "at" in w && w.at.length > 10 ? `${day}, ${time}` : day;
}

export interface Timeline {
  items: TimelineItem[];
  /** Each item's place in story-time order, by ID. */
  storyRank: Map<string, number>;
  /** Scenes read after a scene that happens later: early in story time, late in the book. */
  flashbacks: Set<string>;
  undated: ReturnType<typeof storyTimeline>["undatedScenes"];
  undatedRecords: ReturnType<typeof storyTimeline>["undatedRecords"];
  lanes: Lane[];
}

/** The book's timeline, with lanes for `mode`: in order of first appearance, "none" and "off page" last. */
export function timeline(novel: Book, mode: LaneMode): Timeline {
  const t = storyTimeline(novel);
  const storyRank = new Map(t.items.map((i, k) => [itemId(i), k]));
  // A flashback: some scene read before it happens after it.
  const flashbacks = new Set<string>();
  let latest = -1;
  for (const scene of novel.pieces) {
    const rank = storyRank.get(scene.id);
    if (rank === undefined) continue;
    if (rank < latest) flashbacks.add(scene.id);
    latest = Math.max(latest, rank);
  }
  const seen: string[] = [];
  for (const i of t.items) for (const l of lanesOf(novel, i, mode)) if (!seen.includes(l)) seen.push(l);
  const asides = [...new Set(t.items.flatMap((i) => (i.kind === "record" ? [asideLane(novel, i)] : [])))];
  const special = [NONE, ...asides];
  const ordered = [...seen.filter((l) => !special.includes(l)), ...special.filter((l) => seen.includes(l))];
  const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const name = (id: string) =>
    id === NONE
      ? `No ${(mode === "carrier" ? carryingField(novel.kind)?.label : novel.entityTypes.find((t) => t.key === mode)?.label)?.toLowerCase() ?? "one"}`
      : asides.includes(id)
        ? capital(id.slice(1, -1))
        : (novel.entities.find((e) => e.id === id)?.name ?? id);
  return { items: t.items, storyRank, flashbacks, undated: t.undatedScenes, undatedRecords: t.undatedRecords, lanes: ordered.map((id) => ({ id, name: name(id) })) };
}
