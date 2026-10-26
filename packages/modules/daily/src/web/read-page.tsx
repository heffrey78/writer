import { useQueryClient } from "@tanstack/react-query";
import { countWords, vocabulary, type Piece } from "@writer/core";
import { useMemo, useState, type MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { api, keys } from "@writer/web/api.ts";
import type { BookView } from "@writer/web/modules.tsx";
import { BEGIN, type Run } from "@writer/web/novel/run.tsx";
import { WritingView } from "@writer/web/novel/writing-view.tsx";
import { cn } from "@writer/web/ui/cn.ts";
import { dayOf, entryOn, entryTitle, today, type Day } from "../core/index.ts";
import { entryHtml, longDate, newestFirst } from "./read.ts";

const number = new Intl.NumberFormat();
/** Reading (text only) or writing, remembered on the device. */
const READING = "writer:journal-reading";

/** The page's name: the Write section's is the journal's, "Journal". */
export const DAY_BY_DAY = "Day by day";

/**
 * The journal page (#64), as Logseq's Journals page is: today at the top, ready to type in (the entry
 * made with its first words), then every entry newest first, each written in where it's read. Each
 * time the page is come to (Today's entry, the book opened), the caret is in today's. A title opens
 * the entry alone; a name, while reading, its index entry. Reading shows the text only.
 */
export function ReadPage({ novelId, novel, workspace, spell, entries }: BookView) {
  const w = vocabulary(novel.kind);
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const run = useMemo(() => newestFirst(novel), [novel]);
  const days = useMemo(() => new Map(run.map(({ piece, day }) => [piece.id, day])), [run]);
  const [reading, setReading] = useState(() => remembered());
  const now = today();
  const todays = entryOn(novel, now);
  // Where today's place keeps its words until its entry's file has them.
  const todayKeep = `writer:today:${novelId}:${now}`;

  const toggle = () => {
    setReading(!reading);
    remember(!reading);
  };

  // Links in the text go through the app's router, not a page load (which, on Android, is the app's).
  const follow = (e: MouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (!href?.startsWith("/novels/") || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    void navigate(href);
  };

  const view: Run = {
    key: "journal",
    heading: DAY_BY_DAY,
    controls: (
      <button
        type="button"
        aria-pressed={reading}
        onClick={toggle}
        className={cn("rounded-md border border-rule px-2.5 py-1 text-sm", reading ? "bg-accent-soft text-ink" : "text-muted hover:text-ink")}
      >
        Reading
      </button>
    ),
    pieces: run.map(({ piece }) => piece),
    header: (piece, body) => <Header novelId={novelId} piece={piece} day={days.get(piece.id) ?? dayOf(piece)} words={countWords(body)} />,
    // entryHtml is micromark's safe output.
    preview: (_piece, body) => <div onClick={follow} className={PROSE} dangerouslySetInnerHTML={{ __html: entryHtml(body, novelId) }} />,
    reading,
    more: `Earlier ${w.piece.many}`,
    empty: (
      <p className="text-muted">
        No {w.piece.many} yet.{" "}
        {reading && (
          <button type="button" onClick={toggle} className="text-accent underline-offset-2 hover:underline">
            Write today's {w.piece.one}
          </button>
        )}
      </p>
    ),
    ...(todays
      ? {}
      : {
          begin: {
            label: `Write today's ${w.piece.one}`,
            header: <Header novelId={novelId} day={now} />,
            keep: todayKeep,
            make: async () => {
              const { id } = await api.module<{ id: string; made: boolean }>(novelId, "daily", "POST", "today", { day: now });
              // Not awaited: the place must know its piece before the run has it (Begin.make).
              void queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
              return id;
            },
          },
        }),
    ...(todays ? { begun: { id: todays.id, keep: todayKeep } } : {}),
    caret: { to: todays?.id ?? BEGIN, asked: location.key },
  };

  return <WritingView novelId={novelId} novel={novel} workspace={workspace} spell={spell} entries={entries} view={{ run: view }} />;
}

/** The text's look while reading, as the writing view's prose has it. */
const PROSE =
  "text-[length:var(--ghw-prose-size)] leading-[1.65] font-[family-name:var(--ghw-prose-font)] text-ink [&_a]:text-accent [&_a]:underline [&_a]:decoration-1 [&_a]:underline-offset-4 [&_img]:mx-auto [&_img]:my-4 [&_img]:max-w-full [&_p]:my-3";

/** An entry's title (opening it alone), its date and its words; or, over where today's begins, today's. */
function Header({ novelId, piece, day, words }: { novelId: string; piece?: Piece; day: Day | undefined; words?: number }) {
  return (
    <header className="grid gap-0.5 border-b border-rule pb-2">
      <h2 className="text-lg font-semibold">
        {piece ? (
          <Link to={`/novels/${novelId}/scene/${piece.id}`} className="underline-offset-2 hover:underline">
            {piece.title}
          </Link>
        ) : (
          day && entryTitle(day)
        )}
      </h2>
      <p className="text-xs text-muted">
        {day && <time dateTime={day}>{longDate(day)}</time>}
        {day && words !== undefined && " · "}
        {words !== undefined && `${number.format(words)} words`}
      </p>
    </header>
  );
}

function remembered(): boolean {
  try {
    return localStorage.getItem(READING) === "1";
  } catch {
    return false;
  }
}

function remember(reading: boolean): void {
  try {
    if (reading) localStorage.setItem(READING, "1");
    else localStorage.removeItem(READING);
  } catch {
    // Not remembered where storage is blocked.
  }
}
