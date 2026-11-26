import { isNoteColor, proseText, type Note, type NoteColor, type ShownPicture } from "@writer/core";
import { useSearchParams } from "react-router";

/*
 * What the Notes gallery shows (#226, #227): its words searched, a sort, a tag, a color and only those
 * with pictures. Kept in the address (q, sort, tag, color, pictures), so a filtered gallery can be
 * bookmarked and Back brings it back; the phone's sheet and the desktop's popover set the same.
 */

export const NOTE_SORTS = ["newest", "oldest", "title"] as const;
export type NoteSort = (typeof NOTE_SORTS)[number];

export interface NoteFilters {
  q: string;
  sort: NoteSort;
  tag?: string;
  color?: NoteColor;
  pictures: boolean;
}

/** What `params` asks for; anything it can't mean is left out. */
export function noteFiltersOf(params: URLSearchParams): NoteFilters {
  const sort = params.get("sort");
  const color = params.get("color");
  const tag = params.get("tag");
  return {
    q: params.get("q") ?? "",
    sort: NOTE_SORTS.find((s) => s === sort) ?? "newest",
    ...(tag ? { tag } : {}),
    ...(isNoteColor(color) ? { color } : {}),
    pictures: params.get("pictures") === "1",
  };
}

export type NoteFilterChanges = { [K in keyof NoteFilters]?: NoteFilters[K] | undefined };

/** `params` with `changes` made: what's the default (newest, no tag) leaves the address. */
export function withNoteFilters(params: URLSearchParams, changes: NoteFilterChanges): URLSearchParams {
  const next = new URLSearchParams(params);
  const put = (key: string, value: string | undefined) => (value ? next.set(key, value) : next.delete(key));
  if ("q" in changes) put("q", changes.q);
  if ("sort" in changes) put("sort", changes.sort === "newest" ? undefined : changes.sort);
  if ("tag" in changes) put("tag", changes.tag);
  if ("color" in changes) put("color", changes.color);
  if ("pictures" in changes) put("pictures", changes.pictures ? "1" : undefined);
  return next;
}

/** How many filters are on (a tag, a color, With pictures): the badge on Sort and filter, and on Filter. */
export const filtersOn = (f: NoteFilters) => (f.tag ? 1 : 0) + (f.color ? 1 : 0) + (f.pictures ? 1 : 0);

/** The notes `f` keeps, in its order. `picturesOf` gives each note's pictures, worked out once. */
export function filterNotes(notes: readonly Note[], f: NoteFilters, picturesOf: (n: Note) => readonly ShownPicture[]): Note[] {
  const q = f.q.trim().toLowerCase();
  const newest = (a: Note, b: Note) => (b.created ?? "").localeCompare(a.created ?? "") || a.title.localeCompare(b.title);
  return notes
    .filter((n) => (!f.tag || n.tags.includes(f.tag)) && (!f.color || n.color === f.color) && (!f.pictures || picturesOf(n).length > 0) && (!q || [n.title, proseText(n.body), ...n.tags].some((t) => t.toLowerCase().includes(q))))
    .sort(f.sort === "title" ? (a, b) => a.title.localeCompare(b.title) : f.sort === "oldest" ? (a, b) => -newest(a, b) : newest);
}

/** The gallery's choices from the address, and setting them there (replacing the entry: typing isn't history). */
export function useNoteFilters(): { filters: NoteFilters; set: (changes: NoteFilterChanges) => void; clear: () => void } {
  const [params, setParams] = useSearchParams();
  const set = (changes: NoteFilterChanges) => setParams(withNoteFilters(params, changes), { replace: true });
  return { filters: noteFiltersOf(params), set, clear: () => set({ tag: undefined, color: undefined, pictures: false }) };
}
