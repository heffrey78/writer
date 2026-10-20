import type { Reference } from "@writer/client";
import { recordType, vocabulary, word, type Book } from "@writer/core";

/**
 * Something that refers to a record, as a refused delete lists it: "Scene “The Bridge” (point of
 * view)" (with `via`, how a piece refers to it), "Entry “Ada Varn”", "Event “The flood of '09”".
 */
export function referenceText(novel: Book, r: Reference, via?: (link: string) => string): string {
  const w = vocabulary(novel.kind);
  const title = "title" in r ? r.title : r.id;
  if (r.kind === "scene") {
    const links = "via" in r ? (r.via as string[]) : [];
    return via ? `${w.piece.One} “${title}” (${links.map(via).join(", ")})` : `${w.piece.One} “${title}”`;
  }
  if (r.kind === "entity") return `${w.entity.One} “${title}”`;
  if (r.kind === "note") return `Note “${title}”`;
  if (r.kind === "relationship" && "other" in r) return `Relationship: ${r.type} ${novel.entities.find((e) => e.id === r.other)?.name ?? r.other}`;
  const type = recordType(novel.kind, r.kind);
  return type ? `${word(type.noun).Short} “${title}”` : r.id;
}
