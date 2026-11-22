import { isId, type EntryFieldDef, type FieldHolds } from "./ids.ts";
import type { Book, Entity, FieldChange, FieldValue } from "./model.ts";

/*
 * An entry's fields as its type declares them (D18, #138): what each holds, the entries a value names,
 * and how a value reads. Fields an entry has that its type doesn't declare are read as before: a
 * string, a number or yes/no (or, in a format 3 book, a list of IDs).
 */

export type { FieldValue };

/** What a field may hold, in the order a type's Fields dialog offers them. */
export const HOLDS: readonly FieldHolds[] = ["text", "long-text", "number", "yes-no", "choice", "entry", "entries", "time"];

/** A field's label: its own, else its key in words ("kind_of_place" → "Kind of place"). */
export function fieldLabel(f: Pick<EntryFieldDef, "key" | "label">): string {
  if (f.label) return f.label;
  const words = f.key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The fields a type declares, in order: the book's, else its kind's; none for a type that has none. */
export function fieldsOfType(book: Pick<Book, "entityTypes">, type: string): readonly EntryFieldDef[] {
  return book.entityTypes.find((t) => t.key === type)?.fields ?? [];
}

/** The entries a value names, as a field holding entries reads it: one ID, or a list of them. */
export function idsIn(value: FieldValue | undefined): string[] {
  if (typeof value === "string") return isId(value) ? [value] : [];
  return Array.isArray(value) ? value.filter(isId) : [];
}

/**
 * The entries an entry's declared fields name, field by field: its faction, its home, a source's author;
 * at the start or from a piece on (its changes).
 */
export function entriesNamedBy(book: Pick<Book, "entityTypes">, entry: Entity): { field: EntryFieldDef; ids: string[] }[] {
  return fieldsOfType(book, entry.type).flatMap((f) => {
    if (f.holds !== "entry" && f.holds !== "entries") return [];
    const values = [entry.fields[f.key], ...(entry.changes ?? []).filter((c) => c.field === f.key).map((c) => c.value ?? undefined)];
    const ids = [...new Set(values.flatMap(idsIn))];
    return ids.length ? [{ field: f, ids }] : [];
  });
}

/** The entries whose declared fields name `id`, with which field: who lives at a place, whose faction it is. */
export function entriesNaming(book: Pick<Book, "entityTypes" | "entities">, id: string): { entry: Entity; field: EntryFieldDef }[] {
  return book.entities.flatMap((entry) => entriesNamedBy(book, entry).flatMap(({ field, ids }) => (ids.includes(id) ? [{ entry, field }] : [])));
}

/** How a value reads: an entry's ID as its name, a list as names joined, yes/no as Yes or No. */
export function fieldText(book: Pick<Book, "entities">, value: FieldValue, join = ", "): string {
  const name = (v: string) => (isId(v) ? (book.entities.find((e) => e.id === v)?.name ?? v) : v);
  if (Array.isArray(value)) return value.map(name).join(join);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return typeof value === "string" ? name(value) : String(value);
}

/**
 * What a card says of an entry's fields at a glance, as text: the values of those its type shows on
 * cards, else of its first two; none that's empty or yes/no.
 */
export function cardFields(book: Pick<Book, "entities" | "entityTypes">, entity: Entity): string[] {
  const onCards = fieldsOfType(book, entity.type).filter((f) => f.card);
  const values = onCards.length ? onCards.flatMap((f) => (entity.fields[f.key] === undefined ? [] : [entity.fields[f.key]!])) : Object.values(entity.fields).slice(0, 2);
  return values.flatMap((v) => (typeof v === "boolean" || v === "" || (Array.isArray(v) && !v.length) ? [] : [fieldText(book, v)])).slice(0, 2);
}

/** Whether a value is what its field holds; a choice's, one of its options. (Whether a named entry exists is a reference's check.) */
export function holdsValue(f: EntryFieldDef, value: FieldValue): boolean {
  switch (f.holds) {
    case "number":
      return typeof value === "number";
    case "yes-no":
      return typeof value === "boolean";
    case "choice":
      return typeof value === "string" && (f.options ?? []).includes(value);
    case "entry":
      return typeof value === "string" && isId(value);
    case "entries":
      return Array.isArray(value) && value.every(isId);
    default:
      return typeof value === "string";
  }
}

/** What a field holds, in words, for a message: "a number", "one of alive, dead, missing or unknown", "a faction". */
export function holdsText(f: EntryFieldDef, typeLabel: (key: string) => string | undefined): string {
  const of = f.type ? typeLabel(f.type)?.toLowerCase() : undefined;
  switch (f.holds) {
    case "number":
      return "a number";
    case "yes-no":
      return "yes or no (true or false)";
    case "choice": {
      const o = f.options ?? [];
      return o.length > 1 ? `one of ${o.slice(0, -1).join(", ")} or ${o.at(-1)}` : `“${o[0] ?? ""}”`;
    }
    case "entry":
      return of ? `the ID of ${/^[aeiou]/.test(of) ? "an" : "a"} ${of}` : "an entry's ID";
    case "entries":
      return of ? `a list of IDs of ${of} entries` : "a list of entries' IDs";
    case "time":
      return "a time, as text";
    default:
      return "text";
  }
}

/**
 * The fields at least two of a type's entries share and `except` doesn't list, in the order they're
 * first met, each with what its values seem to hold (#164): where a type's declarations can start from.
 * Keys a declaration can't have ("Eye colour") are left out.
 */
export function sharedFields(book: Pick<Book, "entities" | "entityTypes">, type: string, except: readonly string[] = []): EntryFieldDef[] {
  const values = new Map<string, FieldValue[]>();
  for (const e of book.entities) {
    if (e.type !== type) continue;
    for (const [k, v] of Object.entries(e.fields)) values.set(k, [...(values.get(k) ?? []), v]);
  }
  const typeOf = (id: string) => book.entities.find((e) => e.id === id)?.type;
  /** The one type every ID is of, if they're all of one. */
  const oneType = (ids: string[]) => {
    const types = new Set(ids.map(typeOf));
    const [only] = types;
    return types.size === 1 && only ? { type: only } : {};
  };
  return [...values]
    .filter(([k, vs]) => vs.length >= 2 && !except.includes(k) && /^[a-z][a-z0-9_]*$/.test(k))
    .map(([key, vs]): EntryFieldDef => {
      if (vs.every((v) => typeof v === "number")) return { key, holds: "number" };
      if (vs.every((v) => typeof v === "boolean")) return { key, holds: "yes-no" };
      if (vs.every((v) => Array.isArray(v))) return { key, holds: "entries", ...oneType(vs.flat() as string[]) };
      if (vs.every((v) => typeof v === "string" && isId(v))) return { key, holds: "entry", ...oneType(vs as string[]) };
      if (vs.some((v) => typeof v === "string" && (v.includes("\n") || v.length > 80))) return { key, holds: "long-text" };
      return { key, holds: "text" };
    });
}

/** An entry's fields at a piece (#140): each with the piece its value holds from, none for the start's. */
export interface FieldsAt {
  fields: Record<string, FieldValue>;
  /** For each field a change set (or took off), the piece it holds from. */
  from: Record<string, string>;
}

/**
 * An entry's fields as they read at piece `at`: its `fields:` (the start's), then each change whose
 * piece is at or before `at` in reading order, in that order (D18, #140). Without `at`, as they read at
 * the end of the book: every change. A change naming a piece not in the reading order is skipped.
 */
export function fieldsAt(book: Pick<Book, "pieces">, entry: Entity, at?: string): FieldsAt {
  const fields = { ...entry.fields };
  const from: Record<string, string> = {};
  if (!entry.changes?.length) return { fields, from };
  const order = new Map(book.pieces.map((p, i) => [p.id, i]));
  const limit = at === undefined ? Infinity : (order.get(at) ?? -1);
  const applied = entry.changes
    .map((c, i) => ({ c, i, at: order.get(c.since) }))
    .filter((x): x is { c: FieldChange; i: number; at: number } => x.at !== undefined && x.at <= limit)
    // In reading order; two at one piece, as the file lists them.
    .sort((a, b) => a.at - b.at || a.i - b.i);
  for (const { c } of applied) {
    if (c.value === null) delete fields[c.field];
    else fields[c.field] = c.value;
    from[c.field] = c.since;
  }
  return { fields, from };
}

