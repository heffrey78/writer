import { carryingField, defineModule, plural, roleOf, vocabulary, word, type Book, type BookModule, type Entity, type EntityTypeDef, type FieldDef } from "@writer/core";
import { DEFAULT_GAP, gaps, gridKey, presence, type Presence, type PresenceMatrix } from "@writer/core/diagrams";
import { gridSvg, shadedOf, type Dot } from "@writer/core/snapshots";

/*
 * Presence (D14, #29): who and what is where. The entries of a type against every piece in reading
 * order, listed in a piece's fields (ringed where one carries it, larger where its item is stronger)
 * or only named in its prose, with long absences shaded. It works for each entry type the kind's
 * fields list, and for the book's own types where the kind has a field for them; the types of fields
 * marked `snapshot` are drawn into the book's diagrams. How an entry is in a piece is the base's
 * (`presence`), since an entry's strip on its profile reads it too.
 */

/** The entry types presence shows, in the book's order: those the kind's fields list, and the book's own where a field takes them. */
export function presenceTypes(book: Book): EntityTypeDef[] {
  const listed = new Set(book.kind.fields.flatMap((f) => ("entityType" in f.type ? [f.type.entityType] : [])));
  const own = book.kind.fields.some((f) => f.type.kind === "own-entities");
  const kinds = new Set(book.kind.entityTypes.map((t) => t.key));
  return book.entityTypes.filter((t) => listed.has(t.key) || (own && !kinds.has(t.key)));
}

/**
 * The field an entry of a type is listed in, where putting it in a piece adds it: the kind's list of
 * that type ("characters", not the point of view), or for one of the book's own types, the field for them.
 */
export function listFieldOf(book: Book, type: string): FieldDef | undefined {
  const fields = book.kind.fields;
  const list = fields.find((f) => f.type.kind === "entities" && f.type.entityType === type);
  if (list || book.kind.entityTypes.some((t) => t.key === type)) return list;
  return fields.find((f) => f.type.kind === "own-entities");
}

/** The kind's carrying field (the point of view), where its entries are of the type: presence rings them. */
export function carryingFieldOf(book: Book, type: string): FieldDef | undefined {
  const f = carryingField(book.kind);
  return f && "entityType" in f.type && f.type.entityType === type ? f : undefined;
}

/** Whether an entry of the type is drawn larger where its item is stronger: its list carries a scale (a theme's strength). */
export const scaled = (book: Book, type: string) => book.kind.fields.some((f) => f.type.kind === "entities" && f.type.entityType === type && f.type.item?.some((p) => p.kind === "scale"));

/** How many pieces each entry is in (listed or mentioned). */
export function totals(m: PresenceMatrix): Map<string, number> {
  const out = new Map(m.rows.map((r) => [r.id, 0]));
  for (const key of m.marks.keys()) {
    const row = key.slice(0, key.indexOf("|"));
    out.set(row, (out.get(row) ?? 0) + 1);
  }
  return out;
}

export type RowOrder = "first" | "total" | "name";

/** Rows by first appearance (never-seen last), by how many pieces they're in (most first), or by name. */
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

// ——— Its diagrams ———

/** A type's entries in a sentence: "characters", and an acronym as it is ("NPCs"). */
const many = (t: EntityTypeDef) => word({ label: t.label, plural: plural(t.label) }).many;

/** A presence diagram's title: "Characters by scene". */
export const presenceTitle = (book: Book, t: EntityTypeDef) => `${plural(t.label)} by ${vocabulary(book.kind).piece.one}`;

/** A presence diagram's file name, in the book's diagrams/ folder and as the app exports it: "presence-characters.svg". */
export const presenceFile = (t: EntityTypeDef) => `presence-${t.folder}.svg`;

const dotOf = (p: Presence): Dot =>
  !p.listed ? { r: 5, style: "dashed" } : p.strength !== undefined ? { r: 3 + p.strength * 1.6, style: "filled" } : { r: 6, style: "filled", ...(p.carries ? { ring: true } : {}) };

/** Presence of a type's entries across the pieces, by first appearance: filled where listed, ringed where one carries the piece, dashed where only mentioned. */
export function presenceSvg(book: Book, type: string): string {
  const t = book.entityTypes.find((x) => x.key === type) ?? { key: type, prefix: type, folder: type, label: type, builtin: false };
  const m = presence(book, type);
  const count = totals(m);
  const rows = sortRows(m, "first");
  return gridSvg(book, {
    title: presenceTitle(book, t),
    rows: rows.map((r) => ({ id: r.id, name: r.name, aside: String(count.get(r.id) ?? 0) })),
    scenes: m.scenes,
    dot: (row, scene) => {
      const p = m.marks.get(gridKey(row, scene));
      return p && dotOf(p);
    },
    shaded: shadedOf(gaps({ lanes: rows, scenes: m.scenes, marks: m.marks, words: m.words }, DEFAULT_GAP), m.scenes),
  });
}

/** The types the book's diagrams show presence of: those of the kind's fields marked `snapshot`, in the book's order. */
export function snapshotTypes(book: Book): EntityTypeDef[] {
  const marked = new Set(book.kind.fields.flatMap((f) => (f.snapshot && "entityType" in f.type ? [f.type.entityType] : [])));
  return book.entityTypes.filter((t) => marked.has(t.key));
}

/** "a", "a or b", "a, b or c". */
const either = (list: string[]) => (list.length < 2 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} or ${list.at(-1)}`);

export const presenceModule: BookModule = defineModule({
  id: "presence",
  label: "Presence",
  snapshots: (book) => {
    const types = snapshotTypes(book);
    if (!types.length) return { files: [], readme: [] };
    const w = vocabulary(book.kind);
    const drawn = book.pieces.length ? types.filter((t) => book.entities.some((e) => e.type === t.key)) : [];
    const carrier = types.map((t) => carryingFieldOf(book, t.key)).find(Boolean);
    const how = [...(carrier ? [`ringed: its ${roleOf(carrier)}`] : []), ...types.filter((t) => scaled(book, t.key)).map((t) => `for ${many(t)}, larger for a stronger one`)];
    return {
      files: drawn.map((t) => [`diagrams/${presenceFile(t)}`, presenceSvg(book, t.key)] as const),
      readme: [
        "## Presence",
        "",
        ...(drawn.length
          ? [
              // DEFAULT_GAP, in words.
              `Filled where the ${w.piece.one} lists them${how.length ? ` (${how.join("; ")})` : ""}, dashed where the prose only mentions them. The number by each name is how many ${w.piece.many} it's in; shaded, an absence of more than three ${w.piece.many}.`,
              "",
              ...drawn.flatMap((t) => [`![${presenceTitle(book, t)}](${presenceFile(t)})`, ""]),
            ]
          : [`Nothing to show yet: it needs ${either(types.map(many))}, and ${w.piece.many}.`]),
        "",
      ],
    };
  },
});
