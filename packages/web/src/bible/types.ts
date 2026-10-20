import { recordTypesOf, type Entity, type Book } from "@writer/core";
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

/** Whether an entry matches a search, by name or alias. */
export const matches = (entity: Entity, query: string) => {
  const q = query.trim().toLowerCase();
  return !q || [entity.name, ...entity.aliases].some((n) => n.toLowerCase().includes(q));
};

/**
 * Every entry, for @ suggestions: by type in the bible's order, then by name; then the modules'
 * records prose may mention, by their type's group ("Off the page": off-page events, heffrey78/gh-writer#165).
 */
export function mentionEntities(novel: Book): MentionEntity[] {
  return [
    ...novel.entityTypes.flatMap((t) =>
      novel.entities
        .filter((e) => e.type === t.key)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => ({ id: e.id, name: e.name, aliases: e.aliases, type: t.label })),
    ),
    ...recordTypesOf(novel.kind)
      .filter((t) => t.mentionable)
      .flatMap((t) =>
        novel.moduleRecords
          .filter((r) => r.type === t.key)
          .sort((a, b) => a.title.localeCompare(b.title))
          .map((r) => ({ id: r.id, name: r.title, aliases: [], type: t.group })),
      ),
  ];
}
