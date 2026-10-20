import { carryingField, vocabulary, word, type Book } from "@writer/core";
import { Fragment, useMemo } from "react";
import { Link } from "react-router";
import { ExportMenu } from "@writer/web/diagrams/export-menu.tsx";
import { useNewRecord } from "@writer/web/modules.tsx";
import { Button } from "@writer/web/ui/button.tsx";
import { cn } from "@writer/web/ui/cn.ts";
import { useViewParams } from "@writer/web/ui/view-params.ts";
import { defaultLanes, itemId, itemTitle, jump, laneModes as modesOf, lanesOf, nothingTimed, overlaps, recordWords, storyTimeline, timedTypes, timeline, timelineMermaid, timelineSvg, when, type LaneMode, type TimelineItem } from "../core/index.ts";
import { DayOne } from "./day-one.tsx";

const SLOT = 152;
const HEAD = 168;
const LINKS = 88;
/** The ways the lanes can run, named: by carrier (its field's label, "Point of view"), by an entry type ("Location"). */
export const laneModes = (novel: Book): [LaneMode, string][] =>
  modesOf(novel.kind).map((m) => [m, m === "carrier" ? (carryingField(novel.kind)?.label ?? m) : (novel.entityTypes.find((t) => t.key === m)?.label ?? m)]);

/**
 * The book in story time: scenes and other modules' records (off-page events) in the order they happen, evenly spaced with
 * the jumps between them labelled, in lanes by point of view, plotline or location. Below, the
 * scenes in reading order, each linked to its place in story time: a flashback's line runs back
 * across the others. Overlaps (someone in two places at once) and undated scenes are listed, and
 * everything is in a table too.
 */
export function TimelinePage({ novelId, novel }: { novelId: string; novel: Book }) {
  const [params, setParams] = useViewParams();
  const MODES = laneModes(novel);
  const fallback = defaultLanes(novel.kind);
  const mode: LaneMode = MODES.some(([m]) => m === params.get("lanes")) ? (params.get("lanes") as LaneMode) : fallback;
  const t = useMemo(() => timeline(novel, mode), [novel, mode]);
  const conflicts = useMemo(() => overlaps(novel, storyTimeline(novel)), [novel]);
  const reading = novel.pieces.filter((s) => t.storyRank.has(s.id));
  const n = t.items.length;
  const readSlot = reading.length ? (n * SLOT) / reading.length : SLOT;
  const name = (id: string) => novel.entities.find((e) => e.id === id)?.name ?? id;
  // An event (another module's record) is added by its title, then opens on its own page (heffrey78/gh-writer#165): the book's dialog.
  const ask = useNewRecord((s) => s.ask);
  const w = vocabulary(novel.kind);
  const timed = timedTypes(novel.kind);
  const adds = timed.map((type) => (
    <Button key={type.key} size={n ? "sm" : undefined} onClick={() => ask(type.key)}>
      New {word(type.noun).one}
    </Button>
  ));
  const lanesText = (i: TimelineItem) => lanesOf(novel, i, mode).map((l) => t.lanes.find((x) => x.id === l)?.name ?? l).join(", ");

  if (!n) {
    return (
      <div className="grid gap-3 px-6 py-4">
        <h2 className="sr-only">Timeline</h2>
        <p className="text-muted">
          {nothingTimed(novel)} Give {w.piece.many} a time in their details (a day of the story, or a date).
        </p>
        {adds.length > 0 && <div>{adds}</div>}
      </div>
    );
  }

  return (
    <div className="grid content-start gap-4 px-6 py-4">
      <h2 className="sr-only">Timeline</h2>
      <div className="flex flex-wrap items-end gap-4 text-sm">
        <label className="grid gap-1 font-medium">
          Lanes
          <select value={mode} onChange={(e) => setParams({ lanes: e.target.value === fallback ? undefined : e.target.value })} className="h-8 rounded-md border border-rule bg-raised px-2 font-normal">
            {MODES.map(([m, l]) => (
              <option key={m} value={m}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex gap-2">
          {adds}
          <ExportMenu name="timeline" svg={() => timelineSvg(novel, mode)} mermaid={() => timelineMermaid(novel)} />
        </div>
      </div>
      <DayOne novelId={novelId} novel={novel} />
      <p className="text-sm text-muted">
        Left to right in story time, evenly spaced; the time between neighbours is above them. Below, the scenes in reading order: each line joins a scene's place in the book to its place in
        time, and a <span className="font-medium text-warn">flashback</span>'s runs back across the others.
      </p>

      <div className="max-w-full overflow-x-auto rounded-lg border border-rule">
        <div style={{ width: HEAD + n * SLOT }} className="relative">
          {/* Story time: the axis, then a row per lane. */}
          <div role="presentation" style={{ display: "grid", gridTemplateColumns: `${HEAD}px repeat(${n}, ${SLOT}px)` }}>
            <div className="sticky left-0 z-10 border-b border-rule bg-paper px-3 py-2 text-xs font-medium text-muted">Story time</div>
            {t.items.map((item, k) => {
              const prev = t.items[k - 1];
              const gap = prev ? jump(prev.at, item.at) : "";
              return (
                <div key={itemId(item)} className="relative border-b border-l border-rule px-2 py-2 text-xs">
                  {gap && gap !== "same time" && <span className="absolute -top-0 left-0 -translate-x-1/2 rounded bg-accent-soft px-1 text-[0.7rem] whitespace-nowrap text-ink">{gap}</span>}
                  <AxisLabel text={when(item)} />
                </div>
              );
            })}
            {t.lanes.map((lane) => (
              <Fragment key={lane.id}>
                <div className="sticky left-0 z-10 truncate border-b border-rule bg-paper px-3 py-3 text-sm font-medium">{lane.name}</div>
                {t.items.map((item) => (
                  <div key={itemId(item)} className="relative border-b border-l border-rule p-1.5">
                    <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-rule" aria-hidden />
                    {lanesOf(novel, item, mode).includes(lane.id) && (
                      <Card
                        novel={novel}
                        novelId={novelId}
                        item={item}
                        flashback={item.kind === "scene" && t.flashbacks.has(item.scene.id)}
                        reading={item.kind === "scene" ? novel.pieces.indexOf(item.scene) + 1 : undefined}
                      />
                    )}
                  </div>
                ))}
              </Fragment>
            ))}
          </div>

          {/* Each scene's place in time joined to its place in the book. */}
          <svg width={HEAD + n * SLOT} height={LINKS} className="block" aria-hidden>
            {reading.map((scene, r) => {
              const k = t.storyRank.get(scene.id)!;
              const flashback = t.flashbacks.has(scene.id);
              return (
                <line
                  key={scene.id}
                  x1={HEAD + k * SLOT + SLOT / 2}
                  y1={0}
                  x2={HEAD + r * readSlot + readSlot / 2}
                  y2={LINKS}
                  stroke={flashback ? "var(--ghw-warn)" : "var(--ghw-rule)"}
                  strokeWidth={flashback ? 2.5 : 1.5}
                />
              );
            })}
          </svg>
          <div role="presentation" style={{ display: "grid", gridTemplateColumns: `${HEAD}px repeat(${reading.length}, ${readSlot}px)` }}>
            <div className="sticky left-0 z-10 border-t border-rule bg-paper px-3 py-2 text-xs font-medium text-muted">Reading order</div>
            {reading.map((scene, r) => (
              <div key={scene.id} className={cn("border-t border-l border-rule px-2 py-2 text-xs", t.flashbacks.has(scene.id) && "bg-warn-soft")}>
                <span className="font-medium tabular-nums">{r + 1}.</span> {scene.title}
              </div>
            ))}
          </div>
        </div>
      </div>

      <section aria-labelledby="overlaps-heading" className="grid gap-1 text-sm">
        <h2 id="overlaps-heading" className="font-semibold">
          In two places at once
        </h2>
        {conflicts.length ? (
          <ul className="grid gap-1">
            {conflicts.map((o, k) => (
              <li key={k}>
                {name(o.character)} is in <ItemLink novelId={novelId} novel={novel} item={o.a} /> and <ItemLink novelId={novelId} novel={novel} item={o.b} /> at the same time, in different places.
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">Nobody is in two places at once.</p>
        )}
      </section>

      {(t.undated.length > 0 || t.undatedRecords.length > 0) && (
        <section aria-labelledby="undated-heading" className="grid gap-1 text-sm">
          <h2 id="undated-heading" className="font-semibold">
            Not on the timeline
          </h2>
          <p className="text-muted">These have no time yet: give a scene one in its details.</p>
          <ul className="grid gap-1">
            {t.undated.map((s) => (
              <li key={s.id}>
                <Link to={`/novels/${novelId}/scene/${s.id}`} className="text-accent underline-offset-2 hover:underline">
                  {s.title}
                </Link>
              </li>
            ))}
            {t.undatedRecords.map((r) => (
              <li key={r.id}>
                <Link to={`/novels/${novelId}/${r.type}/${r.id}`} className="text-accent underline-offset-2 hover:underline">
                  {r.title}
                </Link>{" "}
                ({recordWords(novel, r).aside})
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer font-semibold">As a table</summary>
        <table className="mt-2 w-full max-w-4xl border-collapse">
          <caption className="sr-only">Every {[w.piece.one, ...timed.map((type) => word(type.noun).short)].join(" and ")} in story-time order</caption>
          <thead>
            <tr className="border-b border-rule text-left text-xs text-muted">
              <th scope="col" className="py-1 pr-3 font-medium">
                When
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                What
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                In the book
              </th>
              <th scope="col" className="py-1 font-medium">
                {MODES.find(([m]) => m === mode)![1]}
              </th>
            </tr>
          </thead>
          <tbody>
            {t.items.map((item) => (
              <tr key={itemId(item)} className="border-b border-rule">
                <td className="py-1 pr-3">{when(item)}</td>
                <td className="py-1 pr-3">
                  <ItemLink novelId={novelId} novel={novel} item={item} />
                  {item.kind === "scene" && t.flashbacks.has(item.scene.id) && " (flashback)"}
                </td>
                <td className="py-1 pr-3 tabular-nums">{item.kind === "scene" ? `${novel.pieces.indexOf(item.scene) + 1} of ${novel.pieces.length}` : recordWords(novel, item.record).aside}</td>
                <td className="py-1">{lanesText(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** "Day 1, 09:10 (1 Mar 2024)" on the axis: the day, and its date under it, rather than wrapped anyhow. */
function AxisLabel({ text }: { text: string }) {
  const [, day, date] = /^(Day .*) \((.*)\)$/.exec(text) ?? [];
  return day ? (
    <span className="mt-3 block text-muted">
      {day}
      <span className="block text-[0.7rem]">{date}</span>
    </span>
  ) : (
    <span className="mt-3 block text-muted">{text}</span>
  );
}

function ItemLink({ novelId, novel, item }: { novelId: string; novel: Book; item: TimelineItem }) {
  return item.kind === "scene" ? (
    <Link to={`/novels/${novelId}/scene/${item.scene.id}`} className="text-accent underline-offset-2 hover:underline">
      “{item.scene.title}”
    </Link>
  ) : (
    <span>
      the {recordWords(novel, item.record).short} “{item.record.title}”
    </span>
  );
}

/** A scene (linked, with its place in the book) or another module's record, an off-page event (dashed). */
function Card({ novelId, novel, item, flashback, reading }: { novelId: string; novel: Book; item: TimelineItem; flashback: boolean; reading: number | undefined }) {
  return (
    <div
      className={cn(
        "relative grid gap-0.5 rounded-md border px-2 py-1 text-xs shadow-sm",
        item.kind === "scene" ? "border-rule bg-raised" : "border-dashed border-muted bg-paper italic",
        flashback && "border-warn ring-1 ring-warn",
      )}
    >
      {item.kind === "scene" ? (
        <Link to={`/novels/${novelId}/scene/${item.scene.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
          {itemTitle(item)}
        </Link>
      ) : (
        <Link to={`/novels/${novelId}/${item.record.type}/${item.record.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
          {itemTitle(item)}
        </Link>
      )}
      <span className="text-muted not-italic">
        {item.kind === "scene" ? `#${reading} in the book` : capital(recordWords(novel, item.record).aside)}
        {flashback && <span className="ml-1 font-medium text-warn">· flashback</span>}
      </span>
    </div>
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
