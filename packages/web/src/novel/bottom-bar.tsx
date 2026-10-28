import { barPages, vocabulary, type Book, type SidebarFile } from "@writer/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Command, History, LayoutGrid, ListOrdered, MinusCircle, PenLine, PlusCircle } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { create } from "zustand";
import { api, keys } from "../api.ts";
import { useKeyboardUp, useNarrow } from "../narrow.ts";
import { usePageMenu } from "../page-menu.ts";
import { useOverlay } from "../palette.tsx";
import { ErrorAlert } from "../ui/alert.tsx";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { Modal } from "../ui/dialog.tsx";
import { SheetHandle } from "../ui/sheet-handle.tsx";
import { useDrafts } from "./drafts.tsx";
import { useNotice } from "./notice.tsx";
import { arrangedBy, arrangement, type Place } from "./sidebar.tsx";

/*
 * A book on a phone (#100): no sidebar beside the text, but a bar at the bottom of the screen with
 * four of its pages and More. The first is where the book opens (a journal's journal page, a novel's
 * manuscript); the other three are the kind's (its `bar`), or the writer's (book.yaml's
 * `sidebar.bar`). More holds what the right sidebar has on a wide screen, for the piece being written,
 * then every page, and Drafts. The bar gives way to the keyboard, and the writing bar on top of it (#96);
 * with the text in hand but no keyboard up, the writing bar is just above it.
 */

export const useMoreSheet = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));
export const useArrangeBar = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

/** Every page a book can show, by key: the sidebar's and those it hides. */
function placesOf(onGitHub: boolean, novel: Book, mine?: SidebarFile): Map<string, Place> {
  const { groups, hidden } = arrangement(onGitHub, novel.kind, mine);
  return new Map([...groups.flatMap((g) => g.places), ...hidden].map((p) => [p.key, p]));
}

/** The bar's first page: where the book opens. A kind without a home page opens on its writing. */
function homeOf(novel: Book, places: Map<string, Place>): Place {
  const home = novel.kind.home ? places.get(novel.kind.home) : undefined;
  return home ?? { key: "write", path: "", label: vocabulary(novel.kind).content.One, icon: PenLine };
}

/** The bar's pages: where the book opens, then three. */
export function barOf(onGitHub: boolean, novel: Book, mine = arrangedBy(novel)): Place[] {
  const places = placesOf(onGitHub, novel, mine);
  const home = homeOf(novel, places);
  return [home, ...barPages(novel.kind, mine, home.key).flatMap((k) => places.get(k) ?? []).slice(0, 3)];
}

/** A page's name in the bar: the short one, where the kind has one ("Bible"). */
const short = (novel: Book, place: Place) => (place.key === "index" ? vocabulary(novel.kind).codex.Short : place.label);

/** Whether the book's bar is showing: on a phone, unless the keyboard's up (the writing bar is on top of it then). */
export function useBookBar(): boolean {
  const narrow = useNarrow();
  const keyboard = useKeyboardUp();
  return narrow && !keyboard;
}

export function BottomBar({ novelId, novel, onGitHub }: { novelId: string; novel: Book; onGitHub: boolean }) {
  const shown = useBookBar();
  const { pathname } = useLocation();
  if (!shown) return null;
  const pages = barOf(onGitHub, novel);
  return (
    <nav aria-label="Book" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-rule bg-raised px-1 pt-1.5 pb-3">
      {pages.map((p) => {
        const to = p.path ? `/novels/${novelId}/${p.path}` : `/novels/${novelId}`;
        // The manuscript is wherever its chapters and scenes are written.
        const writingHere = !p.path && /\/novels\/[^/]+\/(chapter|scene)\//.test(pathname);
        return (
          <NavLink key={p.key} to={to} end={!p.path} className={({ isActive }) => cn("grid justify-items-center gap-0.5 rounded-md py-0.5 text-xs", isActive || writingHere ? "font-semibold text-accent" : "text-muted")}>
            {({ isActive }) => (
              <>
                <span className={cn("grid h-8 w-14 place-items-center rounded-full", (isActive || writingHere) && "bg-accent-soft")}>
                  <p.icon className="size-5" aria-hidden />
                </span>
                <span className="max-w-full truncate px-0.5">{short(novel, p)}</span>
              </>
            )}
          </NavLink>
        );
      })}
      <button type="button" aria-haspopup="dialog" onClick={() => useMoreSheet.getState().set(true)} className="grid justify-items-center gap-0.5 rounded-md py-0.5 text-xs text-muted">
        <span className="grid h-8 w-14 place-items-center">
          <LayoutGrid className="size-5" aria-hidden />
        </span>
        More
      </button>
    </nav>
  );
}

/**
 * More, from the bar: what's at hand for the piece being written (its details, its notes, the open
 * entry), then every page in the kind's groups, then Arrange the bar… and Commands….
 */
export function MoreSheet({ novelId, novel, onGitHub }: { novelId: string; novel: Book; onGitHub: boolean }) {
  const { open, set } = useMoreSheet();
  const { items, heading } = usePageMenu();
  const { pathname } = useLocation();
  // Gone with the page: a sheet left open would cover the next.
  useEffect(() => set(false), [pathname, set]);
  const { groups } = arrangement(onGitHub, novel.kind, arrangedBy(novel));
  const places = placesOf(onGitHub, novel, arrangedBy(novel));
  const home = homeOf(novel, places);
  const close = () => set(false);
  const tile = "grid h-[4.75rem] place-items-center content-center gap-1.5 rounded-xl px-1 text-center text-xs";
  return (
    <Dialog.Root open={open} onOpenChange={set}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content aria-describedby={undefined} className="fixed inset-x-0 bottom-0 z-50 grid max-h-[85dvh] gap-4 overflow-y-auto rounded-t-2xl border-t border-rule bg-raised px-4 pt-0 pb-6 text-ink shadow-xl">
          <SheetHandle edge="bottom" onClose={close} />
          <Dialog.Title className="sr-only">{novel.config?.title ?? "Untitled"}: more</Dialog.Title>
          {items.length > 0 && (
            <section aria-label={heading} className="grid gap-2">
              <h2 className="text-base font-semibold">{heading}</h2>
              <div className="grid grid-cols-3 gap-1.5">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      close();
                      item.run();
                    }}
                    className="min-h-14 rounded-xl border border-rule px-2 text-sm font-medium"
                  >
                    {item.short ?? item.label}
                  </button>
                ))}
              </div>
            </section>
          )}
          <h2 className={cn("text-base font-semibold", items.length > 0 && "border-t border-rule pt-3")}>{novel.config?.title ?? "Untitled"}</h2>
          {[{ key: "home", label: "", places: home.path ? [] : [home] }, ...groups].map(
            (g) =>
              g.places.length > 0 && (
                <section key={g.key} aria-label={g.label || home.label} className="grid gap-1.5">
                  {g.label && <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{g.label}</h3>}
                  <div className="grid grid-cols-4 gap-1">
                    {g.places.map((p) => (
                      <NavLink key={p.key} to={p.path ? `/novels/${novelId}/${p.path}` : `/novels/${novelId}`} end={!p.path} onClick={close} className={({ isActive }) => cn(tile, isActive ? "bg-accent-soft font-semibold text-accent" : "bg-paper")}>
                        <p.icon className="size-6" aria-hidden />
                        {p.label}
                      </NavLink>
                    ))}
                  </div>
                </section>
              ),
          )}
          <div className="grid border-t border-rule pt-1">
            <button
              type="button"
              onClick={() => {
                close();
                useDrafts.getState().set(true);
              }}
              className="flex min-h-12 items-center gap-3 text-sm"
            >
              <History className="size-5 text-muted" aria-hidden /> Drafts and checkpoints…
            </button>
            <button
              type="button"
              onClick={() => {
                close();
                useArrangeBar.getState().set(true);
              }}
              className="flex min-h-12 items-center gap-3 text-sm"
            >
              <ListOrdered className="size-5 text-muted" aria-hidden /> Arrange the bar…
            </button>
            <button
              type="button"
              onClick={() => {
                close();
                useOverlay.getState().set("palette");
              }}
              className="flex min-h-12 items-center gap-3 text-sm"
            >
              <Command className="size-5 text-muted" aria-hidden /> Commands…
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Arrange the bar (#100): which three pages follow where the book opens, and in what order; the rest
 * are under More. Kept in book.yaml (`sidebar.bar`), so the bar is the same on every phone.
 */
export function ArrangeBar({ novelId, novel, onGitHub }: { novelId: string; novel: Book; onGitHub: boolean }) {
  const { open, set } = useArrangeBar();
  useEffect(() => () => set(false), [novelId, set]);
  if (!open) return null;
  return (
    <Modal title="Arrange the bar" onClose={() => set(false)} className="w-[min(30rem,calc(100vw-1.5rem))]">
      <Arranging novelId={novelId} novel={novel} onGitHub={onGitHub} close={() => set(false)} />
    </Modal>
  );
}

function Arranging({ novelId, novel, onGitHub, close }: { novelId: string; novel: Book; onGitHub: boolean; close: () => void }) {
  const queryClient = useQueryClient();
  const show = useNotice((s) => s.show);
  const mine = arrangedBy(novel);
  const places = placesOf(onGitHub, novel, mine);
  const home = homeOf(novel, places);
  const [bar, setBar] = useState(() => barOf(onGitHub, novel).slice(1).map((p) => p.key));
  const [said, setSaid] = useState("");
  const rest = [...places.keys()].filter((k) => k !== home.key && !bar.includes(k));
  const name = (key: string) => places.get(key)?.label ?? key;
  const move = (key: string, by: -1 | 1) => {
    const i = bar.indexOf(key);
    const next = [...bar];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    setBar(next);
    setSaid(`“${name(key)}” moved ${by < 0 ? "up" : "down"}.`);
  };
  const save = useMutation({
    mutationFn: (keys: string[] | undefined) => {
      const { bar: _, ...others } = mine ?? {};
      const file: SidebarFile = { ...others, ...(keys ? { bar: keys } : {}) };
      return api.setSidebar(novelId, Object.keys(file).length ? file : null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
      close();
      show({ message: "The bar is arranged as you put it." });
    },
  });
  const kinds = barOf(onGitHub, novel, { ...mine, bar: [] }).slice(1).map((p) => p.key);
  const row = "flex min-h-14 items-center gap-1 border-b border-rule pl-3 pr-1 last:border-b-0";
  const icon = "grid size-11 place-items-center rounded-md text-muted hover:bg-paper disabled:opacity-40";
  return (
    <>
      <p className="text-sm text-muted">Three pages after {home.label}, the rest under More. It's kept in the book, so the bar is the same on every phone.</p>
      <section aria-labelledby="in-bar" className="grid gap-1.5">
        <h3 id="in-bar" className="text-xs font-semibold tracking-wide text-muted uppercase">
          In the bar
        </h3>
        <ol className="rounded-xl border border-rule bg-paper">
          <li className={row}>
            <span className="grid flex-1">
              {home.label}
              <span className="text-xs text-muted">Where the book opens</span>
            </span>
          </li>
          {bar.map((key, i) => (
            <li key={key} className={row}>
              <span className="flex-1">{name(key)}</span>
              <button type="button" className={icon} aria-label={`Move “${name(key)}” up`} disabled={i === 0} onClick={() => move(key, -1)}>
                <ArrowUp className="size-5" aria-hidden />
              </button>
              <button type="button" className={icon} aria-label={`Move “${name(key)}” down`} disabled={i === bar.length - 1} onClick={() => move(key, 1)}>
                <ArrowDown className="size-5" aria-hidden />
              </button>
              <button
                type="button"
                className={icon}
                aria-label={`Take “${name(key)}” out of the bar`}
                onClick={() => {
                  setBar(bar.filter((k) => k !== key));
                  setSaid(`“${name(key)}” is under More.`);
                }}
              >
                <MinusCircle className="size-5" aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="under-more" className="grid gap-1.5">
        <h3 id="under-more" className="text-xs font-semibold tracking-wide text-muted uppercase">
          Under More
        </h3>
        <ul className="rounded-xl border border-rule bg-paper">
          {rest.map((key) => (
            <li key={key} className={row}>
              <span className="flex-1">{name(key)}</span>
              <button
                type="button"
                className={icon}
                aria-label={`Put “${name(key)}” in the bar`}
                disabled={bar.length >= 3}
                onClick={() => {
                  setBar([...bar, key]);
                  setSaid(`“${name(key)}” is in the bar, last.`);
                }}
              >
                <PlusCircle className="size-5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        {bar.length >= 3 && <p className="text-sm text-muted">The bar is full: take a page out to put another in.</p>}
      </section>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
      {save.error && <ErrorAlert title="Couldn't arrange the bar">{save.error.message}</ErrorAlert>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            setBar(kinds);
            setSaid(`Arranged as ${vocabulary(novel.kind).book.a}'s bar is. Save to keep it.`);
          }}
        >
          Back to the {vocabulary(novel.kind).book.one}'s own
        </Button>
        <div className="flex gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate(bar.join() === kinds.join() ? undefined : bar)}>
            Save
          </Button>
        </div>
      </div>
    </>
  );
}
