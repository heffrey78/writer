import { countWords, defineModule, entriesOf, itemsOf, tally, vocabulary, type Book, type BookModule, type Entity, type EntityTypeDef, type FieldDef, type Piece, type Section, type Tally } from "@writer/core";
import { DEFAULT_GAP, gaps, gridKey, sceneColumns, type Gap, type GapThreshold } from "@writer/core/diagrams";
import { gridSvg, shadedOf } from "@writer/core/snapshots";

/*
 * Plotlines (D14, #28): the threads of a story. A plotline is an entry of its own type; a piece
 * lists the plotlines it advances, each with its weight (a major or a minor beat) and what happens
 * in it (the beat). The swimlanes set them against the pieces, showing where one goes quiet; a
 * plotline's profile lists its beats. The rest of the app reads the plotlines field as any field:
 * the timeline runs lanes by it, the graph and a piece's facts follow it as a thread.
 */

export const PLOTLINE: EntityTypeDef = { key: "plotline", prefix: "plot", folder: "plotlines", label: "Plotline", color: "d62728", builtin: true };

export const PLOTLINES: FieldDef = {
  key: "plotlines",
  label: "Plotlines",
  role: "plotline",
  type: {
    kind: "entities",
    entityType: "plotline",
    item: [
      { key: "weight", label: "Weight", kind: "choice", values: ["major", "minor"], default: "major" },
      { key: "beat", label: "Beat", kind: "text" },
    ],
  },
  outline: { column: true, filter: true },
  lanes: true,
  threads: true,
  marks: { carries: "a major beat", present: "a minor beat" },
};

/** A piece's link to a plotline: how much it advances it, and what happens. */
export interface PlotlineRef {
  id: string;
  weight: "major" | "minor";
  beat?: string;
}

/** The plotlines a piece advances, in its order, a plain ID read as a major beat. */
export function plotlinesOf(piece: Piece): PlotlineRef[] {
  return itemsOf(piece.fields[PLOTLINES.key]).flatMap((item): PlotlineRef[] => {
    const o = item && typeof item === "object" ? (item as Record<string, unknown>) : undefined;
    const id = typeof item === "string" ? item : typeof o?.["id"] === "string" ? o["id"] : undefined;
    if (!id) return [];
    const beat = typeof o?.["beat"] === "string" && o["beat"] ? o["beat"] : undefined;
    return [{ id, weight: o?.["weight"] === "minor" ? "minor" : "major", ...(beat ? { beat } : {}) }];
  });
}

// ——— Swimlanes ———

export interface Mark {
  weight: "major" | "minor";
  beat?: string;
}

export interface Swimlanes {
  /** Plotlines, by name: an order that edits never shuffle. */
  lanes: Entity[];
  /** Scenes in reading order. */
  scenes: Piece[];
  /** Column groups over the scenes: chapters, and (when the book has them) parts. */
  chapters: { chapter: Section; title: string; span: number }[];
  parts: { part: Section; span: number }[];
  /** How a scene advances a plotline, by `${plotline}|${scene}`; absent: it doesn't. */
  marks: Map<string, Mark>;
  /** Each scene's words, counted once (gaps in words read them on every threshold). */
  words: number[];
}

export const cellKey = gridKey;

/** The book as plotline lanes against scene columns, from the scenes' plotlines. */
export function swimlanes(book: Book, scenes: Piece[] = book.pieces): Swimlanes {
  const marks = new Map<string, Mark>();
  for (const scene of scenes) for (const p of plotlinesOf(scene)) marks.set(cellKey(p.id, scene.id), { weight: p.weight, ...(p.beat ? { beat: p.beat } : {}) });
  const lanes = book.entities.filter((e) => e.type === PLOTLINE.key).sort((a, b) => a.name.localeCompare(b.name));
  const { chapters, parts } = sceneColumns(book, scenes);
  return { lanes, scenes, chapters, parts, marks, words: scenes.map((scene) => countWords(scene.body)) };
}

/** How long a plotline may go unmentioned in this book before it counts as a gap: its own setting, or the default. */
export const plotlineGap = (book: Book): GapThreshold => book.config?.plotline_gap ?? DEFAULT_GAP;

// ——— A plotline's profile ———

export interface PlotlineProfile {
  /** Its beats in reading order; `beat` is missing where the scene says nothing of what happens. */
  beats: { scene: Piece; index: number; weight: "major" | "minor"; beat?: string }[];
  /** Scenes between its first and last beat that it isn't in. */
  skips: Piece[];
  /** Who's in its scenes, and where they're set, by how often. */
  who: Tally[];
  where: Tally[];
  /** Where it goes quiet for longer than the Story map's threshold. */
  quiet: Gap[];
}

export function plotlineProfile(book: Book, id: string): PlotlineProfile {
  const scenes = book.pieces;
  const beats = scenes.flatMap((scene) => plotlinesOf(scene).flatMap((p, index) => (p.id === id ? [{ scene, index, weight: p.weight, ...(p.beat ? { beat: p.beat } : {}) }] : [])));
  const first = scenes.indexOf(beats[0]?.scene as Piece);
  const last = scenes.indexOf(beats.at(-1)?.scene as Piece);
  const skips = first < 0 ? [] : scenes.slice(first, last + 1).filter((s) => !plotlinesOf(s).some((p) => p.id === id));
  const lanes = swimlanes(book);
  return {
    beats,
    skips,
    who: tally(book, beats.map((b) => entriesOf(book, b.scene, "character"))),
    where: tally(book, beats.map((b) => entriesOf(book, b.scene, "location"))),
    quiet: gaps({ ...lanes, lanes: lanes.lanes.filter((l) => l.id === id) }, DEFAULT_GAP),
  };
}

// ——— Its diagram ———

/** The plotline swimlanes: a large dot for a major beat, a small one for a minor; shaded, a plotline gone quiet past the book's threshold. */
export function plotlinesSvg(book: Book): string {
  const s = swimlanes(book);
  return gridSvg(book, {
    title: `Plotlines by ${vocabulary(book.kind).piece.one}`,
    rows: s.lanes.map((l) => ({ id: l.id, name: l.name })),
    scenes: s.scenes,
    dot: (row, scene) => {
      const m = s.marks.get(gridKey(row, scene));
      return m && (m.weight === "major" ? { r: 7, style: "filled" } : { r: 5, style: "hollow" });
    },
    shaded: shadedOf(gaps(s, plotlineGap(book)), s.scenes),
  });
}

const SVG = "diagrams/plotlines.svg";

export const plotlines: BookModule = defineModule({
  id: "plotlines",
  label: "Plotlines",
  entityTypes: [PLOTLINE],
  fields: [PLOTLINES],
  snapshots: (book) => {
    const w = vocabulary(book.kind);
    const shown = book.entities.some((e) => e.type === PLOTLINE.key) && book.pieces.length > 0;
    return {
      files: shown ? [[SVG, plotlinesSvg(book)]] : [],
      readme: [
        "## Plotlines",
        "",
        ...(shown
          ? [`Each column is ${w.piece.a}, in reading order: a large dot is a major beat, a small one a minor beat. Shaded: a plotline gone quiet for longer than the ${w.book.one}'s threshold.`, "", `![Plotlines by ${w.piece.one}](plotlines.svg)`]
          : ["No plotlines yet."]),
        "",
      ],
    };
  },
});
