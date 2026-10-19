import { entryIds, type Book, type Piece } from "@writer/core";

/** The cards' filters by their address's parameters: an entry's ID for each of filtersOf's, and `status`. */
export type CorkboardFilter = Record<string, string>;

/**
 * A filter of the cards, from a field the kind marks `outline.filter` (#25): one entry's field filters
 * by itself (param its key: "pov"); a list by its entry type, matching that type in any field
 * (param the type: "character", in the list or the point of view).
 */
export interface FilterDef {
  param: string;
  label: string;
  entityType: string;
  /** The one field it matches; without it, any field of its entry type. */
  field?: string;
}

export function filtersOf(novel: Book): FilterDef[] {
  return novel.kind.fields.flatMap((f): FilterDef[] => {
    if (!f.outline?.filter) return [];
    if (f.type.kind === "entity") return [{ param: f.key, label: f.label, entityType: f.type.entityType, field: f.key }];
    if (f.type.kind !== "entities") return [];
    const type = f.type.entityType;
    return [{ param: type, label: novel.entityTypes.find((t) => t.key === type)?.label ?? type, entityType: type }];
  });
}

/** The parameters the cards' filters read from the address. */
export const filterParams = (novel: Book) => [...filtersOf(novel).map((d) => d.param), "status"];

/** Whether a piece holds `id` in a filter's field, or in any field of its entry type. */
function holds(novel: Book, scene: Piece, d: FilterDef, id: string): boolean {
  return novel.kind.fields.some(
    (f) => (d.field ? f.key === d.field : (f.type.kind === "entity" || f.type.kind === "entities") && f.type.entityType === d.entityType) && entryIds(f, scene.fields[f.key]).includes(id),
  );
}

/** Whether a scene shows on a board with these filters (all must hold). */
export function shows(novel: Book, scene: Piece, f: CorkboardFilter): boolean {
  return (!f["status"] || scene.status === f["status"]) && filtersOf(novel).every((d) => !f[d.param] || holds(novel, scene, d, f[d.param]!));
}

/** The scenes a board shows, in reading order. */
export function visibleScenes(novel: Book, f: CorkboardFilter): Piece[] {
  return novel.pieces.filter((s) => shows(novel, s, f));
}

/**
 * A keyboard move on a (possibly filtered) board: one step past the neighbouring visible card,
 * landing immediately before it (left) or after it (right) in the whole book.
 */
export function visibleStep(visible: string[], id: string, direction: -1 | 1): { target: string; after: boolean } | undefined {
  const i = visible.indexOf(id);
  const target = visible[i + direction];
  return i < 0 || target === undefined ? undefined : { target, after: direction > 0 };
}

/** The whole book's order after moving `id` immediately before or after `target` (what the server does). */
export function placed(order: string[], id: string, target: string, after: boolean): string[] {
  const rest = order.filter((x) => x !== id);
  const at = rest.indexOf(target) + (after ? 1 : 0);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}
