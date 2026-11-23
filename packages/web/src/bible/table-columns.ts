import { fieldLabel, fieldsAt, fieldsOfType, fieldText, vocabulary, type Book, type Entity, type EntryFieldDef, type EntryPresence, type FieldValue } from "@writer/core";

/*
 * The index's Table (#139, #168): one type's entries as rows, and as columns its name, the fields its
 * type declares (and, if asked for, those its entries have of their own), where it is in the book, its
 * tags and its relationships. What a cell says, how a column sorts and what Copy as a table gives are
 * worked out here, apart from drawing them.
 */

export type Column =
  | { key: "name"; kind: "name"; label: string }
  | { key: string; kind: "field"; label: string; field: EntryFieldDef; declared: boolean }
  | { key: "pieces" | "first" | "last"; kind: "pieces" | "first" | "last"; label: string }
  | { key: "tags"; kind: "tags"; label: string }
  | { key: string; kind: "relationship"; label: string; relationship: string };

/** What the table needs of the book besides the entry: where each entry is. */
export interface TableBook {
  book: Book;
  presences: ReadonlyMap<string, EntryPresence>;
}

const fieldKey = (key: string) => `field:${key}`;

/**
 * Every column the type's table can show, in their first order: the name, the declared fields, the
 * fields entries have of their own (with what they hold guessed from their values), the pieces, first
 * and last seen, tags and one per relationship type that can join the type.
 */
export function allColumns(book: Book, type: string): Column[] {
  const w = vocabulary(book.kind);
  const declared = fieldsOfType(book, type);
  const own = new Map<string, FieldValue[]>();
  for (const e of book.entities) {
    if (e.type !== type) continue;
    for (const [k, v] of Object.entries(e.fields)) if (!declared.some((f) => f.key === k)) own.set(k, [...(own.get(k) ?? []), v]);
  }
  const relationships = book.relationshipTypes.filter((r) => !r.from_types?.length || !r.to_types?.length || r.from_types.includes(type) || r.to_types.includes(type));
  return [
    { key: "name", kind: "name", label: "Name" },
    ...declared.map((f): Column => ({ key: fieldKey(f.key), kind: "field", label: fieldLabel(f), field: f, declared: true })),
    ...[...own].map(([key, values]): Column => ({ key: fieldKey(key), kind: "field", label: fieldLabel({ key }), field: { key, holds: guessHolds(values) }, declared: false })),
    { key: "pieces", kind: "pieces", label: w.piece.Many },
    { key: "first", kind: "first", label: "First seen" },
    { key: "last", kind: "last", label: "Last seen" },
    { key: "tags", kind: "tags", label: "Tags" },
    ...relationships.map((r): Column => ({ key: `rel:${r.key}`, kind: "relationship", label: r.label ?? r.key, relationship: r.key })),
  ];
}

/** What a field written by hand holds, from its values: numbers, yes or no, entries, or text. */
function guessHolds(values: FieldValue[]): EntryFieldDef["holds"] {
  if (values.every((v) => typeof v === "number")) return "number";
  if (values.every((v) => typeof v === "boolean")) return "yes-no";
  if (values.some(Array.isArray)) return "entries";
  return "text";
}

/** The columns shown by default: the name, the declared fields, the pieces, first seen and tags. */
export function defaultColumns(columns: Column[]): string[] {
  return columns.filter((c) => c.kind === "name" || (c.kind === "field" && c.declared) || c.kind === "pieces" || c.kind === "first" || c.kind === "tags").map((c) => c.key);
}

/**
 * The columns to show, in order: those kept for the type (the name always first, and any since gone
 * left out), or the default; a field declared since being kept is added before the pieces.
 */
export function shownColumns(columns: Column[], kept: { shown: string[]; known: string[] } | undefined): Column[] {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  if (!kept) return defaultColumns(columns).map((k) => byKey.get(k)!);
  const keys = kept.shown.filter((k) => byKey.has(k) && k !== "name");
  const added = columns.filter((c) => c.kind === "field" && c.declared && !kept.known.includes(c.key) && !keys.includes(c.key)).map((c) => c.key);
  const at = Math.max(0, keys.findIndex((k) => !k.startsWith("field:")));
  keys.splice(at === -1 ? keys.length : at, 0, ...added);
  return ["name", ...keys].map((k) => byKey.get(k)!);
}

/** An entry's value for a field column: its latest, over the whole book. */
export function fieldValue(book: Book, entity: Entity, field: EntryFieldDef): FieldValue | undefined {
  return fieldsAt(book, entity).fields[field.key];
}

/** The other ends of an entry's relationships of a type, by name. */
function related(book: Book, entity: Entity, type: string): string[] {
  const name = (id: string) => book.entities.find((e) => e.id === id)?.name ?? id;
  return book.relationships.filter((r) => r.type === type && (r.from === entity.id || r.to === entity.id)).map((r) => name(r.from === entity.id ? r.to : r.from));
}

/** A cell as the table shows it (and Copy as a table copies it); empty for a gap. */
export function cellText({ book, presences }: TableBook, entity: Entity, column: Column): string {
  const presence = presences.get(entity.id);
  switch (column.kind) {
    case "name":
      return entity.name;
    case "field": {
      const v = fieldValue(book, entity, column.field);
      return v === undefined ? "" : fieldText(book, v);
    }
    case "pieces":
      return presence?.count ? String(presence.count) : "";
    case "first":
      return presence?.first?.title ?? "";
    case "last":
      return presence?.last?.title ?? "";
    case "tags":
      return entity.tags.join(", ");
    case "relationship":
      return related(book, entity, column.relationship).join(", ");
  }
}

/** Whether a cell is a gap the footer counts: a declared field the entry hasn't filled. */
export function isGap(book: Book, entity: Entity, column: Column): boolean {
  return column.kind === "field" && column.declared && fieldValue(book, entity, column.field) === undefined;
}

export type Direction = "ascending" | "descending";

/**
 * The rows sorted by a column: numbers as numbers, choices in their options' order, yes before no,
 * entries by name, pieces by their place in the book. Empty cells go last either way; ties keep the
 * order they came in.
 */
export function sortRows(table: TableBook, rows: readonly Entity[], column: Column, direction: Direction): Entity[] {
  const { book, presences } = table;
  const position = new Map(book.pieces.map((p, i) => [p.id, i]));
  const key = (e: Entity): number | string | undefined => {
    switch (column.kind) {
      case "pieces":
        return presences.get(e.id)?.count || undefined;
      case "first":
      case "last": {
        const piece = presences.get(e.id)?.[column.kind];
        return piece ? position.get(piece.id) : undefined;
      }
      case "field": {
        const v = fieldValue(book, e, column.field);
        if (v === undefined || (Array.isArray(v) && !v.length)) return undefined;
        if (typeof v === "number") return v;
        if (typeof v === "boolean") return v ? 0 : 1;
        if (column.field.holds === "choice" && typeof v === "string") {
          const at = column.field.options?.indexOf(v) ?? -1;
          return at < 0 ? (column.field.options?.length ?? 0) : at;
        }
        return fieldText(book, v);
      }
      default:
        return cellText(table, e, column) || undefined;
    }
  };
  const keyed = rows.map((e, i) => ({ e, i, k: key(e) }));
  const sign = direction === "ascending" ? 1 : -1;
  keyed.sort((a, b) => {
    if (a.k === undefined || b.k === undefined) return a.k === b.k ? a.i - b.i : a.k === undefined ? 1 : -1;
    const by = typeof a.k === "number" && typeof b.k === "number" ? a.k - b.k : String(a.k).localeCompare(String(b.k), undefined, { numeric: true });
    return by * sign || a.i - b.i;
  });
  return keyed.map((x) => x.e);
}

/**
 * Rows as a spreadsheet pastes them: a header row, then a line per entry, cells between tabs. A tab or
 * line break inside a value becomes a space, so it stays in its cell.
 */
export function tableText(table: TableBook, rows: readonly Entity[], columns: readonly Column[]): string {
  const flat = (s: string) => s.replace(/[\t\r\n]+/g, " ").trim();
  const lines = [columns.map((c) => flat(c.label)), ...rows.map((e) => columns.map((c) => flat(cellText(table, e, c))))];
  return `${lines.map((l) => l.join("\t")).join("\n")}\n`;
}

/**
 * The change that gives an entry's field a new value (undefined takes it off), as the profile read over
 * the whole book makes it: a field that changes over the book gets its latest change's value; any
 * other, its value in `fields:`.
 */
export function fieldEdit(book: Pick<Book, "pieces">, entity: Entity, field: EntryFieldDef, value: FieldValue | undefined): { fields: Record<string, FieldValue> } | { changes: NonNullable<Entity["changes"]> } {
  const order = new Map(book.pieces.map((p, i) => [p.id, i]));
  const last = (entity.changes ?? []).filter((c) => c.field === field.key).sort((a, b) => (order.get(a.since) ?? Infinity) - (order.get(b.since) ?? Infinity)).at(-1);
  if (last) return { changes: entity.changes!.map((c) => (c === last ? { ...c, value: value ?? null } : c)) };
  const fields = { ...entity.fields };
  if (value === undefined) delete fields[field.key];
  else fields[field.key] = value;
  return { fields };
}
