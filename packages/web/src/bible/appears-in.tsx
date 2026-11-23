import { entryPresence, passagesOf, sectionById, vocabulary, type Book, type Entity, type Passage, type PresenceMark } from "@writer/core";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { requestPassage } from "../novel/go-to-passage.ts";
import { useCurrentScene } from "../novel/current.ts";
import { useNotice } from "../novel/notice.tsx";
import type { Workspace } from "../novel/workspace.ts";
import { linkPassage } from "./link-passage.ts";
import { judgementOf, useNotAName } from "./not-names.ts";
import { cn } from "../ui/cn.ts";
import { ProfileSection } from "./profile.tsx";
import { markWords } from "./strip.tsx";

/*
 * Appears in (#135, #153): what the book says about an entry. Every passage that names it, linked or
 * written as plain words, grouped by piece in reading order, each saying the entry's role there as
 * the strip does. Chips narrow it to a role or to the names not linked; a passage opens its piece
 * with its sentence selected, and a name not linked is linked from here (#154).
 */

/** Shown at first; More shows the rest. */
const FIRST = 20;
/** Beside the text: the latest few up to the piece being written. */
const BESIDE = 5;

/** An entry's passages, worked out once per book; timed for the index's performance spec (#152). */
export function usePassages(novel: Book, id: string | undefined): Passage[] {
  return useMemo(() => {
    if (!id) return [];
    const start = performance.now();
    const passages = passagesOf(novel, id);
    try {
      performance.measure("passages", { start, detail: id });
    } catch {
      // Only a measurement.
    }
    return passages;
  }, [novel, id]);
}

type Show = "all" | "unlinked" | Exclude<PresenceMark, "absent">;
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function AppearsIn({
  novelId,
  novel,
  entity,
  workspace,
  passages,
  compact,
  id,
}: {
  novelId: string;
  novel: Book;
  entity: Entity;
  workspace: Workspace;
  passages: Passage[];
  compact?: boolean;
  id?: string;
}) {
  const w = vocabulary(novel.kind);
  const navigate = useNavigate();
  const current = useCurrentScene((s) => s.scene?.id);
  const [showing, setShowing] = useState<Show>("all");
  const [more, setMore] = useState(false);
  // Linked from here, until the book is read again with the mention in it.
  const [linked, setLinked] = useState<ReadonlySet<Passage>>(new Set());
  const show = useNotice((n) => n.show);
  const notAName = useNotAName(novelId, novel);
  // The book isn't read again for a change to a piece's words alone: what's linked from here counts at once.
  const isLinked = (p: Passage) => p.linked || linked.has(p);
  const open = (p: Passage) => {
    const to = requestPassage(novelId, p);
    if (to) void navigate(to);
  };
  const link = async (p: Passage) => {
    const words = p.text.slice(...p.at);
    const undo = await linkPassage(workspace, novel, p, entity.id);
    if (!undo) {
      show({ message: `“${words}” reads differently in “${p.piece.title}” now, so it wasn't linked. Link it in the text.`, action: { label: `Open “${p.piece.title}”`, run: () => open(p) } });
      return;
    }
    setLinked((s) => new Set(s).add(p));
    show({
      message: `Linked “${words}” to ${entity.name} in “${p.piece.title}”.`,
      action: {
        label: "Undo",
        run: () => {
          undo();
          setLinked((s) => {
            const next = new Set(s);
            next.delete(p);
            return next;
          });
          show({ message: `Unlinked “${words}” in “${p.piece.title}” again.` });
        },
      },
    });
  };
  const words = markWords(novel.kind, entity.type, w);
  // Its role in each piece, as the strip marks it: a name written without a link there counts as mentioned.
  const marks = useMemo(() => new Map(entryPresence(novel, entity.id)?.scenes.map((s) => [s.scene.id, s.mark === "absent" ? "mentioned" : s.mark] as const)), [novel, entity.id]);
  const markOf = (p: Passage) => marks.get(p.piece.id) ?? "mentioned";
  const said = (mark: Exclude<PresenceMark, "absent">) => words[mark] ?? words.present ?? mark;

  const chips: { show: Show; label: string; count: number }[] = [{ show: "all", label: "All", count: passages.length }];
  for (const mark of ["carries", "present", "mentioned"] as const) {
    const count = passages.filter((p) => markOf(p) === mark).length;
    if (count) chips.push({ show: mark, label: sentence(said(mark)), count });
  }
  const unlinked = passages.filter((p) => !isLinked(p)).length;
  if (unlinked) chips.push({ show: "unlinked", label: "Not linked", count: unlinked });
  const chosen = chips.some((c) => c.show === showing) ? showing : "all";

  let listed = chosen === "all" ? passages : passages.filter((p) => (chosen === "unlinked" ? !isLinked(p) : markOf(p) === chosen));
  let hidden = 0;
  const at = compact ? novel.pieces.findIndex((p) => p.id === current) : -1;
  if (compact) {
    // The latest up to the piece being written (all of them when none is).
    const before = at < 0 ? listed : listed.filter((p) => p.piece.position <= at);
    listed = before.slice(-BESIDE);
  } else if (!more && listed.length > FIRST) {
    hidden = listed.length - FIRST;
    listed = listed.slice(0, FIRST);
  }

  // By piece, in reading order.
  const groups: { piece: Passage["piece"]; passages: Passage[] }[] = [];
  for (const p of listed) {
    const last = groups.at(-1);
    if (last?.piece === p.piece) last.passages.push(p);
    else groups.push({ piece: p.piece, passages: [p] });
  }

  return (
    <ProfileSection title={`Appears in · ${passages.length}`} {...(id ? { id } : {})}>
      {passages.length === 0 ? (
        <p className="text-sm text-muted">
          No {w.piece.one} names {entity.name} yet{entity.aliases.length ? `, or ${entity.aliases.length === 1 ? "its other name" : "its other names"}` : ""}.
        </p>
      ) : (
        <>
          {at >= 0 && <p className="text-xs text-muted">The latest up to “{novel.pieces[at]!.title}”:</p>}
          {!compact && chips.length > 2 && (
            <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <button
                  key={c.show}
                  type="button"
                  aria-pressed={chosen === c.show}
                  onClick={() => {
                    setShowing(c.show);
                    setMore(false);
                  }}
                  className={cn(
                    "flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                    c.show === "unlinked" ? "border-warn/50 text-warn" : "border-rule text-muted hover:text-ink",
                    chosen === c.show && (c.show === "unlinked" ? "bg-warn-soft" : "border-accent bg-accent-soft text-accent"),
                  )}
                >
                  {c.label} · {c.count}
                </button>
              ))}
            </div>
          )}
          <ol aria-label={`Passages naming ${entity.name}`} className="grid gap-3">
            {groups.map((g) => {
              const section = sectionById(novel, g.piece.sectionId);
              const role = said(markOf(g.passages[0]!));
              return (
                <li key={g.piece.id} className="grid gap-1">
                  <p className="text-sm">
                    <Link to={`/novels/${novelId}/scene/${g.piece.id}`} className="font-medium underline-offset-2 hover:underline">
                      {g.piece.title}
                    </Link>
                    <span className="text-muted">
                      {section?.title ? ` · ${section.title}` : ""} · {role}
                    </span>
                  </p>
                  <ul className="grid gap-1">
                    {g.passages.map((p, i) => {
                      const linkedHere = isLinked(p);
                      return (
                        <li key={i} className="-mx-2 flex items-start gap-1">
                          <button
                            type="button"
                            onClick={() => open(p)}
                            onKeyDown={(e) => {
                              // Alt+Enter links it, as in the text.
                              if (e.key !== "Enter" || !e.altKey || linkedHere) return;
                              e.preventDefault();
                              void link(p);
                            }}
                            title={`Open “${g.piece.title}” at this passage${linkedHere ? "" : " (Alt+Enter links the name)"}`}
                            aria-keyshortcuts={linkedHere ? undefined : "Alt+Enter"}
                            className={cn(
                              "block min-w-0 flex-1 rounded-md border-l-2 px-2 py-1 text-left font-prose hover:bg-accent-soft/60 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                              linkedHere ? "border-rule" : "border-warn/60",
                              compact ? "text-sm" : "text-[15px] leading-snug",
                            )}
                          >
                            <span className="sr-only">
                              {g.piece.title}, {role}
                              {linkedHere ? "" : ", not linked"}:{" "}
                            </span>
                            {p.text.slice(0, p.at[0])}
                            <mark className={cn("rounded-sm px-0.5 text-ink", linkedHere ? "bg-accent-soft" : "bg-warn-soft underline decoration-warn decoration-dashed underline-offset-2")}>{p.text.slice(...p.at)}</mark>
                            {p.text.slice(p.at[1])}
                          </button>
                          {!linkedHere && (
                            <button
                              type="button"
                              onClick={() => void link(p)}
                              aria-label={`Link “${p.text.slice(...p.at)}” in “${g.piece.title}” to ${entity.name}`}
                              className="mt-0.5 shrink-0 rounded-md border border-warn/50 px-2 py-0.5 text-xs text-warn hover:bg-warn-soft focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                            >
                              Link it
                            </button>
                          )}
                          {!linkedHere && judgementOf(p, entity.id) && (
                            <button
                              type="button"
                              onClick={() => void notAName(judgementOf(p, entity.id)!, p.text.slice(...p.at))}
                              aria-label={`“${p.text.slice(...p.at)}” in “${g.piece.title}” isn't ${entity.name}: not a name here`}
                              title="Not a name here: stop offering it for linking"
                              className="mt-0.5 shrink-0 rounded-md border border-rule px-2 py-0.5 text-xs text-muted hover:bg-panel hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                            >
                              Not a name here
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ol>
          {hidden > 0 && (
            <button type="button" onClick={() => setMore(true)} className="justify-self-start text-sm text-accent underline decoration-accent/35 underline-offset-[3px] hover:decoration-accent">
              Show {hidden} more
            </button>
          )}
          {!compact && <p className="text-xs text-muted">Each passage opens its {w.piece.one} with its sentence selected.</p>}
        </>
      )}
    </ProfileSection>
  );
}
