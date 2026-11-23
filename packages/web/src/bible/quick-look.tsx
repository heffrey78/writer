import { entityOfLabel, matchEntry, vocabulary, type Book, type Entity } from "@writer/core";
import { Command as Cmdk } from "cmdk";
import { Dialog } from "radix-ui";
import { Fragment, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { create } from "zustand";
import { useCommands } from "../commands.ts";
import { useGitHubRepo } from "../github/repo.ts";
import { useIssueList } from "../issues/use-issues.ts";
import { moduleProfileSections } from "../modules.tsx";
import { useCurrentScene } from "../novel/current.ts";
import type { Workspace } from "../novel/workspace.ts";
import { markFocus, returnFocus, type FocusMark } from "../ui/focus.ts";
import { Picture, usePictureUrl } from "./picture.tsx";
import { pictureAlt, shapeForType } from "./pictures.ts";
import { setPinned } from "./pins.ts";
import { useRecentEntries } from "./recent.ts";
import { cardFacts, initials } from "./types.ts";

/*
 * Quick look (#141, #174): any entry over any page with one key, and back to the cursor with Escape.
 * A few letters find it (names and other names first, then anything it says); the highlighted one's
 * profile shows beside the list, compact, its facts as they are at the piece being written. Enter pins
 * it in the In this piece list; Ctrl+Enter opens it in the index. Nothing in the page changes.
 */

/** Its key: Ctrl+; on every platform (⌘; checks spelling in macOS's text views). */
export const QUICK_LOOK_KEYS = "Ctrl-;";

/** Where the focus and the caret were when it opened. */
let returnTo: FocusMark = { element: null, range: null };

export const useQuickLook = create<{ open: boolean }>(() => ({ open: false }));

/** Open it, to come back to the focus and the caret as they are now. */
export function openQuickLook(): void {
  if (useQuickLook.getState().open) return;
  returnTo = markFocus();
  useQuickLook.setState({ open: true });
}

/** How few results it lists: enough to scan, few enough to draw at once. */
const MOST = 30;

export function QuickLook({ novelId, novel, workspace }: { novelId: string; novel: Book; workspace: Workspace }) {
  const open = useQuickLook((s) => s.open);
  const w = vocabulary(novel.kind);
  const navigate = useNavigate();
  const recent = useRecentEntries(novelId);
  const [search, setSearch] = useState("");
  const [value, setValue] = useState("");
  const query = useDeferredValue(search);
  // What happens as it closes: back to the cursor, or on to the index (its own focus).
  const [then, setThen] = useState<"back" | "index">("back");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.key !== ";") return;
      e.preventDefault();
      e.stopPropagation();
      if (useQuickLook.getState().open) useQuickLook.setState({ open: false });
      else openQuickLook();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  useCommands(() => [{ id: "index.quickLook", title: `Quick look: any ${w.entity.one}`, group: w.codex.One, keys: QUICK_LOOK_KEYS, keywords: ["look up", "find", "who", "lookup", "peek"], run: openQuickLook }], [w]);
  // Opened afresh: empty, and the cursor to go back to.
  useEffect(() => {
    if (!open) setSearch("");
    else setThen("back");
  }, [open]);

  const results = useMemo(() => {
    if (!query.trim()) {
      const byId = new Map(novel.entities.map((e) => [e.id, e]));
      const first = recent.flatMap((id) => byId.get(id) ?? []);
      return [...first, ...[...novel.entities].sort((a, b) => a.name.localeCompare(b.name)).filter((e) => !first.includes(e))].slice(0, MOST);
    }
    // Names and other names first (a name starting with it before one containing it), then anything else it says.
    const q = query.trim().toLowerCase();
    const named = (e: Entity) => [e.name, ...e.aliases].map((n) => n.toLowerCase());
    return novel.entities
      .flatMap((e) => {
        const m = matchEntry(e, query, { book: novel });
        if (!m) return [];
        const rank = named(e).some((n) => n.startsWith(q) || n.split(/\s+/).some((x) => x.startsWith(q))) ? 0 : m.where === "name" || m.where === "alias" ? 1 : 2 + m.rank;
        return [{ e, rank }];
      })
      .sort((a, b) => a.rank - b.rank || a.e.name.localeCompare(b.e.name))
      .slice(0, MOST)
      .map((x) => x.e);
  }, [novel, query, recent]);
  const shown = results.find((e) => e.id === value) ?? results[0];

  const close = (how: "back" | "index") => {
    setThen(how);
    useQuickLook.setState({ open: false });
  };
  const pin = (e: Entity) => {
    setPinned(novelId, e.id, true);
    close("back");
  };
  const toIndex = (e: Entity) => {
    close("index");
    void navigate(`/novels/${novelId}/bible/${e.id}`, { state: { focusEntry: true } });
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close("back")}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/30" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (then === "back") returnFocus(returnTo, () => document.querySelector<HTMLElement>(".ghw-prose") ?? document.getElementById("main"));
          }}
          className="fixed top-[10vh] left-1/2 z-[70] grid w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-lg border border-rule bg-raised text-ink shadow-2xl max-md:inset-0 max-md:top-0 max-md:w-full max-md:translate-x-0 max-md:rounded-none"
        >
          <Dialog.Title className="sr-only">Quick look</Dialog.Title>
          <Cmdk label={`Quick look: find ${w.entity.a}`} shouldFilter={false} value={shown?.id ?? ""} onValueChange={setValue} loop>
            <Cmdk.Input
              value={search}
              onValueChange={setSearch}
              placeholder={`Find ${w.entity.a} by name, or anything it says…`}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !shown) return;
                e.preventDefault();
                if (e.ctrlKey || e.metaKey) toIndex(shown);
                else pin(shown);
              }}
              className="h-12 w-full border-b border-rule bg-transparent px-4 text-base outline-none placeholder:text-muted"
            />
            <div className="grid md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
              <Cmdk.List label={`${w.entity.Many} found`} className="max-h-[min(60vh,26rem)] overflow-y-auto border-rule p-2 max-md:max-h-[35dvh] max-md:border-b md:border-r">
                <Cmdk.Empty className="px-3 py-6 text-center text-sm text-muted">No {w.entity.one} says that</Cmdk.Empty>
                {results.map((e) => (
                  <Cmdk.Item key={e.id} value={e.id} onSelect={() => pin(e)} className="group flex cursor-pointer items-baseline justify-between gap-2 rounded-md px-3 py-1.5 text-sm data-[selected=true]:bg-accent-soft">
                    <span className="truncate">{e.name}</span>
                    <span className="shrink-0 text-xs text-muted group-data-[selected=true]:text-ink">{novel.entityTypes.find((t) => t.key === e.type)?.label}</span>
                  </Cmdk.Item>
                ))}
              </Cmdk.List>
              <div className="max-h-[min(60vh,26rem)] overflow-y-auto p-4 max-md:max-h-none">{shown && <Glance key={shown.id} novelId={novelId} novel={novel} workspace={workspace} entity={shown} />}</div>
            </div>
            {/* The highlighted entry, said as the highlight moves. */}
            <p aria-live="polite" className="sr-only">
              {shown ? `${shown.name}, ${novel.entityTypes.find((t) => t.key === shown.type)?.label ?? ""}. ${shown.summary ?? ""}` : ""}
            </p>
            <p className="border-t border-rule px-4 py-1.5 text-xs text-muted">Enter pins it beside the text · Ctrl+Enter opens it in the {w.codex.short} · Esc goes back</p>
          </Cmdk>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The entry at a glance: picture, name, type, summary, its facts at the piece being written, open issues, and what modules add. */
function Glance({ novelId, novel, workspace, entity }: { novelId: string; novel: Book; workspace: Workspace; entity: Entity }) {
  const type = novel.entityTypes.find((t) => t.key === entity.type);
  const shape = shapeForType(entity.type);
  const picture = usePictureUrl(novelId, entity.image);
  const at = useCurrentScene((s) => s.scene?.id);
  const facts = cardFacts(entity, novel, at);
  const repo = useGitHubRepo(novelId);
  const issues = useIssueList(novelId, { state: "open" }, { enabled: !!repo }).data;
  const label = issues?.labels.find((l) => entityOfLabel(novel, l)?.id === entity.id);
  const open = label ? (issues?.issues ?? []).filter((i) => i.labels.includes(label.name)).length : 0;
  return (
    <article aria-label={entity.name} className="grid content-start gap-3">
      <div className="flex items-start gap-3">
        {picture ? (
          <Picture src={picture} alt={pictureAlt(shape, entity.name)} focus={entity.imageFocus} className={shape.key === "wide" ? "h-14 w-20 shrink-0 rounded-md" : "h-[70px] w-14 shrink-0 rounded-md"} />
        ) : (
          <span aria-hidden className="grid h-[70px] w-14 shrink-0 place-items-center rounded-md bg-panel text-lg font-semibold text-muted">
            {initials(entity.name)}
          </span>
        )}
        <div className="grid min-w-0 gap-0.5">
          <h2 className="text-lg font-semibold">{entity.name}</h2>
          <p className="text-sm text-muted">
            {type?.label ?? entity.type}
            {entity.aliases.length > 0 && ` · also ${entity.aliases.join(", ")}`}
          </p>
        </div>
      </div>
      {entity.summary && <p className="font-prose leading-snug">{entity.summary}</p>}
      {facts.length > 0 && <p className="text-sm text-muted">{facts.join(" · ")}</p>}
      {entity.tags.length > 0 && <p className="text-xs text-muted">{entity.tags.join(", ")}</p>}
      {open > 0 && (
        <p className="text-sm">
          {open} open {open === 1 ? "issue" : "issues"}
        </p>
      )}
      {moduleProfileSections(novel.kind, entity.type).map((s, i) => (
        <Fragment key={i}>{s.render({ novelId, novel, workspace, entity })}</Fragment>
      ))}
    </article>
  );
}
