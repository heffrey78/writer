import { relationshipStyle, type SeriesSlot } from "./palette.ts";
import { carrierOf, carryingField, countWords, entriesOf, entryIds, itemsOf, mentions, relationshipsAt, storyTimeline, levelLabel, sectionById, sectionsAt, type Section, type Entity, type Book, type BookKind, type FieldDef, type ItemProp, type Relationship, type Piece, type StoryInstant, type TimelineItem } from "./index.ts";

/*
 * The data behind every diagram: the relationship graph, the plotline swimlanes, the presence matrix
 * and the timeline. The app draws them and the snapshots (Mermaid, SVG) are written from them, so a
 * diagram on github.com always shows what the app does.
 */

/** A section's title, or its level and number for one without ("Chapter 3"). */
export const chapterTitle = (novel: Book, chapter: Section) => chapter.title ?? `${levelLabel(novel, chapter.level)} ${sectionsAt(novel, chapter.level).findIndex((s) => s.id === chapter.id) + 1}`;

/** A relationship as a sentence from `id`'s side: "Rivals with Ben Varn, from “The Betrayal” (After the bridge betrayal.)". */
export function describeRelationship(novel: Book, id: string, r: Relationship): string {
  const type = novel.relationshipTypes.find((t) => t.key === r.type);
  const forward = r.from === id;
  const label = (forward || type?.symmetric ? type?.label : (type?.inverse_label ?? type?.label)) ?? r.type;
  const other = novel.entities.find((e) => e.id === (forward ? r.to : r.from))?.name ?? (forward ? r.to : r.from);
  const scene = (sceneId?: string) => novel.allPieces.find((s) => s.id === sceneId)?.title;
  const when = [r.since && `from “${scene(r.since) ?? r.since}”`, r.until && `until “${scene(r.until) ?? r.until}”`].filter(Boolean).join(", ");
  return `${label} ${other}${when ? `, ${when}` : ""}${r.note ? ` (${r.note})` : ""}`;
}

/** An entity on the relationship graph, where it's drawn. */
export interface GraphNode {
  id: string;
  label: string;
  /** The entity type's label, shown under the name. */
  type: string;
  x: number;
  y: number;
}

/** A relationship on the graph, styled by its type. */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  /** Its type's colour: a slot of the chart palette. */
  tone?: SeriesSlot;
  line?: "solid" | "dashed" | "dotted";
  /** Symmetric relationships have no arrow. */
  directed?: boolean;
  /** What a screen reader says for it, e.g. "Ada Varn, Allied with, Ben Varn". */
  ariaLabel?: string;
}

// ——— Columns ———

/** A grid cell's key: its row's ID and its scene's. */
export const gridKey = (row: string, scene: string) => `${row}|${scene}`;

/** Scenes grouped for column headers: by chapter, and by part when the book has them. */
export function sceneColumns(novel: Book, scenes: Piece[]) {
  const chapters: { chapter: Section; title: string; span: number }[] = [];
  const parts: { part: Section; span: number }[] = [];
  // By ID: in the browser the model is JSON, so a listed section and the same one in allSections are two objects.
  const listed = new Set(novel.sections.map((s) => s.id));
  for (const scene of scenes) {
    const chapter = sectionById(novel, scene.sectionId);
    if (!chapter || !listed.has(chapter.id)) continue;
    const last = chapters.at(-1);
    if (last?.chapter.id === chapter.id) last.span++;
    else chapters.push({ chapter, title: chapterTitle(novel, chapter), span: 1 });
    const part = sectionById(novel, chapter.parentId);
    if (!part || !listed.has(part.id)) continue;
    const lastPart = parts.at(-1);
    if (lastPart?.part.id === part.id) lastPart.span++;
    else parts.push({ part, span: 1 });
  }
  return { chapters, parts };
}

// ——— Relationship graph ———

/** The layouts.yaml diagram the relationship graph keeps its positions in. */
export const RELATIONSHIP_GRAPH = "relationship-graph";

export interface GraphView {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** The same relationships as sentences, for the text alternative. */
  list: { id: string; text: string }[];
}

/** What the graph shows. Every filter that's set must hold. */
export interface GraphFilter {
  /** Entity types shown as nodes (default: characters). */
  types?: string[];
  /** Relationship types shown as edges (default: all). */
  relationshipTypes?: string[];
  /** Only entities present in a scene that names this entry: a thread, such as a plotline. */
  thread?: string;
  /** Only entities present in a scene from `from` to `to` (inclusive, reading order); either end may be open. */
  from?: string;
  to?: string;
}

/** Everything a scene refers to: the entries its fields name (its point of view, people, places, plotlines, themes…) and its mentions. */
export function presentIn(book: Book, scene: Piece): Set<string> {
  return new Set([...entriesOf(book, scene), ...mentions(scene.body).map((m) => m.id)]);
}

/** The entities the scene filters (thread, range) allow, or undefined when neither is set. */
function presentInFiltered(novel: Book, f: GraphFilter): Set<string> | undefined {
  if (!f.thread && !f.from && !f.to) return undefined;
  const pos = (id: string | undefined, fallback: number) => (id ? Math.max(0, novel.pieces.findIndex((s) => s.id === id)) : fallback);
  const [lo, hi] = [pos(f.from, 0), pos(f.to, novel.pieces.length - 1)].sort((a, b) => a - b);
  const out = new Set<string>();
  novel.pieces.forEach((scene, i) => {
    if (i < lo! || i > hi!) return;
    if (f.thread && !entriesOf(novel, scene).includes(f.thread)) return;
    for (const id of presentIn(novel, scene)) out.add(id);
  });
  return out;
}

/**
 * The relationship graph at a scene: entities of the filter's types (and present where the scene
 * filters say) as nodes, at their saved positions or laid out around them, and the relationships
 * of the filter's types holding at `sceneId` between two shown entities as edges, styled by type.
 */
export function graphAt(novel: Book, sceneId: string | undefined, filter: GraphFilter = {}): GraphView {
  const types = filter.types ?? ["character"];
  const present = presentInFiltered(novel, filter);
  const entities = novel.entities.filter((e) => types.includes(e.type) && (!present || present.has(e.id))).sort((a, b) => a.name.localeCompare(b.name));
  const shown = new Set(entities.map((e) => e.id));
  const typeLabel = new Map(novel.entityTypes.map((t) => [t.key, t.label]));
  const saved = novel.layouts[RELATIONSHIP_GRAPH]?.nodes ?? {};
  const positions = layout(entities.map((e) => e.id), saved);
  const nodes: GraphNode[] = entities.map((e) => ({ id: e.id, label: e.name, type: typeLabel.get(e.type) ?? e.type, ...positions.get(e.id)! }));

  const holding = sceneId ? relationshipsAt(novel, sceneId) : novel.relationships.filter((r) => !r.since);
  const rels = holding.filter((r) => shown.has(r.from) && shown.has(r.to) && r.from !== r.to && (!filter.relationshipTypes || filter.relationshipTypes.includes(r.type)));
  const name = (id: string) => novel.entities.find((e) => e.id === id)?.name ?? id;
  const edges = rels.map((r) => {
    const e = edgeOf(novel, r);
    return { ...e, ariaLabel: `${name(r.from)}, ${e.label}, ${name(r.to)}` };
  });
  const list = rels.map((r) => ({ id: r.id, text: `${name(r.from)}: ${describeRelationship(novel, r.from, r)}` })).sort((a, b) => a.text.localeCompare(b.text));
  return { nodes, edges, list };
}

function edgeOf(novel: Book, r: Relationship): GraphEdge {
  const type = novel.relationshipTypes.find((t) => t.key === r.type);
  const { slot, line } = relationshipStyle(novel, r.type);
  return {
    id: r.id,
    source: r.from,
    target: r.to,
    label: type?.label ?? r.type,
    tone: slot,
    line,
    directed: !type?.symmetric,
  };
}

/**
 * Saved positions as they are; the rest on a ring around them (or around the origin), far enough
 * apart not to overlap, in the order given, so the same novel always lays out the same way.
 */
export function layout(ids: string[], saved: Record<string, { x: number; y: number }>): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const placed = ids.filter((id) => saved[id]);
  for (const id of placed) out.set(id, saved[id]!);
  const rest = ids.filter((id) => !saved[id]);
  if (!rest.length) return out;
  const cx = placed.length ? placed.reduce((s, id) => s + saved[id]!.x, 0) / placed.length : 0;
  const cy = placed.length ? placed.reduce((s, id) => s + saved[id]!.y, 0) / placed.length : 0;
  const spread = placed.length ? Math.max(...placed.map((id) => Math.hypot(saved[id]!.x - cx, saved[id]!.y - cy))) : 0;
  // Nodes are ~160 px wide: the ring's circumference gives each about 220 px.
  const radius = Math.max(spread + 220, (rest.length * 220) / (2 * Math.PI), 200);
  rest.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / rest.length - Math.PI / 2;
    out.set(id, { x: Math.round(cx + radius * Math.cos(angle)), y: Math.round(cy + radius * Math.sin(angle)) });
  });
  return out;
}

/** How long an entry may go unmentioned (a plotline quiet, a character absent) before it counts as a gap: in scenes, or in words. */
export type GapThreshold = { scenes: number } | { words: number };

export const DEFAULT_GAP: GapThreshold = { scenes: 3 };

export interface Gap {
  lane: string;
  /** The first and last scene of the quiet stretch. */
  from: string;
  to: string;
  scenes: number;
  words: number;
  /** It runs to the end of the book: the thread is never picked up again. */
  open: boolean;
}

/**
 * Where each plotline goes quiet for longer than the threshold: the stretches between two of its
 * beats, and after its last beat to the end of the book. (Before its first beat it hasn't started.)
 */
export function gaps(s: { lanes: { id: string }[]; scenes: Piece[]; marks: Map<string, unknown>; words: number[] }, threshold: GapThreshold): Gap[] {
  const { words } = s;
  const out: Gap[] = [];
  for (const lane of s.lanes) {
    const beats = s.scenes.flatMap((scene, i) => (s.marks.has(gridKey(lane.id, scene.id)) ? [i] : []));
    if (!beats.length) continue;
    const stretches = beats.map((b, k) => [b + 1, (beats[k + 1] ?? s.scenes.length) - 1, beats[k + 1] === undefined] as const);
    for (const [first, last, open] of stretches) {
      if (last < first) continue;
      const n = last - first + 1;
      const w = words.slice(first, last + 1).reduce((a, b) => a + b, 0);
      const over = "scenes" in threshold ? n > threshold.scenes : w > threshold.words;
      if (over) out.push({ lane: lane.id, from: s.scenes[first]!.id, to: s.scenes[last]!.id, scenes: n, words: w, open });
    }
  }
  return out;
}

/** The scenes a zoom shows: those anywhere in a section (a part, a chapter), or (no zoom, or one that's gone) all. */
export function zoomed(novel: Book, scenes: Piece[], zoom: string | undefined): Piece[] {
  if (!zoom || !novel.sections.some((s) => s.id === zoom)) return scenes;
  const within = (id: string | undefined): boolean => {
    const section = sectionById(novel, id);
    return !!section && (section.id === zoom || within(section.parentId));
  };
  return scenes.filter((s) => within(s.sectionId));
}

// ——— Presence ———

/** The scene field each built-in entity type is listed in. */
export const LISTS: Record<string, "characters" | "locations" | "themes" | "plotlines"> = {
  character: "characters",
  location: "locations",
  theme: "themes",
  plotline: "plotlines",
};

/** The scene field an entity type is listed in: its own for the built-in four, `entities` for custom types. */
export function sceneList(type: string): "characters" | "locations" | "themes" | "plotlines" | "entities" {
  return LISTS[type] ?? "entities";
}

export interface Presence {
  /** In the scene's metadata: any field of its that names the entry (a character's: its characters, or its point of view). */
  listed: boolean;
  /** It carries the scene: its point of view. */
  carries: boolean;
  /** Named in the prose (a mention). */
  mentioned: boolean;
  /** What its item carries, by its field's declared item properties: a scale's value (a theme's strength, 1–3), a choice's (a plotline's weight). */
  strength?: number;
  weight?: string;
  /** Whether that's the strongest: a choice's first value (a major beat), a scale's top (strength 3). */
  strongest?: boolean;
  /** Its item's first text property: a plotline's beat, a theme's note. */
  note?: string;
}

export interface PresenceMatrix {
  type: string;
  /** Entries of the type, by name; the view sorts them. */
  rows: Entity[];
  scenes: Piece[];
  /** By gridKey(entry, scene); absent: not there at all. */
  marks: Map<string, Presence>;
  /** Each scene's words, counted once. */
  words: number[];
  chapters: ReturnType<typeof sceneColumns>["chapters"];
  parts: ReturnType<typeof sceneColumns>["parts"];
}

/**
 * Where each entry of a type is in the book: listed in a scene's metadata (characters: point of
 * view or characters; locations, themes and plotlines: their lists), and named in its prose.
 */
export function presence(novel: Book, type: string, scenes: Piece[] = novel.pieces): PresenceMatrix {
  const rows = novel.entities.filter((e) => e.type === type).sort((a, b) => a.name.localeCompare(b.name));
  const ids = new Set(rows.map((r) => r.id));
  const marks = new Map<string, Presence>();
  for (const scene of scenes) {
    const named = new Set(mentions(scene.body).map((m) => m.id));
    const listed = new Map<string, Omit<Presence, "listed" | "carries" | "mentioned">>(entriesOf(novel, scene, type).map((id) => [id, {}]));
    const carrier = carrierOf(novel.kind, scene);
    for (const f of novel.kind.fields) {
      if (f.type.kind !== "entities" || f.type.entityType !== type || !f.type.item?.length) continue;
      for (const item of itemsOf(scene.fields[f.key])) {
        const [id] = entryIds(f, [item]);
        if (id) listed.set(id, carried(f.type.item, item));
      }
    }
    for (const id of new Set([...listed.keys(), ...named])) {
      if (!ids.has(id)) continue;
      marks.set(gridKey(id, scene.id), { ...listed.get(id), listed: listed.has(id), carries: carrier === id, mentioned: named.has(id) });
    }
  }
  return { type, rows, scenes, marks, words: scenes.map((s) => countWords(s.body)), ...sceneColumns(novel, scenes) };
}

/** What an item of a list field carries, for presence: its choice (weight), its scale (strength) and its first text (note). */
function carried(props: readonly ItemProp[], item: unknown): Omit<Presence, "listed" | "carries" | "mentioned"> {
  const o = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
  const out: Omit<Presence, "listed" | "carries" | "mentioned"> = {};
  for (const p of props) {
    const v = o[p.key];
    if (p.kind === "choice" && out.weight === undefined) {
      const weight = typeof v === "string" ? v : p.default;
      if (weight !== undefined) Object.assign(out, { weight, strongest: weight === p.values[0] });
    } else if (p.kind === "scale" && out.strength === undefined && typeof v === "number") Object.assign(out, { strength: v, strongest: v === p.max });
    else if (p.kind === "text" && out.note === undefined && typeof v === "string" && v) out.note = v;
  }
  return out;
}

/** How many scenes each entry is in (listed or mentioned). */
export function totals(m: PresenceMatrix): Map<string, number> {
  const out = new Map(m.rows.map((r) => [r.id, 0]));
  for (const key of m.marks.keys()) {
    const row = key.slice(0, key.indexOf("|"));
    out.set(row, (out.get(row) ?? 0) + 1);
  }
  return out;
}

export type RowOrder = "first" | "total" | "name";

/** Rows by first appearance (never-seen last), by how many scenes they're in (most first), or by name. */
export function sortRows(m: PresenceMatrix, order: RowOrder): Entity[] {
  const first = new Map<string, number>();
  m.scenes.forEach((scene, i) => {
    for (const r of m.rows) if (!first.has(r.id) && m.marks.has(gridKey(r.id, scene.id))) first.set(r.id, i);
  });
  const count = totals(m);
  const byName = (a: Entity, b: Entity) => a.name.localeCompare(b.name);
  if (order === "name") return [...m.rows].sort(byName);
  if (order === "total") return [...m.rows].sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0) || byName(a, b));
  return [...m.rows].sort((a, b) => (first.get(a.id) ?? Infinity) - (first.get(b.id) ?? Infinity) || byName(a, b));
}

// ——— Timeline ———

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

export const itemId = (i: TimelineItem) => (i.kind === "scene" ? i.scene.id : i.event.id);
export const itemTitle = (i: TimelineItem) => (i.kind === "scene" ? i.scene.title : i.event.title);

/**
 * The lanes an item runs in: its carrier (point of view), or the entries its lanes field names
 * (an event's list of the same key); none of them, the "none" lane. Events have no carrier: "off page".
 */
export function lanesOf(book: Book, i: TimelineItem, mode: LaneMode): string[] {
  if (mode === "carrier") return i.kind === "scene" ? [carrierOf(book.kind, i.scene) ?? NONE] : [OFF_PAGE];
  const f = laneFields(book.kind).find((x) => "entityType" in x.type && x.type.entityType === mode);
  const listed = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const ids = !f ? [] : i.kind === "scene" ? entryIds(f, i.scene.fields[f.key]) : listed((i.event as unknown as Record<string, unknown>)[f.key]);
  return ids.length ? ids : [NONE];
}

export const NONE = "(none)";
export const OFF_PAGE = "(off page)";

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
  const w = i.kind === "scene" ? i.scene.when : i.event.when;
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
  undatedEvents: ReturnType<typeof storyTimeline>["undatedEvents"];
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
  const special = [NONE, OFF_PAGE];
  const ordered = [...seen.filter((l) => !special.includes(l)), ...special.filter((l) => seen.includes(l))];
  const name = (id: string) => (id === NONE ? `No ${(mode === "carrier" ? carryingField(novel.kind)?.label : novel.entityTypes.find((t) => t.key === mode)?.label)?.toLowerCase() ?? "one"}` : id === OFF_PAGE ? "Off page" : (novel.entities.find((e) => e.id === id)?.name ?? id));
  return { items: t.items, storyRank, flashbacks, undated: t.undatedScenes, undatedEvents: t.undatedEvents, lanes: ordered.map((id) => ({ id, name: name(id) })) };
}
