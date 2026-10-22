import { BASE_SIDEBAR, type BookKind, type SidebarGroup } from "./kinds.ts";

/** The base's pages, by the keys a kind's sidebar and a writer's arrangement name them with (#61). */
export const BASE_PAGES = ["outline", "story-map", "relationships", "notes", "progress", "index", "compare", "issues"] as const;

/**
 * A writer's arrangement of the sidebar, in book.yaml's `sidebar` (#63): each group's pages in order,
 * by the kind's group keys, and the pages hidden. Pages it names nowhere are where the kind puts them.
 */
export interface SidebarFile {
  groups?: Record<string, string[]>;
  hidden?: string[];
}

/** A list of keys as book.yaml has it: a book opens with schema errors in it, so anything else is none. */
const keys = (v: unknown): string[] => (Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : []);

/** The kind's sidebar, or the base's for a kind without one. */
export const sidebarOf = (kind: BookKind): readonly SidebarGroup[] => kind.sidebar ?? BASE_SIDEBAR;

/** Every page a book of `kind` can have in its sidebar, by key: the base's, and those its kind names. */
export const sidebarPages = (kind: BookKind): string[] => [...new Set([...sidebarOf(kind).flatMap((g) => g.pages), ...BASE_PAGES])];

/**
 * The sidebar of a book of `kind` with the writer's arrangement over it: in each group, the pages the
 * writer put there in their order (a page named twice in the first of the kind's groups), then the kind's others not
 * named elsewhere; hidden pages left out. `hidden` is every page not shown: the writer's, and those the
 * kind leaves out. Group keys the kind doesn't have are ignored (the validator warns of them).
 */
export function arrangeSidebar(kind: BookKind, mine?: SidebarFile): { groups: SidebarGroup[]; hidden: string[] } {
  const layout = sidebarOf(kind);
  const hidden = new Set(keys(mine?.hidden));
  const placed = new Set<string>();
  const own = layout.map((g) => keys(mine?.groups?.[g.key]).filter((p) => !hidden.has(p) && !placed.has(p) && Boolean(placed.add(p))));
  const groups = layout.map((g, i) => ({ ...g, pages: [...own[i]!, ...g.pages.filter((p) => !placed.has(p) && !hidden.has(p))] }));
  const shown = new Set(groups.flatMap((g) => g.pages));
  return { groups, hidden: [...new Set([...sidebarPages(kind), ...hidden])].filter((p) => !shown.has(p)) };
}
