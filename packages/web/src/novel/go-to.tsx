import { pieceSections, sectionById, vocabulary, type Book, type Section } from "@writer/core";
import { CalendarDays, ChevronDown, ChevronRight, ChevronUp, ListTree, Plus } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useId, useState } from "react";
import { Link, useLocation } from "react-router";
import { webModulesByIds } from "../modules.tsx";
import { cn } from "../ui/cn.ts";
import { SheetHandle } from "../ui/sheet-handle.tsx";
import { chapterTitle } from "./navigation.tsx";
import { arrangedBy, arrangement } from "./sidebar.tsx";
import { StructureDialogs, type StructureDialog } from "./structure-dialogs.tsx";
import { newSectionAtEnd, usableLevels, useStructure } from "./structure.ts";
import type { Workspace } from "./workspace.ts";

/*
 * On a phone (#100), the page's name in the top bar is a dropdown: Go to an entry, or a scene. A
 * search, what the book's modules offer from the shelf (Today's entry), then its sections folded (a
 * journal's months, newest first; a novel's chapters), the one being read open. Each section ends
 * with New for its pieces, and the list with New for the sections (#116), unless the kind's pieces
 * come from their dates.
 */

/** The page in view, by its address: its name, and the piece or section it's on. */
function pageOf(novelId: string, novel: Book, pathname: string, onGitHub: boolean): { name: string; section?: Section; piece?: string } {
  const rest = pathname.slice(`/novels/${novelId}/`.length);
  const [kind, id] = rest.split("/");
  if (kind === "chapter") {
    const section = sectionById(novel, id);
    return { name: section ? chapterTitle(novel, section) : "", ...(section ? { section } : {}) };
  }
  if (kind === "scene") {
    const piece = novel.allPieces.find((p) => p.id === id);
    const section = novel.allSections.find((s) => s.childIds.includes(id ?? ""));
    return { name: piece?.title ?? "", ...(section ? { section } : {}), ...(id ? { piece: id } : {}) };
  }
  const { groups, hidden } = arrangement(onGitHub, novel.kind, arrangedBy(novel));
  const place = [...groups.flatMap((g) => g.places), ...hidden].find((p) => rest === p.path || rest.startsWith(`${p.path}/`));
  if (place) return { name: place.label };
  // A note or an entry opens over its gallery.
  if (kind === "note") return { name: "Notes" };
  return { name: novel.config?.title ?? "Untitled" };
}

export function GoToButton({ novelId, novel, workspace, onGitHub }: { novelId: string; novel: Book; workspace: Workspace; onGitHub: boolean }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  const page = pageOf(novelId, novel, pathname, onGitHub);
  const title = novel.config?.title ?? "Untitled";
  const w = vocabulary(novel.kind);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" aria-label={`${page.name}, in ${title}: go to ${w.piece.a}`} className={cn("flex min-h-12 max-w-full min-w-0 items-center gap-1 rounded-md px-2 text-left text-lg font-semibold", open && "bg-accent-soft")}>
          <span className="truncate">{page.name}</span>
          {open ? <ChevronUp className="size-5 shrink-0" aria-hidden /> : <ChevronDown className="size-5 shrink-0" aria-hidden />}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content aria-describedby={undefined} className="fixed inset-x-0 top-0 z-50 grid max-h-[85dvh] gap-2 overflow-y-auto rounded-b-2xl border-b border-rule bg-raised px-4 pt-3 pb-1 text-ink shadow-xl">
          <GoTo novelId={novelId} novel={novel} workspace={workspace} onGitHub={onGitHub} current={page} />
          <SheetHandle edge="top" onClose={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function GoTo({ novelId, novel, workspace, onGitHub, current }: { novelId: string; novel: Book; workspace: Workspace; onGitHub: boolean; current: { section?: Section; piece?: string } }) {
  const w = vocabulary(novel.kind);
  const structure = useStructure(novelId, novel, workspace);
  const [dialog, setDialog] = useState<StructureDialog>();
  const adds = !novel.kind.piece.madeByDate;
  const searchId = useId();
  const [query, setQuery] = useState("");
  const sections = novel.kind.newestFirst ? [...pieceSections(novel)].reverse() : pieceSections(novel);
  // The one being read, else the newest of a journal's, else the first.
  const [opened, setOpened] = useState<string | undefined>(() => current.section?.id ?? sections[0]?.id);
  const pieces = (s: Section) => {
    const list = s.childIds.flatMap((id) => novel.allPieces.find((p) => p.id === id) ?? []);
    return novel.kind.newestFirst ? list.reverse() : list;
  };
  const q = query.trim().toLowerCase();
  const found = q ? novel.allPieces.filter((p) => p.title.toLowerCase().includes(q)) : [];
  const actions = webModulesByIds(novel.kind.modules ?? []).flatMap((m) => m.shelfActions ?? []);
  const { groups, hidden } = arrangement(onGitHub, novel.kind, arrangedBy(novel));
  const calendar = [...groups.flatMap((g) => g.places), ...hidden].find((p) => p.key === "calendar");
  const row = "flex min-h-12 items-center gap-3 rounded-lg px-2";
  const piece = (p: { id: string; title: string }) => (
    <li key={p.id}>
      <Link to={`/novels/${novelId}/scene/${p.id}`} aria-current={p.id === current.piece ? "page" : undefined} className={cn(row, p.id === current.piece && "bg-accent-soft font-semibold text-accent")}>
        <span className="truncate">{p.title}</span>
      </Link>
    </li>
  );
  return (
    <>
      <p className="truncate text-sm font-semibold">{novel.config?.title ?? "Untitled"}</p>
      <Dialog.Title asChild>
        <label htmlFor={searchId} className="text-sm font-semibold text-muted">
          Go to {w.piece.a}
        </label>
      </Dialog.Title>
      <input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="A title or a word in it" className="h-11 rounded-lg border border-rule bg-paper px-3 text-base" />
      {actions.map((a) => (
        <Link key={a.command} to={`/novels/${novelId}/${a.path}`} className={cn(row, "font-semibold text-accent")}>
          {a.label}
        </Link>
      ))}
      {q ? (
        <ul aria-label={`${w.piece.Many} found`} className="grid">
          {found.length ? found.map(piece) : <li className="px-2 py-3 text-sm text-muted">No {w.piece.one} has “{query.trim()}” in its title.</li>}
        </ul>
      ) : (
        <ul aria-label={w.content.One} className="grid border-t border-rule">
          {sections.map((s) => {
            const open = opened === s.id;
            const list = pieces(s);
            return (
              <li key={s.id} className="border-b border-rule last:border-b-0">
                <button type="button" aria-expanded={open} onClick={() => setOpened(open ? undefined : s.id)} className={cn(row, "w-full text-left")}>
                  {open ? <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden /> : <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />}
                  <span className="flex-1 truncate font-semibold">{chapterTitle(novel, s)}</span>
                  <span className="text-sm text-muted">{w.piece.count(list.length)}</span>
                </button>
                {open && (
                  <ul className="grid pb-1 pl-7">
                    {list.map(piece)}
                    {adds && (
                      <li>
                        <button type="button" aria-label={`New ${w.piece.one} in ${chapterTitle(novel, s)}`} onClick={() => setDialog({ kind: "new-scene", chapter: s.id })} className={cn(row, "w-full text-left text-accent")}>
                          <Plus className="size-4 shrink-0" aria-hidden /> New {w.piece.one}
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {adds &&
        !q &&
        usableLevels(novel)
          .filter(({ disabled }) => !disabled)
          .map(({ level }) => (
            <button key={level.key} type="button" onClick={() => setDialog({ kind: "new-section", level, ...newSectionAtEnd(novel, level) })} className={cn(row, "w-full text-left text-accent")}>
              <Plus className="size-5 shrink-0" aria-hidden /> New {w.level(level.key).one}
            </button>
          ))}
      <Link to={`/novels/${novelId}/${calendar ? calendar.path : "outline"}`} className={cn(row, "border-t border-rule text-accent")}>
        {calendar ? <CalendarDays className="size-5" aria-hidden /> : <ListTree className="size-5" aria-hidden />}
        {calendar ? "Pick a day on the calendar" : "The whole outline"}
      </Link>
      {dialog && <StructureDialogs novelId={novelId} novel={novel} structure={structure} dialog={dialog} onClose={() => setDialog(undefined)} />}
    </>
  );
}
