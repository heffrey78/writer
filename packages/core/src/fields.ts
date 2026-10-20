import type { BookKind, FieldDef } from "./kinds.ts";
import type { Book, ModuleRecord, Piece } from "./model.ts";
import { recordType } from "./modules.ts";
import type { StoryTime } from "./types.ts";

/*
 * Reading a piece's declared fields (#25), the same way wherever they're shown: on the piece's card,
 * in comparisons, in the outline.
 */

/** What a field's entries are called where they're listed: its group ("Locations"), else its label. */
export const fieldName = (f: FieldDef) => f.group ?? f.label;

/** The entry IDs a field's value holds: one entry's, or a list's (plain IDs or `{ id, … }`). */
export function entryIds(f: FieldDef, value: unknown): string[] {
  if (f.type.kind === "entity") return typeof value === "string" && value ? [value] : [];
  if (f.type.kind === "story-time" || !Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    const id = typeof item === "string" ? item : item && typeof item === "object" ? (item as { id?: unknown }).id : undefined;
    return typeof id === "string" ? [id] : [];
  });
}

/** What an item of a list field carries, as it reads after its name: " (major) “First crack”", " (faint)". */
export function itemText(f: FieldDef, item: unknown): string {
  if (f.type.kind !== "entities") return "";
  // A plain ID carries nothing, but defaults still read (a plotline is major).
  const fields = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
  return (f.type.item ?? [])
    .filter((p) => p.onCard !== false)
    .map((p) => {
      const v = fields[p.key];
      if (p.kind === "choice") {
        const value = typeof v === "string" ? v : p.default;
        return value ? ` (${value})` : "";
      }
      if (p.kind === "scale") return v === undefined ? "" : ` (${p.labels[String(v)] ?? String(v)})`;
      return typeof v === "string" && v ? ` “${v}”` : "";
    })
    .join("");
}

/** How an entry in a field is in the piece: its role ("point of view", "set here"), else its label. */
export const roleOf = (f: FieldDef) => f.role ?? f.label.toLowerCase();

/** The kind's field whose entry carries a piece (its point of view), if it has one. */
export const carryingField = (kind: BookKind): FieldDef | undefined => kind.fields.find((f) => f.carries && f.type.kind === "entity");

/** The entry that carries a piece: its point of view. None for a kind without one, or a piece without it. */
export function carrierOf(kind: BookKind, piece: Piece): string | undefined {
  const f = carryingField(kind);
  return f ? entryIds(f, piece.fields[f.key])[0] : undefined;
}

/**
 * The entries a piece's fields name, in the kind's field order, each once: of one entry type
 * (`type`: its fields of that type, and those of the book's own types its own-types field names),
 * or of any.
 */
export function entriesOf(book: Book, piece: Piece, type?: string): string[] {
  return entriesIn(book, book.kind.fields, piece.fields, type);
}

/** The entries a module's record names in its type's fields (an off-page event's people and places), as entriesOf reads a piece's. */
export function recordEntries(book: Book, record: ModuleRecord, type?: string): string[] {
  return entriesIn(book, recordType(book.kind, record.type)?.fields(book.kind) ?? [], record.fields, type);
}

function entriesIn(book: Book, fields: readonly FieldDef[], values: Record<string, unknown>, type: string | undefined): string[] {
  const out = new Set<string>();
  const typeOf = (id: string) => book.entities.find((e) => e.id === id)?.type ?? book.entityTypes.find((t) => id.startsWith(`${t.prefix}_`))?.key;
  for (const f of fields) {
    const t = f.type;
    if (type !== undefined && "entityType" in t && t.entityType !== type) continue;
    for (const id of entryIds(f, values[f.key])) if (type === undefined || "entityType" in t || typeOf(id) === type) out.add(id);
  }
  return [...out];
}

/** The items of a list field's value: each a plain ID or `{ id, … }`. */
export const itemsOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** A story-time value as written: `{ at }` (a date) or `{ day, time? }` (a day of the story); undefined for anything else. */
export function storyTimeValue(v: unknown): StoryTime | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o["at"] === "string") return { at: o["at"] };
  if (typeof o["day"] === "number") return typeof o["time"] === "string" ? { day: o["day"], time: o["time"] } : { day: o["day"] };
  return undefined;
}

/** The kind's story-time field (when a piece happens), if it has one. */
export const storyTimeField = (kind: BookKind): (FieldDef & { type: { kind: "story-time"; durationKey: string } }) | undefined =>
  kind.fields.find((f): f is FieldDef & { type: { kind: "story-time"; durationKey: string } } => f.type.kind === "story-time");
