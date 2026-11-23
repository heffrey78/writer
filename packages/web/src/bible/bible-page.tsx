import { defaultEntrySort, entryPresences, filterEntries, matchEntry, piecesMatching, sortEntries, typePlural, vocabulary, word, type Book, type Entity, type EntryPresence, type EntrySort, type Vocabulary } from "@writer/core";
import { findPanel } from "@writer/editor";
import type { SpellService } from "@writer/editor/react";
import { ChevronLeft, ChevronRight, Expand, LayoutGrid, List, PanelLeftClose, PanelLeftOpen, Plus, Search, SlidersHorizontal, Sparkles, Table2, X } from "lucide-react";
import { Fragment, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useNavigationType } from "react-router";
import { create } from "zustand";
import { useCommands } from "../commands.ts";
import { useNarrow } from "../narrow.ts";
import { moduleRecordTypes } from "../modules.tsx";
import { NEW_TYPE } from "../novel/item-modals.tsx";
import { fieldsTitle, useFieldsDialog } from "./fields-dialog.tsx";
import type { Workspace } from "../novel/workspace.ts";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { PAGE } from "../ui/page.ts";
import { useViewParams } from "../ui/view-params.ts";
import { EntryPage } from "./entry-page.tsx";
import { imageUrl } from "@writer/client";
import { Picture, useImageVersions } from "./picture.tsx";
import { pictureAlt, shapeForType } from "./pictures.ts";
import { anyFilter, FilterBar, FILTER_KEYS, filtersOf, TypeChips } from "./filters.tsx";
import { NewTypeDialog } from "./new-entry.tsx";
import { opened } from "./recent.ts";
import { OpenParts, saveOpenParts } from "./profile.tsx";
import { RelationshipTypes } from "./relationship-types.tsx";
import { markWords } from "./strip.tsx";
import { EntryTable } from "./table.tsx";
import { cardFacts, entriesByType, initials } from "./types.ts";

/*
 * The index (the Story bible, a campaign's Codex, a journal's Index; heffrey78/gh-writer#162, #134): its
 * entries listed by type, searchable by anything they say and sorted four ways, and the one chosen open
 * beside the list, so moving to the next is one step and the list keeps its place. The list is a List
 * of rows or the Cards of the gallery; the kind's modules add their records after the entries (off-page
 * events), opening beside it too. In a window too narrow for both, the list and the entry are one
 * screen each, and back from the entry the list is where it was (#175).
 */

const sorts = (w: Vocabulary): { key: EntrySort; label: string }[] => [
  { key: "first", label: "First appearance" },
  { key: "last", label: "Last appearance" },
  { key: "name", label: "Name" },
  { key: "most", label: `Most ${w.piece.many}` },
];

/** A control a finger can hit on a phone: 44 px at the least. */
const TOUCH = "max-md:h-11 max-md:px-3.5";

const MARK = { carries: "bg-accent", present: "bg-accent/40", mentioned: "bg-accent/15", absent: "bg-rule/60" } as const;

type View = "list" | "cards" | "table";

/** What the index shows beside its list: an entry, a module's record, or nothing yet. */
export type Selected = { entry: string } | { record: { type: ReturnType<typeof moduleRecordTypes>[number]; id: string } } | undefined;

/** The list's view and width, and whether it's folded away: kept per book on this device. */
interface IndexLayout {
  view: View;
  width: Record<View, number>;
  collapsed: boolean;
}
const LAYOUT_DEFAULT: IndexLayout = { view: "list", width: { list: 352, cards: 560, table: 640 }, collapsed: false };
const MIN_WIDTH = 260;
const MAX_WIDTH = 760;
const layoutKey = (novelId: string) => `ghw:index:${novelId}`;

function readLayout(novelId: string): IndexLayout {
  try {
    const saved = JSON.parse(localStorage.getItem(layoutKey(novelId)) ?? "{}") as Partial<IndexLayout>;
    const clamp = (n: unknown, d: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Number(n) || d));
    return {
      view: saved.view === "cards" || saved.view === "table" ? saved.view : "list",
      width: { list: clamp(saved.width?.list, LAYOUT_DEFAULT.width.list), cards: clamp(saved.width?.cards, LAYOUT_DEFAULT.width.cards), table: clamp(saved.width?.table, LAYOUT_DEFAULT.width.table) },
      collapsed: saved.collapsed === true,
    };
  } catch {
    return LAYOUT_DEFAULT;
  }
}

const useLayouts = create<Record<string, IndexLayout>>(() => ({}));

function useIndexLayout(novelId: string): [IndexLayout, (change: Partial<IndexLayout>) => void] {
  const layout = useLayouts((s) => s[novelId]) ?? readLayout(novelId);
  const set = (change: Partial<IndexLayout>) => {
    const next = { ...(useLayouts.getState()[novelId] ?? readLayout(novelId)), ...change };
    useLayouts.setState({ [novelId]: next });
    try {
      localStorage.setItem(layoutKey(novelId), JSON.stringify(next));
    } catch {
      // Not kept for next time; still as asked now.
    }
  };
  return [layout, set];
}

/** How many rows of the list are drawn at a time. */
const STRETCH = 120;

/** The entry beside the list, for the keyboard to find. */
const PANE_ID = "index-entry";

/** Typing somewhere: a field, a menu's list, the notes' text, a part being edited. The index's keys are then the text's. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("[data-part-editor], [contenteditable=true], [role=listbox], [role=menu], select, textarea")) return true;
  return target instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit", "reset", "range"].includes(target.type);
}

/** Wide enough for the list and an entry side by side. */
const TWO_PANES = "(min-width: 70rem)";

/**
 * Where the list was, shown alone, as an entry was opened from it: back from the entry (Android's back,
 * the browser's, or the entry's own way back), the list is there again, its row in focus (#175).
 */
const listPlace = new Map<string, { search: string; top: number; id: string | undefined }>();

/** What scrolls the list: the page's own pane on a wider window, the page itself on a phone. */
function scrollerOf(el: Element): Element {
  for (let at = el.parentElement; at; at = at.parentElement) {
    const y = getComputedStyle(at).overflowY;
    if ((y === "auto" || y === "scroll") && at.scrollHeight > at.clientHeight) return at;
  }
  return document.scrollingElement ?? document.documentElement;
}

function useTwoPanes(): boolean {
  const [wide, setWide] = useState(() => typeof matchMedia !== "function" || matchMedia(TWO_PANES).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia(TWO_PANES);
    const on = () => setWide(query.matches);
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
  }, []);
  return wide;
}

export function BiblePage({
  novelId,
  novel,
  workspace,
  spell,
  selected,
  over,
}: {
  novelId: string;
  novel: Book;
  workspace?: Workspace;
  spell?: { service: SpellService; onAddWord: (w: string) => void } | undefined;
  selected?: Selected;
  /** A modal over it: a new entry or record being named. */
  over?: ReactNode;
}) {
  const w = vocabulary(novel.kind);
  // Answering at once, the address following: typed fast, a search keeps every letter.
  const [params, setParamsTo] = useViewParams();
  const { hash, state: arrived } = useLocation();
  const navigationType = useNavigationType();
  // The search, sort and filters, carried to an entry's address and back.
  const search = params.toString() ? `?${params.toString()}` : "";
  const query = params.get("q") ?? "";
  const navigate = useNavigate();
  const [layout, setLayout] = useIndexLayout(novelId);
  const twoPanes = useTwoPanes();
  // On a phone the Table has no room: the List in its place (the Table is offered from a tablet's width).
  const narrow = useNarrow();
  const view: View = narrow && layout.view === "table" ? "list" : layout.view;
  /**
   * A new entry (of a type, or chosen), in its modal over the index: the search and filters kept, so
   * the list under it and beside the new entry is the one the writer was in.
   */
  const add = (type?: string) => {
    const over = new URLSearchParams(params);
    if (type) over.set(NEW_TYPE, type);
    void navigate(`/novels/${novelId}/bible/new${over.size ? `?${over.toString()}` : ""}`, { state: { fromGallery: true } });
  };
  const [addingType, setAddingType] = useState(false);
  const searchId = useId();
  const sortId = useId();
  const fallback = defaultEntrySort(novel.kind);
  const sort: EntrySort = (params.get("sort") as EntrySort | null) ?? fallback;
  const presences = useMemo(() => entryPresences(novel), [novel]);
  const filters = filtersOf(params);
  const filtered = anyFilter(filters);
  const filterKey = FILTER_KEYS.map((k) => params.get(k) ?? "").join("|");
  // A module's records aren't entries: the filters are the entries', so they're left out while any is set.
  const records = filtered ? [] : moduleRecordTypes(novel.kind);

  // The list's order and what's in it, kept while the entries change underneath (an entry renamed, a
  // summary edited no longer matching): it's worked out again when the search, the sort or which
  // entries there are changes, so the list never moves under the writer as they work through it.
  // Which types and entries there are, not the order they're loaded in (a renamed entry's file moves).
  const ids = `${novel.entityTypes.map((t) => t.key).join(" ")}|${novel.entities.map((e) => e.id).sort().join(" ")}`;
  const order = useMemo(
    () =>
      entriesByType(novel).map((g) => ({
        type: g.type.key,
        count: g.entries.length,
        shown: sortEntries(novel, filterEntries(novel, g.entries.filter((e) => matchEntry(e, query, { book: novel })), filters, presences), sort, presences).map((e) => e.id),
      })),
    [query, sort, ids, filterKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const byId = new Map(novel.entities.map((e) => [e.id, e]));
  const groups = order.flatMap((g) => {
    const type = novel.entityTypes.find((t) => t.key === g.type);
    return type ? [{ type, count: novel.entities.filter((e) => e.type === g.type).length, shown: g.shown.flatMap((id) => byId.get(id) ?? []) }] : [];
  });
  // The Table shows one type: the one the type chip names.
  const tableType = filters.types?.length === 1 ? groups.find((g) => g.type.key === filters.types![0]) : undefined;
  const found = groups.reduce((n, g) => n + g.shown.length, 0);
  const listed = groups.flatMap((g) => g.shown);

  // A long list is drawn a stretch at a time: the first rows at once, the rest in the moments after,
  // so a search, a sort or a filter answers within a frame or two however long the bible is. The open
  // entry's row is always among those drawn.
  const orderKey = `${query}|${sort}|${ids}|${filterKey}|${view}`;
  const [progress, setProgress] = useState({ key: orderKey, limit: STRETCH });
  const drawn = progress.key === orderKey ? progress.limit : STRETCH;
  useEffect(() => {
    if (drawn >= listed.length) return;
    const t = setTimeout(() => setProgress({ key: orderKey, limit: drawn + STRETCH }));
    return () => clearTimeout(t);
  }, [drawn, listed.length, orderKey]);

  const setParam = (key: string, value: string | undefined) => setParamsTo({ [key]: value });
  // Pieces whose own words match: offered after the entries, as a way into the book's find.
  const pieces = useMemo(() => (query.trim() ? piecesMatching(novel, query) : []), [novel, query]);
  const searchPieces = () => {
    const first = pieces[0];
    if (!first) return;
    findPanel.setState((f) => ({ open: true, scope: "manuscript", seed: query.trim(), request: f.request + 1 }));
    void navigate(`/novels/${novelId}/scene/${first.id}`);
  };

  // The parts of the entry beside the list open for editing: saved before another entry is opened.
  const parts = useMemo(() => new Set<() => Promise<boolean>>(), []);
  const go = async (to: string, e?: MouseEvent, state?: object) => {
    if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)) return; // a new tab or window: as the browser does
    e?.preventDefault();
    if (await saveOpenParts(parts)) void navigate(to, state ? { state } : undefined);
  };
  // The list on its own (one pane, or the gallery with nothing open): where it is, kept as an entry opens.
  const listAlone = !selected && (!twoPanes || view !== "list");
  const remember = (to: string) => {
    if (!listAlone || !list.current) return;
    const id = /\/bible\/([^/?#]+)/.exec(to)?.[1];
    listPlace.set(novelId, { search, top: scrollerOf(list.current).scrollTop, id: id && decodeURIComponent(id) });
  };
  const entryHref = (id: string) => `/novels/${novelId}/bible/${id}${search}`;
  // What every row needs, worked out once for the list (a long book's has hundreds of rows): the
  // pictures' addresses, each type's words for its marks, what a search matched. Each row is drawn
  // again only when its own change, so stepping through the list redraws two rows, not all of them.
  const versions = useImageVersions(novelId);
  const pictureOf = (e: Entity) => (e.image ? imageUrl(novelId, e.image, versions[e.image]) : undefined);
  const marksByType = useMemo(() => new Map(novel.entityTypes.map((t) => [t.key, markWords(novel.kind, t.key, w)])), [novel, w]);
  const matches = useMemo(() => new Map(query ? novel.entities.map((e) => [e.id, matchEntry(e, query, { around: 3, book: novel })]) : []), [novel, query]);
  const latest = useRef({ go, remember, listAlone, selectedId: undefined as string | undefined, entryHref });
  const onOpen = useCallback((to: string, e?: MouseEvent) => {
    const { go, remember, listAlone } = latest.current;
    remember(to);
    return go(to, e, listAlone ? { fromList: true } : undefined);
  }, []);
  const onEnter = useCallback((id: string) => {
    const { selectedId, entryHref, remember, listAlone } = latest.current;
    if (id === selectedId) return void document.getElementById(PANE_ID)?.focus();
    remember(entryHref(id));
    void navigate(entryHref(id), { state: { focusEntry: true, ...(listAlone ? { fromList: true } : {}) } });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedId = selected && "entry" in selected ? selected.entry : selected?.record.id;
  latest.current = { go, remember, listAlone, selectedId, entryHref };
  const list = useRef<HTMLDivElement>(null);
  // Back to the list from the entry opened from it: the list scrolled where it was, the entry's row in focus.
  const backTo = listAlone && (navigationType === "POP" || (arrived as { back?: boolean } | null)?.back) ? listPlace.get(novelId) : undefined;
  const place = backTo?.search === search ? backTo : undefined;
  // The one open, in view in the list; and arriving at a group (the book pane's Off the page links to #off-the-page), that group.
  useEffect(() => {
    if (selectedId) list.current?.querySelector(`[data-entry="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  // How many rows to draw now (the open entry's, or the one come back from, among them), and how many come before each group's.
  const limit = Math.max(drawn, listed.findIndex((e) => e.id === (selectedId ?? place?.id)) + 1 + STRETCH / 4);
  const before = groups.map((_, i) => groups.slice(0, i).reduce((n, x) => n + x.shown.length, 0));

  // The keyboard (#134): j and k (and the arrows in the list) open the next and previous entry in the
  // list's order, the focus on its row; Enter on a row moves into the entry, Escape back to its row;
  // / searches, e edits, n makes a new entry of the open one's type, [ folds the list away and back.
  const searchRef = useRef<HTMLInputElement>(null);
  const focusRow = useRef<string | undefined>(undefined);
  const rowLink = (id: string) => list.current?.querySelector<HTMLElement>(`[data-entry="${CSS.escape(id)}"] a`);
  const stepTo = (by: number | "first" | "last") => {
    if (!listed.length) return;
    const at = listed.findIndex((e) => e.id === selectedId);
    const to = by === "first" ? 0 : by === "last" ? listed.length - 1 : at < 0 ? (by > 0 ? 0 : listed.length - 1) : Math.min(listed.length - 1, Math.max(0, at + by));
    const id = listed[to]!.id;
    if (id === selectedId) return void rowLink(id)?.focus();
    focusRow.current = id;
    void go(entryHref(id));
  };
  useEffect(() => {
    if (selectedId && focusRow.current === selectedId) {
      focusRow.current = undefined;
      rowLink(selectedId)?.focus();
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const newOfType = () => add(selected && "entry" in selected ? novel.entities.find((e) => e.id === selected.entry)?.type : undefined);
  const toggleList = () => setLayout({ collapsed: !layout.collapsed });
  const editPart = () => {
    const pane = document.getElementById(PANE_ID);
    const here = document.activeElement?.closest(".group")?.querySelector<HTMLElement>('button[aria-label^="Edit "]');
    const button = (here && pane?.contains(here) ? here : null) ?? pane?.querySelector<HTMLElement>('button[aria-label="Edit summary"]') ?? [...(pane?.querySelectorAll<HTMLElement>("button") ?? [])].find((b) => b.textContent?.trim() === "Add a summary");
    button?.click();
  };
  useLayoutEffect(() => {
    if (!place || !list.current) return;
    scrollerOf(list.current).scrollTop = place.top;
    if (place.id) rowLink(place.id)?.focus({ preventScroll: true });
  }, [listAlone]); // eslint-disable-line react-hooks/exhaustive-deps
  const keys = useRef({ stepTo, newOfType, toggleList, editPart, selectedId });
  keys.current = { stepTo, newOfType, toggleList, editPart, selectedId };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const k = keys.current;
      const inList = !!list.current?.contains(e.target as Node);
      const inPane = !!document.getElementById(PANE_ID)?.contains(e.target as Node);
      const act = (run: () => void) => {
        e.preventDefault();
        run();
      };
      if (e.key === "/") act(() => searchRef.current?.focus());
      else if (e.key === "j" || (inList && e.key === "ArrowDown")) act(() => k.stepTo(1));
      else if (e.key === "k" || (inList && e.key === "ArrowUp")) act(() => k.stepTo(-1));
      else if (inList && e.key === "Home") act(() => k.stepTo("first"));
      else if (inList && e.key === "End") act(() => k.stepTo("last"));
      else if (e.key === "e") act(k.editPart);
      else if (e.key === "n") act(k.newOfType);
      else if (e.key === "[") act(k.toggleList);
      else if (e.key === "Escape" && inPane && k.selectedId) act(() => rowLink(k.selectedId!)?.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Said to a screen reader once moving settles: which entry, what it is, and where in the list.
  const [said, setSaid] = useState("");
  const selectedEntry = selected && "entry" in selected ? novel.entities.find((e) => e.id === selected.entry) : undefined;
  const sayIt = selectedEntry ? `${selectedEntry.name}, ${(novel.entityTypes.find((t) => t.key === selectedEntry.type)?.label ?? "").toLowerCase()}, ${listed.findIndex((e) => e.id === selectedEntry.id) + 1} of ${listed.length}` : "";
  useEffect(() => {
    const t = setTimeout(() => setSaid(sayIt), 300);
    return () => clearTimeout(t);
  }, [sayIt]);

  useCommands(
    () => [
      { id: "index.search", title: `Search the ${w.codex.short ?? w.codex.one}`, group: w.codex.One, keys: "/", run: () => searchRef.current?.focus() },
      { id: "index.next", title: `Next ${w.entity.one}`, group: w.codex.One, keys: "j", run: () => keys.current.stepTo(1) },
      { id: "index.previous", title: `Previous ${w.entity.one}`, group: w.codex.One, keys: "k", run: () => keys.current.stepTo(-1) },
      { id: "index.edit", title: `Edit the ${w.entity.one}'s summary`, group: w.codex.One, keys: "e", run: () => keys.current.editPart() },
      { id: "index.newOfType", title: `New ${w.entity.one} of this type`, group: w.codex.One, keys: "n", run: () => keys.current.newOfType() },
      { id: "index.toggleList", title: layout.collapsed ? "Show the list" : "Hide the list", group: w.codex.One, keys: "[", run: () => keys.current.toggleList() },
    ],
    [w, layout.collapsed],
  );
  const listContent = (
    <div ref={list} className={cn("grid min-w-0 content-start gap-5", view !== "list" && !selected ? PAGE : "px-4 py-4")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{w.codex.One}</h1>
        <div className="flex flex-wrap gap-2">

          <Button size="sm" variant="ghost" onClick={() => void navigate(`/novels/${novelId}/bible/tidy`)} className={TOUCH}>
            <Sparkles className="size-4" aria-hidden /> Tidy up
          </Button>
          <Button size="sm" onClick={() => setAddingType(true)} className={TOUCH}>
            New type
          </Button>
          <Button size="sm" variant="primary" onClick={() => add()} className={TOUCH}>
            <Plus className="size-4" aria-hidden /> New {w.entity.one}
          </Button>
          {twoPanes && (view === "list" || selected) && (
            <Button size="sm" variant="ghost" onClick={() => setLayout({ collapsed: true })} aria-label="Hide the list" title="Hide the list">
              <PanelLeftClose className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-2">
        <div className="relative">
          <label htmlFor={searchId} className="sr-only">
            Search the {w.codex.short}
          </label>
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted max-md:top-3.5" aria-hidden />
          <input
            ref={searchRef}
            id={searchId}
            type="search"
            placeholder="Search names, notes and fields"
            aria-keyshortcuts="/"
            value={query}
            onChange={(e) => setParam("q", e.target.value || undefined)}
            // Down from the search into what it found: the first entry, opened.
            onKeyDown={(e) => {
              if (e.key !== "ArrowDown") return;
              e.preventDefault();
              keys.current.stepTo("first");
            }}
            className="h-9 w-full rounded-md border border-rule bg-raised pr-3 pl-9 text-sm max-md:h-11 max-md:text-base"
          />
        </div>
        {/* On a phone the types are a row of their own, scrolling sideways; the other filters under Filter. */}
        {narrow && <TypeChips novel={novel} filters={filters} onChange={setParamsTo} />}
        <FilterBar novel={novel} filters={filters} onChange={setParamsTo} types={!narrow} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ViewSwitch view={view} onChange={(v) => setLayout({ view: v })} table={!narrow} />
          <label htmlFor={sortId} className="flex items-center gap-2 text-sm text-muted">
            Sort
            <select id={sortId} value={sort} onChange={(e) => setParam("sort", e.target.value === fallback ? undefined : e.target.value)} className="h-8 rounded-md border border-rule bg-raised px-2 text-ink max-md:h-11">
              {sorts(w).map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {(query || filtered) && (
        <p role="status" className="text-sm text-muted">
          {w.entity.count(found)} {found === 1 ? "matches" : "match"} {query ? `“${query}”` : "the filters"}
          {query && filtered && " and the filters"}
          {records.length > 0 && query && ` (and the ${records.map((t) => word(t.def.noun).many).join(" and ")} below that do)`}
        </p>
      )}
      {view === "table" ? (
        tableType ? (
          <EntryTable novelId={novelId} novel={novel} type={tableType.type} rows={tableType.shown} presences={presences} href={entryHref} onOpen={onOpen} current={selectedId} />
        ) : (
          <section aria-labelledby={`${searchId}-table`} className="grid gap-2">
            <h2 id={`${searchId}-table`} className="font-semibold">
              The table shows one type at a time
            </h2>
            <p className="text-sm text-muted">Choose which:</p>
            <div className="flex flex-wrap gap-2">
              {groups
                .filter((g) => !filters.types?.length || filters.types.includes(g.type.key))
                .map((g) => (
                  <Button key={g.type.key} size="sm" onClick={() => setParam("type", g.type.key)}>
                    {typePlural(g.type)} <span className="text-muted">{g.shown.length}</span>
                  </Button>
                ))}
            </div>
          </section>
        )
      ) : (
        <>
        {groups.map(({ type, count, shown }, g) =>
          (query || filtered) && !shown.length ? null : (
            <section key={type.key} aria-labelledby={`type-${type.key}`} className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <h2 id={`type-${type.key}`} className="font-semibold">
                  {typePlural(type)} <span className="text-sm font-normal text-muted">{count}</span>
                </h2>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => useFieldsDialog.getState().open(type.key)} aria-label={fieldsTitle(type)} className={TOUCH}>
                    <SlidersHorizontal className="size-4" aria-hidden /> Fields
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => add(type.key)} aria-label={`New ${type.label.toLowerCase()}`} className={TOUCH}>
                    <Plus className="size-4" aria-hidden /> New
                  </Button>
                </div>
              </div>
              {shown.length ? (
                <ul className={view === "cards" ? cn("grid gap-3", selected ? "grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]" : "sm:grid-cols-2 lg:grid-cols-3") : "grid gap-0.5"}>
                  {shown.slice(0, Math.max(0, limit - before[g]!)).map((e) => (
                    <li key={e.id} className="grid" data-entry={e.id}>
                      {view === "cards" ? (
                        <EntryCard entity={e} presence={presences.get(e.id)} href={entryHref(e.id)} current={e.id === selectedId} onOpen={onOpen} url={pictureOf(e)} marks={marksByType.get(e.type)!} w={w} book={novel} />
                      ) : (
                        <EntryRow entity={e} presence={presences.get(e.id)} href={entryHref(e.id)} current={e.id === selectedId} onOpen={onOpen} onEnter={onEnter} match={matches.get(e.id)} url={pictureOf(e)} marks={marksByType.get(e.type)!} w={w} />
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No {typePlural(type).toLowerCase()} yet.</p>
              )}
            </section>
          ),
        )}
        {records.map((t) => (
          <Fragment key={t.type}>{t.gallery({ novelId, novel, query, sort })}</Fragment>
        ))}
        </>
      )}
      {pieces.length > 0 && (
        <p className="text-sm text-muted">
          Also in {w.piece.count(pieces.length)}:{" "}
          <button type="button" onClick={searchPieces} className="text-accent underline decoration-accent/35 underline-offset-[3px] hover:decoration-accent">
            search the {w.content.one} for “{query.trim()}”
          </button>
        </p>
      )}
      {!query && !filtered && <RelationshipTypes novelId={novelId} novel={novel} />}
    </div>
  );

  const step = selected && "entry" in selected ? listed.findIndex((e) => e.id === selected.entry) : -1;
  const pane = selected && (
    <EntryPane
      novelId={novelId}
      novel={novel}
      workspace={workspace}
      spell={spell}
      selected={selected}
      parts={parts}
      twoPanes={twoPanes}
      alone={!twoPanes || layout.collapsed}
      position={step >= 0 ? { at: step, of: listed.length, previous: listed[step - 1]?.id, next: listed[step + 1]?.id } : undefined}
      href={entryHref}
      onGo={go}
      closeTo={`/novels/${novelId}/bible${search}`}
    />
  );

  const dialogs = (
    <>
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
      <NewTypeDialog novelId={novelId} novel={novel} open={addingType} onOpenChange={setAddingType} />
      {over}
    </>
  );

  // One pane: the list, or the entry with a way back to it. The gallery of cards, with nothing open, as wide as any page.
  if (!twoPanes || (view !== "list" && !selected)) {
    // The dialogs (and the line said to a screen reader) first: placed by the page, not the pane, after a
    // long list one would reach far below it, and the whole page would scroll as well as the pane.
    return (
      <>
        {dialogs}
        {selected && !twoPanes ? pane : listContent}
      </>
    );
  }

  const width = layout.width[view];
  return (
    <div className="grid h-full min-h-0" style={{ gridTemplateColumns: layout.collapsed ? "2.75rem minmax(0,1fr)" : `${width}px 0.375rem minmax(0,1fr)` }}>
      {layout.collapsed ? (
        <div className="flex flex-col items-center gap-1 border-r border-rule bg-panel py-2">
          <button type="button" onClick={() => setLayout({ collapsed: false })} aria-label="Show the list" title="Show the list" className="rounded-md p-2 text-muted hover:bg-paper hover:text-ink">
            <PanelLeftOpen className="size-4" aria-hidden />
          </button>
        </div>
      ) : (
        <>
          <div className="min-h-0 overflow-y-auto">{listContent}</div>
          <ResizeHandle width={width} onResize={(n) => setLayout({ width: { ...layout.width, [view]: n } })} label="Resize the list" />
        </>
      )}
      <div className="min-h-0 overflow-y-auto">
        {pane ?? (
          <div className="grid h-full place-items-center px-6 py-10 text-center text-muted">
            <div className="grid max-w-sm gap-2">
              <p>Choose {w.entity.a} from the list to read it here.</p>
              <p className="text-sm">Or make one with New {w.entity.one}.</p>
            </div>
          </div>
        )}
      </div>
      {dialogs}
    </div>
  );
}

function ViewSwitch({ view, onChange, table }: { view: View; onChange: (v: View) => void; table: boolean }) {
  const options = [
    { key: "list" as const, label: "List", icon: List },
    { key: "cards" as const, label: "Cards", icon: LayoutGrid },
    ...(table ? [{ key: "table" as const, label: "Table", icon: Table2 }] : []),
  ];
  return (
    <div role="group" aria-label="Show as" className="flex overflow-hidden rounded-md border border-rule text-xs">
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={view === o.key} onClick={() => onChange(o.key)} className={cn("flex items-center gap-1 border-r border-rule px-2.5 py-1 last:border-r-0 max-md:min-h-11 max-md:px-3.5", view === o.key ? "bg-ink text-paper" : "bg-raised hover:bg-panel")}>
          <o.icon className="size-3.5" aria-hidden /> {o.label}
        </button>
      ))}
    </div>
  );
}

/** The edge between the list and the entry: dragged, or moved with the arrow keys. */
function ResizeHandle({ width, onResize, label }: { width: number; onResize: (n: number) => void; label: string }) {
  const clamp = (n: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n));
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onKeyDown={(e) => {
        const by = e.shiftKey ? 64 : 16;
        if (e.key === "ArrowLeft") onResize(clamp(width - by));
        else if (e.key === "ArrowRight") onResize(clamp(width + by));
        else return;
        e.preventDefault();
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        const start = e.clientX;
        const move = (m: PointerEvent) => onResize(clamp(width + m.clientX - start));
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      className="h-full cursor-col-resize border-l border-rule hover:bg-accent/30 focus-visible:bg-accent/40 focus-visible:outline-none"
    />
  );
}

/** The entry or record beside the list (or, one pane at a time, in its place), with the way through the list. */
function EntryPane({
  novelId,
  novel,
  workspace,
  spell,
  selected,
  parts,
  twoPanes,
  alone,
  position,
  href,
  onGo,
  closeTo,
}: {
  novelId: string;
  novel: Book;
  workspace: Workspace | undefined;
  spell: { service: SpellService; onAddWord: (w: string) => void } | undefined;
  selected: NonNullable<Selected>;
  parts: Set<() => Promise<boolean>>;
  twoPanes: boolean;
  /** Without the list beside it: its name is then the page's heading. */
  alone: boolean;
  position: { at: number; of: number; previous: string | undefined; next: string | undefined } | undefined;
  href: (id: string) => string;
  onGo: (to: string, e?: MouseEvent, state?: object) => Promise<void>;
  closeTo: string;
}) {
  const w = vocabulary(novel.kind);
  const headingId = useId();
  const navigate = useNavigate();
  const state = useLocation().state as { focusProse?: boolean; focusEntry?: boolean; fromList?: boolean } | null;
  const pane = useRef<HTMLElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  // One pane at a time, its top bar stays at the top: the entry's strip of parts stays under it (#176).
  useLayoutEffect(() => {
    const el = bar.current;
    if (twoPanes || !el || !pane.current) return;
    const on = () => pane.current?.style.setProperty("--ghw-sticky-top", `${el.offsetHeight}px`);
    on();
    const observer = new ResizeObserver(on);
    observer.observe(el);
    return () => observer.disconnect();
  }, [twoPanes]);
  const entity = "entry" in selected ? novel.entities.find((e) => e.id === selected.entry) : undefined;
  const record = "record" in selected ? novel.moduleRecords.find((r) => r.type === selected.record.type.type && r.id === selected.record.id) : undefined;
  const id = "entry" in selected ? selected.entry : selected.record.id;
  const found = !!(entity ?? record);
  useEffect(() => {
    if (found) opened(novelId, id);
  }, [novelId, id, found]);
  // Just made (its modal closing as it opens here): in focus, after the modal has given the focus back
  // to what opened it, so a screen reader says its name and Tab goes on into it.
  useEffect(() => {
    if (!state?.focusProse && !state?.focusEntry) return;
    const t = setTimeout(() => pane.current?.focus());
    return () => clearTimeout(t);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const nav = (to: string | undefined, label: string, icon: ReactNode) =>
    to ? (
      <a href={href(to)} onClick={(e) => void onGo(href(to), e)} aria-label={label} title={label} className="grid place-items-center rounded-md p-1.5 text-muted hover:bg-panel hover:text-ink max-md:size-11">
        {icon}
      </a>
    ) : (
      <span aria-hidden className="grid place-items-center rounded-md p-1.5 text-muted/40 max-md:size-11">
        {icon}
      </span>
    );

  // Back to the list: the step back it came from (as Android's back), or to the list, to where it was.
  const back = (e: MouseEvent) => {
    if (!state?.fromList || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return void onGo(closeTo, e, { back: true });
    e.preventDefault();
    void saveOpenParts(parts).then((saved) => {
      if (saved) void navigate(-1);
    });
  };

  const gone = (
    <div className="grid gap-2 px-6 py-6">
      <h2 className="text-xl font-semibold">No such {"entry" in selected ? w.entity.one : (selected.record.type.def.noun.short ?? selected.record.type.def.noun.label).toLowerCase()}</h2>
      <p className="text-muted">It may have been deleted.</p>
    </div>
  );

  if (!workspace) return gone;
  return (
    <section ref={pane} id={PANE_ID} aria-labelledby={headingId} tabIndex={-1} className="grid content-start outline-none">
      <div ref={bar} className={cn("flex flex-wrap items-center gap-1 border-b border-rule px-4 py-1.5 text-sm", !twoPanes && "sticky top-0 z-20 bg-paper")}>
        {!twoPanes && (
          <Link to={closeTo} state={{ back: true }} onClick={back} className="flex min-h-11 items-center gap-1 rounded-md px-1.5 py-1 text-muted hover:bg-panel hover:text-ink">
            <ChevronLeft className="size-4" aria-hidden /> {w.codex.One}
          </Link>
        )}
        {position && (
          <>
            {nav(position.previous, `Previous ${w.entity.one}`, <ChevronLeft className="size-4" aria-hidden />)}
            <span className="text-xs text-muted tabular-nums">
              {position.at + 1} of {position.of}
            </span>
            {nav(position.next, `Next ${w.entity.one}`, <ChevronRight className="size-4" aria-hidden />)}
          </>
        )}
        <span className="flex-1" />
        {entity && (
          <Link to={`/novels/${novelId}/bible/${entity.id}/page`} onClick={(e) => void onGo(`/novels/${novelId}/bible/${entity.id}/page`, e)} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-muted hover:bg-panel hover:text-ink max-md:min-h-11">
            <Expand className="size-4" aria-hidden /> Open as page
          </Link>
        )}
        {twoPanes && (
          <Link to={closeTo} state={{ back: true }} onClick={(e) => void onGo(closeTo, e, { back: true })} aria-label={`Close the ${"entry" in selected ? w.entity.one : (selected.record.type.def.noun.short ?? selected.record.type.def.noun.label).toLowerCase()}`} title="Close" className="rounded-md p-1.5 text-muted hover:bg-panel hover:text-ink">
            <X className="size-4" aria-hidden />
          </Link>
        )}
      </div>
      <div className="px-6 pt-4 pb-10">
        <OpenParts.Provider value={parts}>
          {entity ? (
            <EntryBody key={entity.id} novelId={novelId} novel={novel} entity={entity} workspace={workspace} spell={spell} headingId={headingId} alone={alone} />
          ) : record && "record" in selected ? (
            <Fragment key={record.id}>{selected.record.type.page({ novelId, novel, workspace, record, spell, embedded: { headingId, modal: alone } })}</Fragment>
          ) : (
            gone
          )}
        </OpenParts.Provider>
      </div>
    </section>
  );
}

const STRENGTH = { absent: 0, mentioned: 1, present: 2, carries: 3 } as const;

/**
 * The strip's marks, at most `most` of them: a long book's pieces taken a stretch at a time, each
 * stretch marked by the strongest way the entry is in it. Hundreds of entries by hundreds of pieces
 * would otherwise be a mark each, too many to draw quickly and too small to see.
 */
export function stripMarks(presence: EntryPresence | undefined, most: number): { title: string; mark: keyof typeof STRENGTH }[] {
  const scenes = presence?.scenes ?? [];
  if (scenes.length <= most) return scenes.map(({ scene, mark }) => ({ title: scene.title, mark }));
  const size = Math.ceil(scenes.length / most);
  const out: { title: string; mark: keyof typeof STRENGTH }[] = [];
  for (let i = 0; i < scenes.length; i += size) {
    const stretch = scenes.slice(i, i + size);
    const mark = stretch.reduce<keyof typeof STRENGTH>((m, s) => (STRENGTH[s.mark] > STRENGTH[m] ? s.mark : m), "absent");
    out.push({ title: `${stretch[0]!.scene.title} to ${stretch.at(-1)!.scene.title}`, mark });
  }
  return out;
}

/**
 * The entry's profile beside the list, drawn again only when the book, the entry or how it's shown
 * changes: not as the list beside it is searched, filtered or stepped through.
 */
const EntryBody = memo(
  function EntryBody({ novelId, novel, entity, workspace, spell, headingId, alone }: { novelId: string; novel: Book; entity: Entity; workspace: Workspace; spell: { service: SpellService; onAddWord: (w: string) => void } | undefined; headingId: string; alone: boolean }) {
    return <EntryPage novelId={novelId} novel={novel} entity={entity} workspace={workspace} spell={spell} embedded={{ headingId, modal: alone }} />;
  },
  (a, b) => a.novel === b.novel && a.entity === b.entity && a.workspace === b.workspace && a.spell?.service === b.spell?.service && a.headingId === b.headingId && a.alone === b.alone,
);

/** A small strip of the pieces an entry is in, by how. */
function MiniStrip({ presence, words }: { presence: EntryPresence | undefined; words: Record<string, string | undefined> }) {
  const marks = stripMarks(presence, 24);
  if (!marks.length) return null;
  return (
    <span aria-hidden className="grid w-16 shrink-0" style={{ gridTemplateColumns: `repeat(${marks.length}, minmax(0, 1fr))`, gap: 1 }}>
      {marks.map(({ title, mark }, i) => (
        <span key={i} title={`${title}: ${mark === "absent" ? "not there" : (words[mark] ?? words.present)}`} className={`h-1.5 rounded-[1px] ${MARK[mark]}`} />
      ))}
    </span>
  );
}

type Marks = ReturnType<typeof markWords>;

/** An entry in the List: its picture or initials, name, what matched or its summary, where it is. */
const EntryRow = memo(function EntryRow({
  entity,
  presence,
  href,
  current,
  onOpen,
  onEnter,
  match,
  url,
  marks: words,
  w,
}: {
  entity: Entity;
  presence: EntryPresence | undefined;
  href: string;
  current: boolean;
  onOpen: (to: string, e?: MouseEvent) => Promise<void>;
  /** Enter on it: into the entry beside the list. */
  onEnter: (id: string) => void;
  match: ReturnType<typeof matchEntry> | undefined;
  /** Its picture's address. */
  url: string | undefined;
  /** Its type's words for how it's in a piece. */
  marks: Marks;
  w: Vocabulary;
}) {
  const shape = shapeForType(entity.type);
  const count = presence?.count ?? 0;
  const where = match && match.where !== "name" ? match : undefined;
  const second = where?.text ? (
    <>
      {where.text.slice(0, where.at![0])}
      <mark className="rounded-sm bg-accent-soft text-ink">{where.text.slice(...where.at!)}</mark>
      {where.text.slice(where.at![1])}
      <span className="text-muted"> · {where.where === "alias" ? "other name" : where.where}</span>
    </>
  ) : (
    entity.summary
  );
  return (
    <a
      href={href}
      onClick={(e) => void onOpen(href, e)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onEnter(entity.id);
      }}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-panel focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
        current && "bg-accent-soft shadow-[inset_2px_0_0_var(--color-accent)] hover:bg-accent-soft",
      )}
    >
      {url ? (
        // Decorative: the name beside it says who it is.
        <Picture src={url} alt="" decorative focus={entity.imageFocus} className={shape.key === "wide" ? "h-7 w-10 shrink-0 rounded" : "h-10 w-8 shrink-0 rounded"} />
      ) : (
        <span aria-hidden className={cn("grid shrink-0 place-items-center rounded bg-panel text-[11px] font-semibold text-muted", shape.key === "wide" ? "h-7 w-10" : "h-10 w-8")}>
          {initials(entity.name)}
        </span>
      )}
      <span className="grid min-w-0 flex-1">
        <span className="truncate font-semibold">{entity.name}</span>
        {second && <span className="truncate text-xs text-muted">{second}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <MiniStrip presence={presence} words={words} />
        <span className="text-[11px] whitespace-nowrap text-muted tabular-nums">{count === 0 ? "Not yet" : w.piece.count(count)}</span>
      </span>
    </a>
  );
});

/**
 * An entry in the Cards: what it is at a glance, opening its profile. A portrait sits beside the
 * name (its initials where there's none); a place's picture is a banner across the card.
 */
const EntryCard = memo(function EntryCard({
  entity,
  presence,
  href,
  current,
  onOpen,
  url,
  marks: words,
  w,
  book,
}: {
  entity: Entity;
  presence: EntryPresence | undefined;
  href: string;
  current: boolean;
  onOpen: (to: string, e?: MouseEvent) => Promise<void>;
  url: string | undefined;
  marks: Marks;
  w: Vocabulary;
  /** For the facts on the card: the type's fields, and the names of entries they name. */
  book: Book;
}) {
  const shape = shapeForType(entity.type);
  const count = presence?.count ?? 0;
  const n = presence?.scenes.length ?? 0;
  const facts = cardFacts(entity, book);
  return (
    <a
      href={href}
      onClick={(e) => void onOpen(href, e)}
      aria-current={current ? "page" : undefined}
      className={cn("grid content-start gap-2 rounded-lg border border-rule bg-raised px-4 py-3 hover:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none", current && "border-accent ring-1 ring-accent")}
    >
      {shape.key === "wide" ? (
        <>
          {url ? (
            <Picture src={url} alt={pictureAlt(shape, entity.name)} focus={entity.imageFocus} className="h-24 w-full rounded-md" />
          ) : (
            <span className="grid h-12 place-items-center rounded-md bg-panel text-[13px] text-muted">No picture yet</span>
          )}
          <span className="font-semibold">{entity.name}</span>
          {entity.summary && <span className="line-clamp-2 font-prose leading-snug">{entity.summary}</span>}
        </>
      ) : (
        <span className="flex items-start gap-3">
          {url ? (
            <Picture src={url} alt={pictureAlt(shape, entity.name)} focus={entity.imageFocus} className="h-[70px] w-14 shrink-0 rounded-md" />
          ) : (
            <span aria-hidden className="grid h-[70px] w-14 shrink-0 place-items-center rounded-md bg-panel text-lg font-semibold text-muted">
              {initials(entity.name)}
            </span>
          )}
          <span className="grid min-w-0 gap-1">
            <span className="font-semibold">{entity.name}</span>
            {entity.summary && <span className="line-clamp-2 font-prose leading-snug">{entity.summary}</span>}
          </span>
        </span>
      )}
      {facts.length > 0 && <span className="text-[13px] text-muted">{facts.join(" · ")}</span>}
      <span className="flex items-center gap-2.5">
        {n > 0 && (
          <span aria-hidden className="grid flex-1" style={{ gridTemplateColumns: `repeat(${Math.min(n, 60)}, minmax(0, 1fr))`, gap: n > 40 ? 0 : 2 }}>
            {stripMarks(presence, 60).map(({ title, mark }, i) => (
              <span key={i} title={`${title}: ${mark === "absent" ? "not there" : (words[mark] ?? words.present)}`} className={`h-2 rounded-[2px] ${MARK[mark]}`} />
            ))}
          </span>
        )}
        <span className="text-xs whitespace-nowrap text-muted">{count === 0 ? `Not in the ${w.content.one} yet` : w.piece.count(count)}</span>
      </span>
    </a>
  );
});

