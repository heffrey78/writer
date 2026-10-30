import { useNarrow } from "../narrow.ts";
import { arrangeSidebar, MANIFEST, vocabulary, type Book, type BookKind, type SidebarFile } from "@writer/core";
import { BookOpen, CircleDot, Columns2, Goal, ListTree, Map as MapIcon, Network, PanelLeftClose, PanelLeftOpen, PenLine, StickyNote, type LucideIcon } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useId, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import { create } from "zustand";
import { typePlural } from "@writer/core";
import { useCommands } from "../commands.ts";
import { moduleStoryMapTabs, moduleViews } from "../modules.tsx";
import { cn } from "../ui/cn.ts";
import { ManuscriptSidebar } from "./manuscript-tree.tsx";
import type { Workspace } from "./workspace.ts";

/*
 * The book's sidebar (heffrey78/gh-writer#136): Write (the manuscript), then the views grouped by what the author is
 * doing, as the book's kind groups them (#61): a novel's Plan (every view of the book and its world,
 * heffrey78/gh-writer#232) and Revise, a journal's Look back. It collapses to a strip of icons (Ctrl+\), remembered in this browser.
 */

const KEY = "ghw.sidebar";

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === "collapsed";
  } catch {
    return false;
  }
}

/** Whether Arrange the sidebar (#63, arrange-sidebar.tsx) is open: the app's, so it closes when its book does. */
export const useArrangeSidebar = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

export const useSidebar = create<{ collapsed: boolean; toggle: () => void }>((set, get) => ({
  collapsed: load(),
  toggle: () => {
    const collapsed = !get().collapsed;
    try {
      localStorage.setItem(KEY, collapsed ? "collapsed" : "expanded");
    } catch {
      // Not remembered where storage is blocked.
    }
    set({ collapsed });
  },
}));

export interface Place {
  /** Its key in a kind's sidebar and the writer's arrangement (#61). */
  key: string;
  path: string;
  label: string;
  icon: LucideIcon;
}

/** A group of the sidebar's pages: its key, its heading, its pages in order. */
export interface PlaceGroup {
  key: string;
  label: string;
  places: Place[];
}

/** The pages a kind's sidebar can name, by key: none where the page isn't there (Issues off GitHub). */
function pagesOf(onGitHub: boolean, kind: BookKind): Map<string, Omit<Place, "key"> | null> {
  return new Map<string, Omit<Place, "key"> | null>([
    ["outline", { path: "outline", label: "Outline", icon: ListTree }],
    ["story-map", moduleStoryMapTabs(kind).length ? { path: "story-map", label: "Story map", icon: MapIcon } : null],
    ["relationships", { path: "relationships", label: "Relationships", icon: Network }],
    ["notes", { path: "notes", label: "Notes", icon: StickyNote }],
    ["progress", { path: "progress", label: "Progress", icon: Goal }],
    ["index", { path: "bible", label: vocabulary(kind).codex.One, icon: BookOpen }],
    ["compare", { path: "compare", label: "Compare", icon: Columns2 }],
    ["issues", onGitHub ? { path: "issues", label: "Issues", icon: CircleDot } : null],
    ...moduleViews(kind).filter((v) => v.group).map(({ path, label, icon }): [string, Omit<Place, "key">] => [path, { path, label, icon }]),
  ]);
}

/** The path of the page a book of the kind opens on (#64), if it names one that's there. */
export const homeOf = (onGitHub: boolean, kind: BookKind): string | undefined => (kind.home ? pagesOf(onGitHub, kind).get(kind.home)?.path : undefined);

/**
 * The sidebar's pages by group (#61, #63): the kind's, with the writer's arrangement over it, and the
 * pages it doesn't show. The story map only with a tab from a module, Issues only for a book on
 * GitHub. A module's page neither names goes last in its module's group, or the first group where
 * the kind has none of that key.
 */
export function arrangement(onGitHub: boolean, kind: BookKind, mine?: SidebarFile): { groups: PlaceGroup[]; hidden: Place[] } {
  const views = moduleViews(kind).filter((v) => v.group);
  const pages = pagesOf(onGitHub, kind);
  const place = (key: string): Place[] => {
    const p = pages.get(key);
    return p ? [{ key, ...p }] : [];
  };
  const { groups: layout, hidden } = arrangeSidebar(kind, mine);
  const named = new Set([...layout.flatMap((g) => g.pages), ...hidden]);
  const groupOf = (moduleGroup: string) => layout.find((g) => g.key === moduleGroup.toLowerCase()) ?? layout[0];
  return {
    groups: layout.map((g) => ({
      key: g.key,
      label: g.label,
      places: [...g.pages, ...views.filter((v) => !named.has(v.path) && groupOf(v.group!) === g).map((v) => v.path)].flatMap(place),
    })),
    hidden: hidden.flatMap(place),
  };
}

/** The sidebar's groups as it shows them: a group left empty isn't shown. */
export const groups = (onGitHub: boolean, kind: BookKind, mine?: SidebarFile): PlaceGroup[] => arrangement(onGitHub, kind, mine).groups.filter((g) => g.places.length);

/** The writer's arrangement of a book's sidebar: book.yaml's, which a format 2 novel.yaml doesn't have (#63). */
export const arrangedBy = (novel: Book): SidebarFile | undefined => (novel.manifest === MANIFEST ? novel.config?.sidebar : undefined);

const SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘\\" : "Ctrl+\\";

export { useNarrow } from "../narrow.ts";

/** Collapse or expand with Ctrl+\ (⌘\ on a Mac), anywhere in the novel, and from the palette. */
function useToggleKey(toggle: () => void, collapsed: boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = /Mac/.test(navigator.platform) ? e.metaKey : e.ctrlKey;
      if (!mod || e.altKey || e.shiftKey || e.key !== "\\") return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [toggle]);
  useCommands(() => [{ id: "app.sidebar", title: collapsed ? "Expand the sidebar" : "Collapse the sidebar", group: "App", keys: "Mod-\\", run: toggle }], [collapsed, toggle]);
}

export function Sidebar({ novelId, novel, workspace, current, onGitHub }: { novelId: string; novel: Book; workspace: Workspace; current: string | undefined; onGitHub: boolean }) {
  const { collapsed, toggle } = useSidebar();
  // Too narrow for it beside the text: the strip, and the sidebar over the text (a dialog) when it's
  // opened, closed again by going somewhere, Escape or a click beside it.
  const narrow = useNarrow();
  const [drawer, setDrawer] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setDrawer(false), [pathname, narrow]);
  useToggleKey(narrow ? () => setDrawer((d) => !d) : toggle, narrow ? !drawer : collapsed);
  if (narrow)
    return (
      <>
        <Strip novelId={novelId} novel={novel} onGitHub={onGitHub} toggle={() => setDrawer(true)} />
        <Dialog.Root open={drawer} onOpenChange={setDrawer}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-30 bg-black/40" />
            <Dialog.Content aria-describedby={undefined} className="fixed inset-y-0 left-0 z-30 flex w-72 max-w-[85vw] flex-col text-ink shadow-xl [&>aside]:flex-1">
              <Dialog.Title className="sr-only">The sidebar</Dialog.Title>
              <Expanded novelId={novelId} novel={novel} workspace={workspace} current={current} onGitHub={onGitHub} toggle={() => setDrawer(false)} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </>
    );
  return collapsed ? (
    <Strip novelId={novelId} novel={novel} onGitHub={onGitHub} toggle={toggle} />
  ) : (
    <Expanded novelId={novelId} novel={novel} workspace={workspace} current={current} onGitHub={onGitHub} toggle={toggle} />
  );
}

function ToggleButton({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) {
  const label = collapsed ? "Expand the sidebar" : "Collapse the sidebar";
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <button type="button" onClick={toggle} aria-label={label} title={`${label} (${SHORTCUT})`} aria-keyshortcuts="Control+\" className="rounded-md p-1.5 text-muted hover:bg-paper hover:text-ink">
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

function Expanded({ novelId, novel, workspace, current, onGitHub, toggle }: { novelId: string; novel: Book; workspace: Workspace; current: string | undefined; onGitHub: boolean; toggle: () => void }) {
  const writeId = useId();
  return (
    <aside aria-label="Sidebar" className="flex min-h-0 flex-col border-rule bg-panel md:border-r">
      <section aria-labelledby={writeId} className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 px-3 pt-3">
          <Heading id={writeId}>Write</Heading>
          <ToggleButton collapsed={false} toggle={toggle} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          <ManuscriptSidebar novelId={novelId} novel={novel} workspace={workspace} current={current} />
        </div>
      </section>
      <nav aria-label="Views" className="grid shrink-0 gap-3 border-t border-rule px-3 py-3 text-sm">
        {groups(onGitHub, novel.kind, arrangedBy(novel)).map((g) => (
          <Group key={g.key} label={g.label}>
            {g.places.map((p) => (
              <li key={p.path}>
                <NavLink to={`/novels/${novelId}/${p.path}`} className={({ isActive }) => cn("flex items-center gap-2 rounded-md px-2 py-1 hover:bg-paper", isActive && "bg-accent-soft font-medium")}>
                  <p.icon className="size-4 shrink-0 text-muted" aria-hidden />
                  {p.label}
                </NavLink>
                {p.path === "bible" && (
                  <ul aria-label={`${vocabulary(novel.kind).codex.One} types`} className="mt-0.5 grid gap-0.5 pl-8 text-xs text-muted">
                    {novel.entityTypes.map((t) => (
                      <li key={t.key} className="flex justify-between pr-2">
                        <span>{typePlural(t)}</span>
                        <span className="tabular-nums">{novel.entities.filter((e) => e.type === t.key).length}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </Group>
        ))}
        <button type="button" onClick={() => useArrangeSidebar.getState().set(true)} className="justify-self-start rounded-md px-2 py-1 text-xs text-muted hover:bg-paper hover:text-ink">
          Arrange the sidebar…
        </button>
      </nav>
    </aside>
  );
}

function Heading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="px-2 text-xs font-semibold tracking-wide text-muted uppercase">
      {children}
    </h2>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="grid gap-1">
      <Heading id={id}>{label}</Heading>
      <ul className="grid gap-0.5">{children}</ul>
    </div>
  );
}

/** Collapsed: one icon per place, each named (for screen readers, and as a tooltip). */
function Strip({ novelId, novel, onGitHub, toggle }: { novelId: string; novel: Book; onGitHub: boolean; toggle: () => void }) {
  const { kind } = novel;
  const icon = (to: string, label: string, Icon: LucideIcon, end = false) => (
    <NavLink
      key={to}
      to={to}
      end={end}
      aria-label={label}
      title={label}
      className={({ isActive }) => cn("rounded-md p-2 text-muted hover:bg-paper hover:text-ink", isActive && "bg-accent-soft text-ink")}
    >
      <Icon className="size-4" aria-hidden />
    </NavLink>
  );
  const pages = groups(onGitHub, kind, arrangedBy(novel));
  // The book's own address opens its home page, so where that's in the strip it needs no second icon.
  const homeShown = pages.some((g) => g.places.some((p) => p.key === kind.home));
  return (
    <aside aria-label="Sidebar" className="flex flex-col items-center gap-1 border-rule bg-panel py-2 md:border-r">
      <ToggleButton collapsed toggle={toggle} />
      <nav aria-label="Views" className="flex flex-col items-center gap-1">
        {!homeShown && icon(`/novels/${novelId}`, vocabulary(kind).content.One, PenLine, true)}
        {pages.map((g) => (
          <div key={g.key} role="group" aria-label={g.label} className="flex flex-col items-center gap-1 border-t border-rule pt-1">
            {g.places.map((p) => icon(`/novels/${novelId}/${p.path}`, p.label, p.icon))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
