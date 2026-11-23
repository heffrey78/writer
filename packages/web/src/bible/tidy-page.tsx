import { entryPresences, fieldLabel, tidyCounts, tidyReport, typePlural, vocabulary, type Book, type Entity, type NotName, type TidyCounts } from "@writer/core";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, keys } from "../api.ts";
import { useCommands } from "../commands.ts";
import { requestPassage } from "../novel/go-to-passage.ts";
import { useNotice } from "../novel/notice.tsx";
import type { Workspace } from "../novel/workspace.ts";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { PAGE } from "../ui/page.ts";
import { judgementOf, useNotAName } from "./not-names.ts";
import { markTidySeen, useNameReview } from "./tidy-state.ts";
import { useMergeDialog } from "./merge-dialog.tsx";

/*
 * Tidy up (#137, #172): what has drifted in the index, counted first, each count opening its list with
 * the fix beside each item. Names written without a link are linked all at once (one commit, undone as
 * one) or reviewed one by one in the writing view; a word that isn't the name is kept as Not a name
 * here. Entries that might be the same are merged, or judged different. Entries with
 * no summary get one where they're listed; entries never in the book, and fields left empty, open
 * their entry.
 */

type Show = keyof TidyCounts;

const SHOWS: Show[] = ["notLinked", "absent", "same", "noSummary", "emptyFields"];

export function TidyPage({ novelId, novel, workspace }: { novelId: string; novel: Book; workspace: Workspace }) {
  const w = vocabulary(novel.kind);
  const [params, setParams] = useSearchParams();
  const report = useMemo(() => tidyReport(novel, entryPresences(novel)), [novel]);
  const counts = tidyCounts(report);
  const show: Show = SHOWS.includes(params.get("show") as Show) ? (params.get("show") as Show) : "notLinked";
  const tabsId = useId();
  // Opened: what's here now is what the sidebar's dot compares with.
  useEffect(() => markTidySeen(novelId, counts), [novelId, counts.notLinked, counts.absent, counts.same, counts.noSummary, counts.emptyFields]); // eslint-disable-line react-hooks/exhaustive-deps

  const labels: Record<Show, string> = {
    notLinked: "Names not linked",
    absent: `Not in the ${w.content.one} yet`,
    same: "Might be the same",
    noSummary: "No summary",
    emptyFields: "Empty fields",
  };
  const choose = (s: Show) => setParams((p) => (s === "notLinked" ? (p.delete("show"), p) : (p.set("show", s), p)), { replace: true });
  // Each list, from the palette too (#178).
  useCommands(
    () => SHOWS.map((s) => ({ id: `tidy.${s}`, title: `Tidy up: ${labels[s]}`, group: w.codex.One, run: () => {
      choose(s);
      document.getElementById(`${tabsId}-${s}`)?.focus();
    }, isActive: () => show === s })),
    [show, w],
  );
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const to = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? SHOWS.length - 1 : undefined;
    if (to === undefined) return;
    e.preventDefault();
    const next = SHOWS[(to + SHOWS.length) % SHOWS.length]!;
    choose(next);
    document.getElementById(`${tabsId}-${next}`)?.focus();
  };

  return (
    <div className={cn(PAGE, "grid content-start gap-5")}>
      <div className="grid gap-1">
        <Link to={`/novels/${novelId}/bible`} className="flex items-center gap-1 justify-self-start rounded-md text-sm text-muted hover:text-ink">
          <ChevronLeft className="size-4" aria-hidden /> {w.codex.One}
        </Link>
        <h1 className="text-xl font-semibold">Tidy up the {w.codex.short}</h1>
        <p className="max-w-prose text-sm text-muted">What has drifted as the {w.book.one} grew, with the fix beside each.</p>
      </div>
      <div role="tablist" aria-label="What to tidy" className="flex flex-wrap gap-2">
        {SHOWS.map((s, i) => (
          <button
            key={s}
            id={`${tabsId}-${s}`}
            type="button"
            role="tab"
            aria-selected={show === s}
            aria-controls={`${tabsId}-panel`}
            tabIndex={show === s ? 0 : -1}
            onClick={() => choose(s)}
            onKeyDown={(e) => onTabKey(e, i)}
            className={cn(
              "grid min-w-36 gap-0.5 rounded-lg border px-3 py-2 text-left focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
              show === s ? "border-accent bg-accent-soft shadow-[inset_0_0_0_1px_var(--color-accent)]" : "border-rule bg-raised hover:border-accent",
            )}
          >
            <span className="text-xl font-semibold tabular-nums">{counts[s]}</span>
            <span className="text-xs text-muted">{labels[s]}</span>
          </button>
        ))}
      </div>
      <section id={`${tabsId}-panel`} role="tabpanel" tabIndex={-1} aria-labelledby={`${tabsId}-${show}`} className="grid gap-3 outline-none">
        {show === "notLinked" && <NamesNotLinked novelId={novelId} novel={novel} report={report} workspace={workspace} />}
        {show === "absent" && <Entries novelId={novelId} novel={novel} entries={report.absent} empty={`Every ${w.entity.one} is in the ${w.content.one}.`} />}
        {show === "same" && <MightBeTheSame novelId={novelId} novel={novel} pairs={report.same} />}
        {show === "noSummary" && <NoSummary novelId={novelId} novel={novel} entries={report.noSummary} />}
        {show === "emptyFields" && (
          <Entries novelId={novelId} novel={novel} entries={report.emptyFields.map((x) => x.entry)} empty="Every declared field is filled in." detail={(e) => `${report.emptyFields.find((x) => x.entry === e)!.fields.map(fieldLabel).join(", ")} empty`} />
        )}
      </section>
    </div>
  );
}

const fix = "shrink-0 rounded-md border border-rule px-2 py-0.5 text-xs hover:bg-panel focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none";

function EntryLink({ novelId, entry }: { novelId: string; entry: Entity }) {
  return (
    <Link to={`/novels/${novelId}/bible/${entry.id}`} className="font-semibold underline-offset-2 hover:underline">
      {entry.name}
    </Link>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

function NamesNotLinked({ novelId, novel, report, workspace }: { novelId: string; novel: Book; report: ReturnType<typeof tidyReport>; workspace: Workspace }) {
  const w = vocabulary(novel.kind);
  const queryClient = useQueryClient();
  const show = useNotice((n) => n.show);
  const navigate = useNavigate();
  const notAName = useNotAName(novelId, novel);
  const [open, setOpen] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });

  const linkAll = async (entry: Entity) => {
    setBusy(entry.id);
    try {
      // What's typed but not saved is saved first, so nothing is linked over words that aren't on disk yet.
      await workspace.autosave.flush();
      const done = await api.bible.linkNames(novelId, entry.id);
      await refresh();
      if (!done.commit) return show({ message: `Nothing to link: ${entry.name}'s names read differently now.` });
      const commit = done.commit;
      show({
        message: `Linked ${entry.name} in ${w.piece.count(done.files.length)}: ${done.linked} ${done.linked === 1 ? "place" : "places"}.`,
        action: { label: "Undo", run: () => void api.bible.undo(novelId, commit, done.files).then(refresh, () => show({ message: "They've changed since, so it wasn't undone." })) },
      });
    } catch (e) {
      show({ message: `It couldn't be linked: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(undefined);
    }
  };
  const review = (entry: Entity, passages: typeof report.notLinked[number]["passages"]) => {
    useNameReview.setState({ review: { novelId, entry: entry.id, passages, at: 0 } });
    const to = requestPassage(novelId, passages[0]!);
    void navigate(to ?? `/novels/${novelId}/scene/${passages[0]!.piece.id}`);
  };

  return (
    <>
      {report.notLinked.length === 0 ? (
        <Empty>Every name in the {w.content.one} is linked.</Empty>
      ) : (
        <ul aria-label="Names not linked" className="grid gap-2">
          {report.notLinked.map(({ entry, passages }) => (
            <li key={entry.id} className="grid gap-2 rounded-lg border border-rule bg-raised px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  <EntryLink novelId={novelId} entry={entry} /> <span className="text-sm text-muted">· {passages.length} not linked in {w.piece.count(new Set(passages.map((p) => p.piece.id)).size)}</span>
                </span>
                <Button size="sm" variant="primary" onClick={() => void linkAll(entry)} disabled={busy === entry.id} aria-label={`Link all ${passages.length} to ${entry.name}`}>
                  Link all
                </Button>
                <Button size="sm" onClick={() => review(entry, passages)} aria-label={`Review ${entry.name}'s ${passages.length} one by one`}>
                  Review one by one
                </Button>
                <Button size="sm" variant="ghost" aria-expanded={open === entry.id} onClick={() => setOpen(open === entry.id ? undefined : entry.id)}>
                  {open === entry.id ? "Hide them" : "Show them"}
                </Button>
              </div>
              {open === entry.id && (
                <ul aria-label={`${entry.name}'s names not linked`} className="grid gap-1">
                  {passages.map((p, i) => {
                    const j = judgementOf(p, entry.id);
                    return (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className="min-w-0 flex-1 font-prose">
                          <span className="font-ui text-xs text-muted">{p.piece.title} · </span>
                          {p.text.slice(0, p.at[0])}
                          <mark className="rounded-sm bg-warn-soft px-0.5 text-ink">{p.text.slice(...p.at)}</mark>
                          {p.text.slice(p.at[1])}
                        </span>
                        {j && (
                          <button type="button" onClick={() => void notAName(j, p.text.slice(...p.at))} aria-label={`“${p.text.slice(...p.at)}” in “${p.piece.title}” isn't ${entry.name}: not a name here`} className={cn(fix, "text-muted")}>
                            Not a name here
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {report.dormant.length > 0 && <Dormant novelId={novelId} novel={novel} judgements={report.dormant} />}
    </>
  );
}

/** "Not a name here" judgements whose word is gone from the text: dropped one by one. */
function Dormant({ novelId, novel, judgements }: { novelId: string; novel: Book; judgements: NotName[] }) {
  const queryClient = useQueryClient();
  const heading = useId();
  const drop = (n: NotName) => void api.bible.forgetNotAName(novelId, n).then(() => queryClient.invalidateQueries({ queryKey: keys.novel(novelId) }));
  return (
    <section aria-labelledby={heading} className="grid gap-2 border-t border-rule pt-3">
      <h2 id={heading} className="text-sm font-semibold">
        Not a name here, but the words are gone · {judgements.length}
      </h2>
      <p className="text-sm text-muted">Each sentence has been rewritten since: nothing is left out for it now.</p>
      <ul className="grid gap-1">
        {judgements.map((n, i) => {
          const name = novel.entities.find((e) => e.id === n.entry)?.name ?? n.entry;
          const piece = novel.allPieces.find((p) => p.id === n.piece)?.title ?? n.piece;
          return (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="min-w-0 flex-1">
                {name} in “{piece}”: <span className="font-prose text-muted">{n.sentence}</span>
              </span>
              <button type="button" onClick={() => drop(n)} aria-label={`Drop the judgement about ${name} in “${piece}”`} className={fix}>
                Drop
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Entries({ novelId, novel, entries, empty, detail }: { novelId: string; novel: Book; entries: Entity[]; empty: string; detail?: (e: Entity) => string }) {
  if (!entries.length) return <Empty>{empty}</Empty>;
  const typeOf = (e: Entity) => novel.entityTypes.find((t) => t.key === e.type);
  return (
    <ul className="grid gap-1">
      {entries.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1 hover:bg-panel">
          <span className="min-w-0 flex-1">
            <EntryLink novelId={novelId} entry={e} /> <span className="text-sm text-muted">· {typeOf(e)?.label ?? e.type}{detail ? ` · ${detail(e)}` : ""}</span>
          </span>
          <Link to={`/novels/${novelId}/bible/${e.id}`} className={fix} aria-label={`Open ${e.name}`}>
            Open
          </Link>
        </li>
      ))}
    </ul>
  );
}

function MightBeTheSame({ novelId, novel, pairs }: { novelId: string; novel: Book; pairs: ReturnType<typeof tidyReport>["same"] }) {
  const queryClient = useQueryClient();
  const show = useNotice((n) => n.show);
  if (!pairs.length) return <Empty>No two {vocabulary(novel.kind).entity.many} look alike.</Empty>;
  const different = async (a: Entity, b: Entity) => {
    try {
      await api.bible.areDifferent(novelId, a.id, b.id);
      await queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
      show({
        message: `${a.name} and ${b.name} are different: they won't be offered as the same again.`,
        action: { label: "Undo", run: () => void api.bible.forgetDifferent(novelId, a.id, b.id).then(() => queryClient.invalidateQueries({ queryKey: keys.novel(novelId) })) },
      });
    } catch (e) {
      show({ message: `It couldn't be kept: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
  return (
    <ul className="grid gap-1">
      {pairs.map(({ a, b, because }) => (
        <li key={`${a.id}|${b.id}`} className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1 hover:bg-panel">
          <span className="min-w-0 flex-1">
            <EntryLink novelId={novelId} entry={a} /> and <EntryLink novelId={novelId} entry={b} />{" "}
            <span className="text-sm text-muted">
              · {typePlural(novel.entityTypes.find((t) => t.key === a.type) ?? { label: a.type }).toLowerCase()} · {because}
            </span>
          </span>
          <button type="button" onClick={() => useMergeDialog.getState().open(b.id, a.id)} aria-label={`Merge ${a.name} and ${b.name}…`} className={fix}>
            Merge…
          </button>
          <button type="button" onClick={() => void different(a, b)} aria-label={`${a.name} and ${b.name} are different`} className={fix}>
            They're different
          </button>
        </li>
      ))}
    </ul>
  );
}

function NoSummary({ novelId, novel, entries }: { novelId: string; novel: Book; entries: Entity[] }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Record<string, string>>({});
  if (!entries.length) return <Empty>Every {vocabulary(novel.kind).entity.one} has a summary.</Empty>;
  const save = async (e: Entity) => {
    const summary = (text[e.id] ?? "").trim();
    if (!summary) return;
    try {
      const { hash } = await api.readFile(novelId, e.file);
      await api.bible.updateEntity(novelId, e.id, hash, { summary });
      await queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
    } catch (err) {
      setProblem((p) => ({ ...p, [e.id]: err instanceof Error ? err.message : String(err) }));
    }
  };
  return (
    <ul className="grid gap-2">
      {entries.map((e) => (
        <li key={e.id} className="grid gap-1">
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              void save(e);
            }}
          >
            <label htmlFor={`summary-${e.id}`} className="w-40 shrink-0 truncate font-semibold">
              {e.name}
            </label>
            <input
              id={`summary-${e.id}`}
              value={text[e.id] ?? ""}
              onChange={(ev) => setText((t) => ({ ...t, [e.id]: ev.target.value }))}
              placeholder="A line about who or what it is"
              aria-describedby={problem[e.id] ? `summary-${e.id}-problem` : undefined}
              className="h-8 min-w-48 flex-1 rounded-md border border-rule bg-raised px-2 text-sm"
            />
            <Button size="sm" type="submit" aria-label={`Save ${e.name}'s summary`}>
              Save
            </Button>
          </form>
          {problem[e.id] && (
            <p id={`summary-${e.id}-problem`} className="text-xs text-danger">
              {problem[e.id]}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
