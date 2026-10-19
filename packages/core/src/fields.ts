import type { FieldDef } from "./kinds.ts";

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

/** The items of a list field's value: each a plain ID or `{ id, … }`. */
export const itemsOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
