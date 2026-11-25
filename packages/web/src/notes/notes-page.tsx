import { NOTE_COLORS, shownPictures, type Book, type NoteColor } from "@writer/core";
import { ChevronDown, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { Dialog, Popover, RadioGroup, Switch } from "radix-ui";
import { useEffect, useId, useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import { create } from "zustand";
import { useCommands } from "../commands.ts";
import { useNarrow } from "../narrow.ts";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { PAGE } from "../ui/page.ts";
import { SheetHandle } from "../ui/sheet-handle.tsx";
import { useNewNote } from "./new-note.tsx";
import { MASONRY, NoteCard, useMasonry } from "./note-card.tsx";
import { ColorChoice, colorName, Swatch, useArrowsChoose } from "./note-colors.tsx";
import { filterNotes, filtersOn, useNoteFilters, type NoteFilterChanges, type NoteFilters, type NoteSort } from "./note-filters.ts";

/** Sort and filter, open: the phone's sheet, or the desktop's Filter popover. Opened from the palette too. */
const useFilterOpen = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

/** Any tag, as the tag choices' value: a tag can't be written with it. */
const ANY_TAG = "\u0000any";

const SORT_LABELS: Record<NoteSort, string> = { newest: "Newest", oldest: "Oldest", title: "Title" };

/** Typing somewhere: / is then the text's. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("[contenteditable=true], [role=listbox], [role=menu], select, textarea")) return true;
  return target instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit", "reset", "range"].includes(target.type);
}

/**
 * Every note at a glance (heffrey78/gh-writer#223, #221): cards of their own heights, filled with each
 * note's color (#225). On a phone, one search bar with Sort and filter in it, its choices in a sheet, and
 * New note at the bottom right (#226); on the desktop, one row of Notes, search, Filter, Sort and New note
 * (#227). What's on shows under it as chips. The choices are in the address. A note opens in a modal
 * over it (`over`, heffrey78/gh-writer#235).
 */
export function NotesPage({ novelId, novel, over }: { novelId: string; novel: Book; over?: ReactNode }) {
  const { filters, set, clear } = useNoteFilters();
  const narrow = useNarrow();
  const add = useNewNote((s) => s.set);
  const searchId = useId();
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useMasonry(list);
  const tags = useMemo(() => [...new Set(novel.notes.flatMap((n) => n.tags))].sort((a, b) => a.localeCompare(b)), [novel.notes]);
  const picturesOf = useMemo(() => new Map(novel.notes.map((n) => [n.id, shownPictures(n.body)])), [novel.notes]);
  const shown = filterNotes(novel.notes, filters, (n) => picturesOf.get(n.id) ?? []);
  const on = filtersOn(filters);
  const narrowed = on > 0 || filters.q.trim() !== "";
  const count = shown.length === 1 ? "1 note matches" : `${shown.length} notes match`;
  const openFilters = useFilterOpen((s) => s.set);

  useCommands(
    () => [
      { id: "notes.search", title: "Search the notes", group: "Notes", keys: "/", run: () => search.current?.focus() },
      { id: "notes.filter", title: "Sort and filter…", group: "Notes", keywords: ["color", "tag", "pictures", "sort"], run: () => openFilters(true) },
    ],
    [openFilters],
  );
  // / searches, from anywhere on the page but a text being written and a dialog (a note open over it).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "/" || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => () => useFilterOpen.getState().set(false), []);

  const searchField = (
    <>
      <label htmlFor={searchId} className="sr-only">
        Search the notes
      </label>
      <input
        ref={search}
        id={searchId}
        type="search"
        placeholder={narrow ? `Search ${novel.notes.length === 1 ? "1 note" : `${novel.notes.length} notes`}` : "Search titles, words and tags"}
        value={filters.q}
        onChange={(e) => set({ q: e.target.value || undefined })}
        className={cn("w-full bg-transparent text-ink placeholder:text-muted focus:outline-none", narrow ? "h-full text-base" : "h-full text-sm")}
      />
    </>
  );
  const choices = { filters, set, clear, tags, count: shown.length };

  return (
    <div className={cn(PAGE, "grid content-start gap-4", narrow && "px-3 pt-3 pb-28")}>
      {narrow ? (
        <>
          <h1 className="sr-only">Notes</h1>
          <div className="flex h-14 items-center gap-2 rounded-full border border-rule bg-raised pr-1 pl-4 focus-within:ring-2 focus-within:ring-accent">
            <Search className="size-5 shrink-0 text-muted" aria-hidden />
            {searchField}
            <FilterSheet {...choices} />
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">
            Notes <span className="text-base font-normal text-muted">{novel.notes.length}</span>
          </h1>
          <div className="flex h-10 min-w-60 flex-1 items-center gap-2 rounded-lg border border-rule bg-raised px-3 focus-within:ring-2 focus-within:ring-accent">
            <Search className="size-4 shrink-0 text-muted" aria-hidden />
            {searchField}
            <kbd aria-hidden className="rounded border border-rule px-1.5 text-xs text-muted">
              /
            </kbd>
          </div>
          <FilterPopover {...choices} />
          <SortSelect sort={filters.sort} onChange={(sort) => set({ sort })} />
          <Button variant="primary" className="h-10" onClick={() => add(true)}>
            <Plus className="size-4" aria-hidden /> New note
          </Button>
        </div>
      )}
      {narrowed && <OnChips filters={filters} set={set} clear={clear} count={count} />}
      {/* Always there, so the columns keep their measuring when a search that matched nothing is cleared. */}
      <div className="@container">
        <ul ref={list} aria-label="Notes" hidden={!shown.length} className={MASONRY}>
          {shown.map((n) => (
            <li key={n.id} className="grid content-start">
              <NoteCard novelId={novelId} novel={novel} note={n} pictures={picturesOf.get(n.id) ?? []} />
            </li>
          ))}
        </ul>
      </div>
      {!shown.length && <p className="text-sm text-muted">{novel.notes.length ? "No note matches." : "No notes yet: ideas, what-ifs and questions for later."}</p>}
      {narrow && (
        <Button variant="primary" className="fixed right-4 bottom-[calc(4.75rem+1rem)] z-10 h-14 rounded-2xl px-5 text-base shadow-lg" onClick={() => add(true)}>
          <Plus className="size-5" aria-hidden /> New note
        </Button>
      )}
      {over}
    </div>
  );
}

interface Choices {
  filters: NoteFilters;
  set: (changes: NoteFilterChanges) => void;
  clear: () => void;
  tags: string[];
  count: number;
}

/** What's on, each a chip that takes it off (Backspace too), then Clear and how many match. */
function OnChips({ filters, set, clear, count }: Pick<Choices, "filters" | "set" | "clear"> & { count: string }) {
  const chips: { key: string; label: string; swatch?: NoteColor; off: NoteFilterChanges }[] = [];
  if (filters.color) chips.push({ key: "color", label: colorName(filters.color), swatch: filters.color, off: { color: undefined } });
  if (filters.tag) chips.push({ key: "tag", label: filters.tag, off: { tag: undefined } });
  if (filters.pictures) chips.push({ key: "pictures", label: "With pictures", off: { pictures: false } });
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, off: NoteFilterChanges) => {
    if (e.key !== "Backspace" && e.key !== "Delete") return;
    e.preventDefault();
    const next = (e.currentTarget.nextElementSibling ?? e.currentTarget.previousElementSibling) as HTMLElement | null;
    set(off);
    next?.focus();
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.length > 0 && (
        <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => set(c.off)}
              onKeyDown={(e) => onKey(e, c.off)}
              aria-label={`Remove the filter: ${c.label}`}
              title="Remove the filter (Backspace)"
              className="flex h-8 items-center gap-1.5 rounded-full border border-rule bg-raised px-3 text-sm hover:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none max-md:h-12 max-md:px-4"
            >
              {c.swatch && <Swatch color={c.swatch} className="size-3.5" />}
              {c.label} <X className="size-3.5 text-muted" aria-hidden />
            </button>
          ))}
          <button type="button" onClick={clear} className="h-8 px-2 text-sm font-semibold text-accent hover:underline max-md:h-12">
            Clear
          </button>
        </div>
      )}
      <p role="status" className="px-1 text-sm text-muted">
        {count}
      </p>
    </div>
  );
}

const chip = (on: boolean) =>
  cn(
    "flex items-center gap-1.5 rounded-full border px-3.5 text-sm cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
    on ? "border-accent bg-accent-soft font-semibold text-accent" : "border-rule bg-raised text-ink hover:border-accent",
  );

/** One of a few, as chips in a radio group (the arrows move through it): Any …, then each. */
function ChipChoice({ label, value, options, onChange, tall }: { label: string; value: string; options: { value: string; label: string; swatch?: NoteColor | "any" }[]; onChange: (v: string) => void; tall?: boolean }) {
  const arrows = useArrowsChoose(onChange);
  return (
    <RadioGroup.Root aria-label={label} value={value} onValueChange={onChange} orientation="horizontal" loop className="flex flex-wrap gap-2" {...arrows.root}>
      {options.map((o) => (
        <RadioGroup.Item key={o.value} value={o.value} {...arrows.item(o.value)} className={cn(chip(value === o.value), tall ? "h-12" : "h-8")}>
          {o.swatch && <Swatch color={o.swatch === "any" ? undefined : o.swatch} className="size-4" />}
          {o.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

const colorOptions = [{ value: "any", label: "Any color", swatch: "any" as const }, ...NOTE_COLORS.map((c) => ({ value: c, label: colorName(c), swatch: c }))];

/**
 * On a phone (#226): Sort and filter, in the search bar, badged with how many are on; its sheet has the
 * sort, the color, the tag and With pictures, each taking effect as it's chosen, and Show N notes.
 */
function FilterSheet({ filters, set, clear, tags, count }: Choices) {
  const { open, set: setOpen } = useFilterOpen();
  const on = filtersOn(filters);
  const ids = { sort: useId(), color: useId(), tag: useId(), pictures: useId() };
  const heading = "text-sm font-semibold";
  const sortArrows = useArrowsChoose((v) => set({ sort: v as NoteSort }));
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" aria-label={on ? `Sort and filter, ${on} on` : "Sort and filter"} className="relative grid size-12 shrink-0 place-items-center rounded-full text-ink hover:bg-panel">
          <SlidersHorizontal className="size-5" aria-hidden />
          {on > 0 && (
            <span aria-hidden className="absolute top-1.5 right-1.5 grid size-4.5 place-items-center rounded-full bg-accent text-[11px] font-semibold text-paper">
              {on}
            </span>
          )}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content aria-describedby={undefined} className="fixed inset-x-0 bottom-0 z-50 grid max-h-[85dvh] gap-4 overflow-y-auto rounded-t-2xl border-t border-rule bg-raised px-4 pt-0 pb-4 text-ink shadow-xl">
          <SheetHandle edge="bottom" onClose={() => setOpen(false)} />
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">Sort and filter</Dialog.Title>
            <button type="button" onClick={clear} disabled={!on} className="h-12 px-2 text-sm font-semibold text-accent disabled:text-muted disabled:opacity-60">
              Clear all
            </button>
          </div>
          <section aria-labelledby={ids.sort} className="grid gap-2">
            <h2 id={ids.sort} className={heading}>
              Sort
            </h2>
            <RadioGroup.Root aria-labelledby={ids.sort} value={filters.sort} onValueChange={(v) => set({ sort: v as NoteSort })} orientation="horizontal" loop className="grid grid-cols-3 overflow-hidden rounded-xl border border-rule" {...sortArrows.root}>
              {(Object.keys(SORT_LABELS) as NoteSort[]).map((s) => (
                <RadioGroup.Item
                  key={s}
                  value={s}
                  {...sortArrows.item(s)}
                  className={cn("h-12 cursor-pointer border-l border-rule text-sm first:border-l-0 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none focus-visible:ring-inset", filters.sort === s ? "bg-accent-soft font-semibold text-accent" : "bg-raised")}
                >
                  {SORT_LABELS[s]}
                </RadioGroup.Item>
              ))}
            </RadioGroup.Root>
          </section>
          <section aria-labelledby={ids.color} className="grid gap-2">
            <h2 id={ids.color} className={heading}>
              Color
            </h2>
            <ChipChoice label="Color" value={filters.color ?? "any"} options={colorOptions} onChange={(v) => set({ color: v === "any" ? undefined : (v as NoteColor) })} tall />
          </section>
          {tags.length > 0 && (
            <section aria-labelledby={ids.tag} className="grid gap-2">
              <h2 id={ids.tag} className={heading}>
                Tag
              </h2>
              <ChipChoice label="Tag" value={filters.tag ?? ANY_TAG} options={[{ value: ANY_TAG, label: "Any tag" }, ...tags.map((t) => ({ value: t, label: t }))]} onChange={(v) => set({ tag: v === ANY_TAG ? undefined : v })} tall />
            </section>
          )}
          <div className="flex min-h-12 items-center justify-between border-y border-rule">
            <label htmlFor={ids.pictures} className="flex-1 py-3 text-sm">
              With pictures
            </label>
            <Switch.Root
              id={ids.pictures}
              checked={filters.pictures}
              onCheckedChange={(c) => set({ pictures: c })}
              className="relative h-7 w-12 cursor-pointer rounded-full border border-rule bg-panel transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none data-[state=checked]:border-accent data-[state=checked]:bg-accent"
            >
              <Switch.Thumb className="block size-5.5 translate-x-0.5 rounded-full bg-raised shadow transition-transform data-[state=checked]:translate-x-5.5" />
            </Switch.Root>
          </div>
          <Button variant="primary" className="h-12 rounded-xl text-base" onClick={() => setOpen(false)}>
            {count === 1 ? "Show 1 note" : `Show ${count} notes`}
          </Button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** On the desktop (#227): Filter, with how many are on; its popover has the color, the tag and With pictures, how many match and Clear all. */
function FilterPopover({ filters, set, clear, tags, count }: Choices) {
  const { open, set: setOpen } = useFilterOpen();
  const on = filtersOn(filters);
  const ids = { heading: useId(), color: useId(), tag: useId(), pictures: useId() };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button className={cn("h-10", on > 0 && "border-accent text-accent")}>
          <SlidersHorizontal className="size-4" aria-hidden /> Filter{on > 0 && ` · ${on}`}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} aria-labelledby={ids.heading} className="z-40 grid w-80 gap-3 rounded-xl border border-rule bg-raised p-4 text-sm text-ink shadow-lg">
          <h2 id={ids.heading} className="sr-only">
            Filter the notes
          </h2>
          <section aria-labelledby={ids.color} className="grid gap-2">
            <h3 id={ids.color} className="font-semibold">
              Color
            </h3>
            <ColorChoice label="Color" compact none="Any color" value={filters.color} onChange={(color) => set({ color })} />
          </section>
          {tags.length > 0 && (
            <section aria-labelledby={ids.tag} className="grid gap-2">
              <h3 id={ids.tag} className="font-semibold">
                Tag
              </h3>
              <ChipChoice label="Tag" value={filters.tag ?? ANY_TAG} options={[{ value: ANY_TAG, label: "Any tag" }, ...tags.map((t) => ({ value: t, label: t }))]} onChange={(v) => set({ tag: v === ANY_TAG ? undefined : v })} />
            </section>
          )}
          <label htmlFor={ids.pictures} className="flex items-center gap-2">
            <input id={ids.pictures} type="checkbox" checked={filters.pictures} onChange={(e) => set({ pictures: e.target.checked })} className="size-4 accent-accent" />
            With pictures
          </label>
          <div className="flex items-center justify-between border-t border-rule pt-3">
            <span className="text-muted">{count === 1 ? "1 note matches" : `${count} notes match`}</span>
            <button type="button" onClick={clear} disabled={!on} className="font-semibold text-accent hover:underline disabled:text-muted disabled:no-underline">
              Clear all
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SortSelect({ sort, onChange }: { sort: NoteSort; onChange: (s: NoteSort) => void }) {
  const id = useId();
  return (
    <span className="flex items-center gap-2 text-sm text-muted">
      <label htmlFor={id}>Sort</label>
      <span className="relative">
        <select
          id={id}
          value={sort}
          onChange={(e) => onChange(e.target.value as NoteSort)}
          className="h-10 appearance-none rounded-lg border border-rule bg-raised pr-8 pl-3 text-ink"
        >
          {(Object.keys(SORT_LABELS) as NoteSort[]).map((s) => (
            <option key={s} value={s}>
              {SORT_LABELS[s]}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute top-3 right-2.5 size-4 text-ink" aria-hidden />
      </span>
    </span>
  );
}
