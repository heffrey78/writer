import { sidebarOf, vocabulary, type Book, type SidebarFile } from "@writer/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Eye, EyeOff } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { api, keys } from "../api.ts";
import { ErrorAlert } from "../ui/alert.tsx";
import { Button } from "../ui/button.tsx";
import { Modal } from "../ui/dialog.tsx";
import { useNotice } from "./notice.tsx";
import { arrangedBy, arrangement, useArrangeSidebar, type Place } from "./sidebar.tsx";

/*
 * Arrange the sidebar (#63): the writer moves the sidebar's pages, between its groups too, and hides
 * some, from the sidebar, the ⋯ menu or the palette. Saved in book.yaml in one commit, so the sidebar
 * is the same wherever the book syncs; hidden pages are still in the palette.
 */

interface Arranged {
  groups: { key: string; label: string; pages: string[] }[];
  hidden: string[];
}

/** Every page as the dialog lists it: on GitHub or not, so a page's place is kept while the book isn't. */
const listed = (novel: Book, mine?: SidebarFile) => arrangement(true, novel.kind, mine);
const asArranged = ({ groups, hidden }: ReturnType<typeof listed>): Arranged => ({ groups: groups.map((g) => ({ key: g.key, label: g.label, pages: g.places.map((p) => p.key) })), hidden: hidden.map((p) => p.key) });
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

/**
 * What's saved: nothing when it's the kind's arrangement; else each group's pages, and those hidden
 * that the kind would show. A phone's bar, arranged on its own (#100), is kept as it is.
 */
function toFile(novel: Book, arranged: Arranged): SidebarFile | null {
  const kinds = asArranged(listed(novel));
  const bar = arrangedBy(novel)?.bar;
  const kept = bar ? { bar } : {};
  if (kinds.groups.every((g, i) => same(g.pages, arranged.groups[i]!.pages)) && same([...kinds.hidden].sort(), [...arranged.hidden].sort())) return bar ? kept : null;
  const shownByKind = new Set(kinds.groups.flatMap((g) => g.pages));
  const hidden = arranged.hidden.filter((k) => shownByKind.has(k));
  return { groups: Object.fromEntries(arranged.groups.map((g) => [g.key, g.pages])), ...(hidden.length ? { hidden } : {}), ...kept };
}

export function ArrangeSidebar({ novelId, novel, onGitHub, onNewFormat }: { novelId: string; novel: Book; onGitHub: boolean; onNewFormat: (() => void) | undefined }) {
  const { open, set } = useArrangeSidebar();
  useEffect(() => () => set(false), [novelId, set]);
  if (!open) return null;
  return (
    <Modal title="Arrange the sidebar" onClose={() => set(false)} className="w-[min(32rem,calc(100vw-2rem))]">
      {onNewFormat ? (
        <>
          <p className="text-sm text-muted">The sidebar's arrangement is kept in the book's settings, which this book has in gh-writer's format. Move it to the new format first.</p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => set(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                set(false);
                onNewFormat();
              }}
            >
              Move to the new format…
            </Button>
          </div>
        </>
      ) : (
        <Arranging novelId={novelId} novel={novel} onGitHub={onGitHub} close={() => set(false)} />
      )}
    </Modal>
  );
}

function Arranging({ novelId, novel, onGitHub, close }: { novelId: string; novel: Book; onGitHub: boolean; close: () => void }) {
  const queryClient = useQueryClient();
  const show = useNotice((n) => n.show);
  const [arranged, setArranged] = useState(() => asArranged(listed(novel, arrangedBy(novel))));
  const [said, setSaid] = useState("");
  const [focus, setFocus] = useState<string>();
  const list = useRef<HTMLDivElement>(null);
  const places = new Map<string, Place>(((a) => [...a.groups.flatMap((g) => g.places), ...a.hidden])(listed(novel)).map((p) => [p.key, p]));
  const name = (key: string) => places.get(key)?.label ?? key;

  // Focus follows the page moved: the same button, else the other way, else whichever it has.
  useLayoutEffect(() => {
    if (!focus) return;
    const [key] = focus.split(":");
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>(`[data-page="${key}"] button`) ?? [])].filter((b) => !b.disabled);
    (buttons.find((b) => b.dataset.action === focus.split(":")[1]) ?? buttons[0])?.focus();
    setFocus(undefined);
  }, [focus]);

  const move = (key: string, by: -1 | 1) => {
    const groups = arranged.groups.map((g) => ({ ...g, pages: [...g.pages] }));
    const gi = groups.findIndex((g) => g.pages.includes(key));
    const group = groups[gi]!;
    const i = group.pages.indexOf(key);
    let into = group;
    if (i + by >= 0 && i + by < group.pages.length) [group.pages[i], group.pages[i + by]] = [group.pages[i + by]!, key];
    else {
      into = groups[gi + by]!;
      group.pages.splice(i, 1);
      if (by < 0) into.pages.push(key);
      else into.pages.unshift(key);
    }
    setArranged({ ...arranged, groups });
    setSaid(into === group ? `“${name(key)}” moved ${by < 0 ? "up" : "down"}: ${into.pages.indexOf(key) + 1} of ${into.pages.length} in ${into.label}.` : `“${name(key)}” moved to ${into.label}.`);
    setFocus(`${key}:${by < 0 ? "up" : "down"}`);
  };
  const hide = (key: string) => {
    setArranged({ groups: arranged.groups.map((g) => ({ ...g, pages: g.pages.filter((p) => p !== key) })), hidden: [...arranged.hidden, key] });
    setSaid(`“${name(key)}” hidden. It's still in the palette.`);
    setFocus(`${key}:show`);
  };
  const unhide = (key: string) => {
    // Back in the group the kind puts it in, last; else the first.
    const home = sidebarOf(novel.kind).find((g) => g.pages.includes(key))?.key ?? arranged.groups[0]!.key;
    const groups = arranged.groups.map((g) => (g.key === home ? { ...g, pages: [...g.pages, key] } : g));
    setArranged({ groups, hidden: arranged.hidden.filter((p) => p !== key) });
    setSaid(`“${name(key)}” shown, last in ${groups.find((g) => g.key === home)!.label}.`);
    setFocus(`${key}:hide`);
  };

  const save = useMutation({
    mutationFn: (file: SidebarFile | null) => api.setSidebar(novelId, file),
    onSuccess: async (_, file) => {
      await queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
      close();
      show({ message: file ? "The sidebar is arranged as you put it." : `The sidebar is arranged as ${vocabulary(novel.kind).book.a}'s is.` });
    },
  });

  const flat = arranged.groups.flatMap((g) => g.pages);
  const hiddenId = useId();
  return (
    <>
      <p className="text-sm text-muted">Put the pages you use first, and hide the rest: hidden pages are still in the palette, under Go to. The arrangement is kept in the book, so the sidebar is the same wherever it syncs.</p>
      <div ref={list} className="grid gap-4">
        {arranged.groups.map((g) => (
          <Section key={g.key} label={g.label}>
            {g.pages.length ? (
              <ol className="grid gap-1">
                {g.pages.map((key) => (
                  <Row key={key} place={places.get(key)} name={name(key)} pageKey={key} note={key === "issues" && !onGitHub ? "once the book is on GitHub" : undefined}>
                    <Icon action="up" label={`Move “${name(key)}” up`} disabled={flat[0] === key} onClick={() => move(key, -1)}>
                      <ArrowUp className="size-4" aria-hidden />
                    </Icon>
                    <Icon action="down" label={`Move “${name(key)}” down`} disabled={flat.at(-1) === key} onClick={() => move(key, 1)}>
                      <ArrowDown className="size-4" aria-hidden />
                    </Icon>
                    <Icon action="hide" label={`Hide “${name(key)}”`} onClick={() => hide(key)}>
                      <EyeOff className="size-4" aria-hidden />
                    </Icon>
                  </Row>
                ))}
              </ol>
            ) : (
              <p className="px-2 text-sm text-muted">Nothing here: move a page in, or show a hidden one.</p>
            )}
          </Section>
        ))}
        <section aria-labelledby={hiddenId} className="grid gap-1">
          <h3 id={hiddenId} className="text-xs font-semibold tracking-wide text-muted uppercase">
            Hidden
          </h3>
          {arranged.hidden.length ? (
            <ul className="grid gap-1">
              {arranged.hidden.map((key) => (
                <Row key={key} place={places.get(key)} name={name(key)} pageKey={key}>
                  <Icon action="show" label={`Show “${name(key)}”`} onClick={() => unhide(key)}>
                    <Eye className="size-4" aria-hidden />
                  </Icon>
                </Row>
              ))}
            </ul>
          ) : (
            <p className="px-2 text-sm text-muted">Nothing hidden.</p>
          )}
        </section>
      </div>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
      {save.error && <ErrorAlert title="Couldn't arrange the sidebar">{save.error.message}</ErrorAlert>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            setArranged(asArranged(listed(novel)));
            setSaid(`Arranged as ${vocabulary(novel.kind).book.a}'s sidebar is. Save to keep it.`);
          }}
        >
          Back to the {vocabulary(novel.kind).book.one}'s
        </Button>
        <div className="flex gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate(toFile(novel, arranged))}>
            Save
          </Button>
        </div>
      </div>
    </>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-1">
      <h3 id={id} className="text-xs font-semibold tracking-wide text-muted uppercase">
        {label}
      </h3>
      {children}
    </section>
  );
}

function Row({ place, name, pageKey, note, children }: { place: Place | undefined; name: string; pageKey: string; note?: string | undefined; children: ReactNode }) {
  const Glyph = place?.icon;
  return (
    <li data-page={pageKey} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-panel">
      {Glyph && <Glyph className="size-4 shrink-0 text-muted" aria-hidden />}
      <span className="flex-1 text-sm">
        {name}
        {note && <span className="text-muted"> ({note})</span>}
      </span>
      {children}
    </li>
  );
}

function Icon({ action, label, onClick, disabled, children }: { action: string; label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" data-action={action} aria-label={label} title={label} disabled={disabled} onClick={onClick} className="rounded-md p-1.5 text-muted hover:bg-paper hover:text-ink disabled:opacity-40">
      {children}
    </button>
  );
}
