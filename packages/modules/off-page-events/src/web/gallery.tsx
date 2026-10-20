import { proseText, vocabulary, type Book } from "@writer/core";
import { Plus } from "lucide-react";
import { Link } from "react-router";
import { useNewRecord } from "@writer/web/modules.tsx";
import { whenOf } from "@writer/web/novel/scene-details.tsx";
import { Button } from "@writer/web/ui/button.tsx";
import { EVENT, eventsInTime } from "../core/index.ts";

/**
 * Off-page events in the codex's gallery (heffrey78/gh-writer#223): the story's facts that aren't shown, as a group of
 * cards after the entries, found by title or note. In story-time order, but by title for the Name sort.
 */
export function EventCards({ novelId, novel, query, sort }: { novelId: string; novel: Book; query: string; sort: string }) {
  const ask = useNewRecord((s) => s.ask);
  const all = eventsInTime(novel);
  const q = query.trim().toLowerCase();
  const shown = all.filter((e) => !q || e.title.toLowerCase().includes(q) || proseText(e.body).toLowerCase().includes(q));
  if (sort === "name") shown.sort((a, b) => a.title.localeCompare(b.title));
  if (q && !shown.length) return null;
  const names = (ids: string[] | undefined) => (ids ?? []).map((id) => novel.entities.find((e) => e.id === id)?.name ?? id);
  return (
    <section id="off-the-page" aria-labelledby="type-events" className="grid scroll-mt-4 gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="type-events" className="font-semibold">
          {EVENT.group} <span className="text-sm font-normal text-muted">{all.length}</span>
        </h2>
        <Button size="sm" variant="ghost" onClick={() => ask(EVENT.key)} aria-label="New off-page event">
          <Plus className="size-4" aria-hidden /> New
        </Button>
      </div>
      {shown.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((e) => {
            const time = whenOf({ when: e.when, duration: e.duration });
            const who = [...names(e.characters), ...names(e.locations)];
            const note = proseText(e.body).replace(/\s+/g, " ").trim();
            return (
              <li key={e.id} className="grid">
                <Link
                  to={`/novels/${novelId}/event/${e.id}`}
                  state={{ fromGallery: true }}
                  className="grid content-start gap-1.5 rounded-lg border border-dashed border-muted bg-raised px-4 py-3 hover:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  <span className="text-xs text-muted">{[time.when || "No time", time.duration].filter(Boolean).join(" · ")}</span>
                  <span className="font-semibold">{e.title}</span>
                  {note && <span className="line-clamp-2 font-prose leading-snug italic">{note}</span>}
                  {who.length > 0 && <span className="text-[13px] text-muted">{who.join(", ")}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">No off-page events yet: backstory, and what happens between {vocabulary(novel.kind).piece.many}.</p>
      )}
    </section>
  );
}
