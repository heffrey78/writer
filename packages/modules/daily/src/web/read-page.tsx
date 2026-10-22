import { countWords, vocabulary, type Book } from "@writer/core";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useStore } from "zustand";
import type { Workspace } from "@writer/web/novel/workspace.ts";
import { Button } from "@writer/web/ui/button.tsx";
import { cn } from "@writer/web/ui/cn.ts";
import { PAGE } from "@writer/web/ui/page.ts";
import { entryHtml, longDate, newestFirst } from "./read.ts";

/** How many entries show at first, and how many more each time the reader reaches the end. */
const BATCH = 10;
const number = new Intl.NumberFormat();

/**
 * The journal read back (#5): every entry's text, newest first, as a blog shows its posts. More come
 * as the reader reaches the end. An entry's title opens it to write in; a name in it opens its index
 * entry.
 */
export function ReadPage({ novelId, novel, workspace }: { novelId: string; novel: Book; workspace: Workspace }) {
  const w = vocabulary(novel.kind);
  const entries = useMemo(() => newestFirst(novel), [novel]);
  // Text written this session is in the workspace before the book's model has it.
  const files = useStore(workspace.store, (s) => s.files);
  const [shown, setShown] = useState(BATCH);
  const end = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const more = shown < entries.length;

  useEffect(() => {
    const at = end.current;
    if (!at || !more || typeof IntersectionObserver === "undefined") return;
    const seen = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setShown((n) => n + BATCH), { rootMargin: "400px" });
    seen.observe(at);
    return () => seen.disconnect();
  }, [more, shown]);

  // Links in the text go through the app's router, not a page load (which, on Android, is the app's).
  const follow = (e: MouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (!href?.startsWith("/novels/") || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
  };

  return (
    <div className={cn(PAGE, "grid content-start gap-6")}>
      <h1 className="mx-auto w-full max-w-[36rem] text-xl font-semibold">{`${w.piece.Many}, newest first`}</h1>
      {entries.length === 0 ? (
        <p className="text-muted">
          No {w.piece.many} yet.{" "}
          <Link to={`/novels/${novelId}/today`} className="text-accent underline-offset-2 hover:underline">
            Write today's {w.piece.one}
          </Link>
        </p>
      ) : (
        <ol aria-label={`${w.piece.Many}, newest first`} className="grid gap-10">
          {entries.slice(0, shown).map(({ piece, day }) => {
            const body = files[piece.file]?.body ?? piece.body;
            return (
              <li key={piece.id}>
                <article aria-labelledby={`read-${piece.id}`} className="mx-auto grid max-w-[36rem] gap-2">
                  <header className="grid gap-0.5 border-b border-rule pb-2">
                    <h2 id={`read-${piece.id}`} className="text-lg font-semibold">
                      <Link to={`/novels/${novelId}/scene/${piece.id}`} className="underline-offset-2 hover:underline">
                        {piece.title}
                      </Link>
                    </h2>
                    <p className="text-xs text-muted">
                      {day && <time dateTime={day}>{longDate(day)}</time>}
                      {day && " · "}
                      {number.format(countWords(body))} words
                    </p>
                  </header>
                  {/* entryHtml is micromark's safe output. */}
                  <div
                    onClick={follow}
                    className="text-[length:var(--ghw-prose-size)] leading-[1.65] font-[family-name:var(--ghw-prose-font)] text-ink [&_a]:text-accent [&_a]:underline [&_a]:decoration-1 [&_a]:underline-offset-4 [&_img]:mx-auto [&_img]:my-4 [&_img]:max-w-full [&_p]:my-3"
                    dangerouslySetInnerHTML={{ __html: entryHtml(body, novelId) }}
                  />
                </article>
              </li>
            );
          })}
        </ol>
      )}
      {more && (
        <div ref={end} className="flex justify-center">
          <Button onClick={() => setShown((n) => n + BATCH)}>Earlier {w.piece.many}</Button>
        </div>
      )}
    </div>
  );
}
