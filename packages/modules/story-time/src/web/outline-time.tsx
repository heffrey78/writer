import { carrierOf, carryingField, countWords, entryIds, proseText, vocabulary, word, type Book, type ModuleRecord, type Piece } from "@writer/core";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { FieldFilters, STATUS_TONE } from "@writer/web/novel/corkboard.tsx";
import { filterParams, filtersOf, shows, type CorkboardFilter } from "@writer/web/novel/corkboard-order.ts";
import { StatusSelect, Synopsis, useSceneEdit } from "@writer/web/novel/outline.tsx";
import type { Workspace } from "@writer/web/novel/workspace.ts";
import { Button } from "@writer/web/ui/button.tsx";
import { cn } from "@writer/web/ui/cn.ts";
import { storyTimeline, timedTypes, when } from "../core/index.ts";

/*
 * The outline in story time (heffrey78/gh-writer#165): the scenes in the order things happen, with the records other
 * modules keep in story time (off-page events) placed among them, drawn so they're never taken for
 * scenes (dashed cards, italic rows, "Off the page"). Dated items first, then relative days; then the
 * undated scenes in reading order, and the undated records. Nothing moves here: it's reading order
 * that's rearranged.
 */

type Item = { kind: "scene"; scene: Piece; when?: string } | { kind: "record"; record: ModuleRecord; when?: string };

/** Every scene and record, in story-time order. */
function inStoryTime(novel: Book): Item[] {
  const t = storyTimeline(novel);
  return [
    ...t.items.map((i): Item => (i.kind === "scene" ? { kind: "scene", scene: i.scene, when: when(i) } : { kind: "record", record: i.record, when: when(i) })),
    ...t.undatedScenes.map((scene): Item => ({ kind: "scene", scene })),
    ...t.undatedRecords.map((record): Item => ({ kind: "record", record })),
  ];
}

/** A record's note, as a line of plain text. */
const noteLine = (r: ModuleRecord) => proseText(r.body).replace(/\s+/g, " ").trim();

/** What a record's in, in the story: its type's group ("Off the page"). */
const groupOf = (novel: Book, r: ModuleRecord) => timedTypes(novel.kind).find((t) => t.key === r.type)?.group ?? r.type;

const NOT_MOVED = "In story time, nothing is moved: switch to reading order to rearrange the book.";
const number = new Intl.NumberFormat();

export function OutlineTimeTable({ novelId, novel, workspace }: { novelId: string; novel: Book; workspace: Workspace }) {
  const items = useMemo(() => inStoryTime(novel), [novel]);
  const w = vocabulary(novel.kind);
  const carrying = carryingField(novel.kind);
  // The threads its pieces follow (plotlines), for a kind with them.
  const threading = novel.kind.fields.find((f) => f.threads);
  const edit = useSceneEdit(novelId, workspace);
  const name = (id: string | undefined) => novel.entities.find((e) => e.id === id)?.name;
  const names = (ids: string[] | undefined) => (ids ?? []).map(name).filter(Boolean).join(", ") || <span className="text-muted not-italic">—</span>;
  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted">{NOT_MOVED}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <caption className="sr-only">Every {[w.piece.one, ...timedTypes(novel.kind).map((t) => word(t.noun).one)].join(" and ")} in story-time order</caption>
          <thead>
            <tr className="border-b border-rule text-left text-xs text-muted">
              <th scope="col" className="w-36 py-2 pr-3 font-medium">
                When
              </th>
              <th scope="col" className="w-48 py-2 pr-3 font-medium">
                {w.piece.One}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Synopsis
              </th>
              <th scope="col" className="w-28 py-2 pr-3 font-medium">
                Status
              </th>
              {carrying && (
                <th scope="col" className="w-28 py-2 pr-3 font-medium">
                  {carrying.label}
                </th>
              )}
              <th scope="col" className="w-40 py-2 pr-3 font-medium">
                Characters
              </th>
              {threading && (
                <th scope="col" className="w-36 py-2 pr-3 font-medium">
                  {threading.label}
                </th>
              )}
              <th scope="col" className="w-16 py-2 text-right font-medium">
                Words
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) =>
              item.kind === "scene" ? (
                <tr key={item.scene.id} className="border-b border-rule align-top">
                  <td className="py-2 pr-3 text-muted">{item.when ?? "No time"}</td>
                  <td className="py-2 pr-3">
                    <Link to={`/novels/${novelId}/scene/${item.scene.id}`} className="font-medium underline-offset-2 hover:underline">
                      {item.scene.title}
                    </Link>
                  </td>
                  <td className="py-1 pr-3">
                    <Synopsis scene={item.scene} onSave={(v) => void edit(item.scene, "synopsis", v)} />
                  </td>
                  <td className="py-1 pr-3">
                    <StatusSelect scene={item.scene} onChange={(v) => void edit(item.scene, "status", v)} />
                  </td>
                  {carrying && <td className="py-2 pr-3">{name(carrierOf(novel.kind, item.scene)) ?? <span className="text-muted">—</span>}</td>}
                  <td className="py-2 pr-3">{names(item.scene.characters)}</td>
                  {threading && <td className="py-2 pr-3">{names(entryIds(threading, item.scene.fields[threading.key]))}</td>}
                  <td className="py-2 text-right tabular-nums">{number.format(countWords(item.scene.body))}</td>
                </tr>
              ) : (
                <tr key={item.record.id} className="border-b border-dashed border-rule bg-paper align-top italic">
                  <td className="py-2 pr-3 text-muted">{item.when ?? "No time"}</td>
                  <td className="py-2 pr-3">
                    <Link to={`/novels/${novelId}/${item.record.type}/${item.record.id}`} className="underline-offset-2 hover:underline">
                      {item.record.title}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-muted">{noteLine(item.record)}</td>
                  <td className="py-2 pr-3 text-xs font-medium tracking-wide text-muted not-italic uppercase">{groupOf(novel, item.record)}</td>
                  {carrying && <td className="py-2 pr-3 text-muted not-italic">—</td>}
                  <td className="py-2 pr-3">{names(recordList(item.record, "characters"))}</td>
                  {threading && <td className="py-2 pr-3">{names(recordList(item.record, threading.key))}</td>}
                  <td className="py-2 text-right text-muted not-italic">—</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A record's list of entries by the key a piece's field has for them ("plotlines"). */
const recordList = (r: ModuleRecord, key: string) => {
  const v = r.fields[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
};

/**
 * Whether a record (an event) shows with the cards' filters: those about its people, places and
 * plotlines (by entry type); one field's filter (a point of view) or status is a scene's, and leaves
 * records out.
 */
const recordShows = (novel: Book, r: ModuleRecord, f: CorkboardFilter) => {
  // A record's lists by the entry type of the piece's field of the same key.
  const held: Record<string, string[] | undefined> = Object.fromEntries(novel.kind.fields.flatMap((x) => ("entityType" in x.type ? [[x.type.entityType, recordList(r, x.key)]] : [])));
  return !f["status"] && filtersOf(novel).every((d) => !f[d.param] || (!d.field && (held[d.entityType] ?? []).includes(f[d.param]!)));
};

export function OutlineTimeCards({ novelId, novel }: { novelId: string; novel: Book }) {
  const [params, setParams] = useSearchParams();
  const filter: CorkboardFilter = Object.fromEntries(filterParams(novel).flatMap((k) => (params.get(k) ? [[k, params.get(k)!]] : [])));
  const all = useMemo(() => inStoryTime(novel), [novel]);
  const items = all.filter((i) => (i.kind === "scene" ? shows(novel, i.scene, filter) : recordShows(novel, i.record, filter)));
  const filtered = Object.keys(filter).length > 0;
  const name = (id: string | undefined) => novel.entities.find((e) => e.id === id)?.name;
  const setFilter = (key: keyof CorkboardFilter, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const scenes = items.filter((i) => i.kind === "scene").length;
  const w = vocabulary(novel.kind);
  return (
    <div className="grid gap-4">
      <div role="group" aria-label="Filters" className="flex flex-wrap items-end gap-3">
        <FieldFilters novel={novel} filter={filter} setFilter={setFilter} />
        {filtered && (
          <Button size="sm" onClick={() => setParams({ order: "time" }, { replace: true })}>
            Clear filters
          </Button>
        )}
      </div>
      <p role="status" className="text-sm text-muted">
        {filtered ? `${scenes} of ${w.piece.count(novel.pieces.length)} match` : w.piece.count(novel.pieces.length)}
        {timedTypes(novel.kind).map((t) => `, and ${word(t.noun).count(items.filter((i) => i.kind === "record" && i.record.type === t.key).length)}`)}. {NOT_MOVED}
      </p>
      <ol aria-label="In story time" className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
        {items.map((item) =>
          item.kind === "scene" ? (
            <li key={item.scene.id} aria-label={item.scene.title} className={cn("grid content-start gap-1.5 rounded-md border border-l-4 border-rule bg-raised p-3 text-sm shadow-sm", STATUS_TONE[item.scene.status])}>
              <span className="text-xs text-muted">{item.when ?? "No time"}</span>
              <Link to={`/novels/${novelId}/scene/${item.scene.id}`} className="font-semibold underline-offset-2 hover:underline">
                {item.scene.title}
              </Link>
              {item.scene.synopsis && <p className="text-muted">{item.scene.synopsis}</p>}
              <p className="text-xs text-muted">
                {item.scene.status}
                {carrierOf(novel.kind, item.scene) && ` · ${name(carrierOf(novel.kind, item.scene))}`}
              </p>
            </li>
          ) : (
            <li key={item.record.id} aria-label={`${item.record.title}, ${groupOf(novel, item.record).toLowerCase()}`} className="grid content-start gap-1.5 rounded-md border border-dashed border-muted bg-paper p-3 text-sm italic">
              <span className="text-xs text-muted not-italic">
                {item.when ?? "No time"} · <span className="font-medium tracking-wide uppercase">{groupOf(novel, item.record)}</span>
              </span>
              <Link to={`/novels/${novelId}/${item.record.type}/${item.record.id}`} className="font-semibold underline-offset-2 hover:underline">
                {item.record.title}
              </Link>
              {noteLine(item.record) && <p className="text-muted">{noteLine(item.record)}</p>}
            </li>
          ),
        )}
      </ol>
    </div>
  );
}
