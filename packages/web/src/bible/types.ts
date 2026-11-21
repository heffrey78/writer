import { matchEntry, mentionTargets, type Entity, type Book } from "@writer/core";
import type { MentionEntity } from "@writer/editor";

/** A type's name for a list of its entries: "Characters". */
export { plural } from "@writer/core";

export const typeOf = (novel: Book, entity: Entity) => novel.entityTypes.find((t) => t.key === entity.type);

/** Entries of each type, sorted by name. */
export function entriesByType(novel: Book): { type: Book["entityTypes"][number]; entries: Entity[] }[] {
  return novel.entityTypes.map((type) => ({
    type,
    entries: novel.entities.filter((e) => e.type === type.key).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

/** Whether an entry matches a search: by anything it says (its name, other names, summary, fields, tags or notes; #134). */
export const matches = (entity: Entity, query: string) => matchEntry(entity, query) !== undefined;

/**
 * Every entry, for @ suggestions: by type in the bible's order, then by name; then the modules'
 * records prose may mention, by their type's group ("Off the page": off-page events, heffrey78/gh-writer#165).
 * Core's, so the editor's underlines and an entry's passages (#135) name the same things.
 */
export const mentionEntities = (novel: Book): MentionEntity[] => mentionTargets(novel);

/** "AV" for Ada Varn: a stand-in for a portrait. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => [...w.replace(/^\P{L}+/u, "")][0]!.toUpperCase())
    .join("");
}

/** What a card says of an entry at a glance: its first two fields' values, or its other names. */
export function cardFacts(entity: Entity): string[] {
  return [
    ...Object.entries(entity.fields)
      .slice(0, 2)
      .flatMap(([, v]) => (typeof v === "boolean" || v === "" ? [] : [String(v)])),
    ...(entity.aliases.length ? [`also ${entity.aliases.join(", ")}`] : []),
  ].slice(0, 2);
}
