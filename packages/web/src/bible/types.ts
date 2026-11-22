import { cardFields, matchEntry, mentionTargets, type Entity, type Book } from "@writer/core";
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
export const matches = (entity: Entity, query: string, book?: Pick<Book, "entities">) => matchEntry(entity, query, { book }) !== undefined;

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

/**
 * What a card says of an entry at a glance: the values of the fields its type shows on cards (D18), else
 * its first two fields', or its other names. An entry it names reads as that entry's name.
 */
export function cardFacts(entity: Entity, book: Pick<Book, "entities" | "entityTypes" | "pieces">, at?: string): string[] {
  return [
    ...cardFields(book, entity, at),
    ...(entity.aliases.length ? [`also ${entity.aliases.join(", ")}`] : []),
  ].slice(0, 2);
}
