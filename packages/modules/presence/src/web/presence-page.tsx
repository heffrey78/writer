import { fieldName, outerSections, pieceSections, plural, roleOf, type Entity, type Vocabulary, type Book, type FieldDef, type ItemProp, type Piece, type YamlEdit } from "@writer/core";
import { chapterTitle, DEFAULT_GAP, gaps, gridKey, presence, zoomed, type Gap, type Presence } from "@writer/core/diagrams";
import { Popover } from "radix-ui";
import { useId, useMemo, useState } from "react";
import { readSize, SceneGrid, SizeSelect, type GridMark } from "@writer/web/diagrams/scene-grid.tsx";
import { ExportMenu } from "@writer/web/diagrams/export-menu.tsx";
import { GapControls } from "@writer/web/diagrams/gap-controls.tsx";
import { amount, readGap, writeGap } from "@writer/web/diagrams/gap-param.ts";
import { entryEdits, type EntryChange } from "@writer/web/novel/entry-edits.ts";
import { useWords } from "@writer/web/novel/kind.ts";
import { useSceneEdit } from "@writer/web/novel/scene-edit.ts";
import type { Workspace } from "@writer/web/novel/workspace.ts";
import { Button } from "@writer/web/ui/button.tsx";
import { useViewParams } from "@writer/web/ui/view-params.ts";
import { carryingFieldOf, listFieldOf, presenceFile, presenceSvg, presenceTypes, scaled, sortRows, totals, type RowOrder } from "../core/index.ts";

const number = new Intl.NumberFormat();
const ORDERS: [RowOrder, (w: Vocabulary) => string][] = [
  ["first", () => "First appearance"],
  ["total", (w) => `Most ${w.piece.many}`],
  ["name", () => "Name"],
];

/** How a presence is drawn: its carrier (the point of view) ringed, a listing filled (by its strength, or its weight), a mention alone dashed. */
function markOf(p: Presence): GridMark {
  const note = p.note ? { note: p.note } : {};
  if (!p.listed) return { size: 0.7, style: "dashed", ...note };
  if (p.weight) return { size: p.strongest ? 0.95 : 0.7, style: p.strongest ? "filled" : "hollow", ...note };
  if (p.strength !== undefined) return { size: 0.55 + 0.15 * p.strength, style: "filled", ...note };
  return { size: 0.8, style: "filled", ...(p.carries ? { ring: true } : {}), ...note };
}

/** The item properties of a list field: what each of its entries may carry. */
const propsOf = (list: FieldDef | undefined): readonly ItemProp[] => (list?.type.kind === "entities" ? (list.type.item ?? []) : []);

/**
 * What a screen reader says for a cell. `carrying` is the kind's carrying field, whose role names a
 * carrier ("point of view"); `list` the field the entry is listed in, whose item properties and marks
 * say what it carries ("strength 3", "a minor beat").
 */
function describe(w: Vocabulary, scene: string, name: string, p: Presence | undefined, carrying: FieldDef | undefined, list: FieldDef | undefined, gap?: Gap): string {
  if (!p) return `${scene}: ${name} not there${gap ? `, in an absence of ${w.piece.count(gap.scenes)}` : ""}`;
  if (!p.listed) return `${scene}: ${name} mentioned only`;
  const scale = propsOf(list).find((x) => x.kind === "scale")?.label.toLowerCase() ?? "strength";
  const choice = p.weight && ((p.strongest ? list?.marks?.carries : list?.marks?.present) ?? `${propsOf(list).find((x) => x.kind === "choice")?.label.toLowerCase() ?? "weight"} ${p.weight}`);
  const how = [p.carries && carrying ? roleOf(carrying) : "", p.strength !== undefined ? `${scale} ${p.strength}` : "", choice ?? "", p.note ? `“${p.note}”` : ""].filter(Boolean).join(", ");
  return `${scene}: ${name} present${how ? `, ${how}` : ""}`;
}

/**
 * Who and what is where: the entries of a type (the first the kind's fields list, by default) against
 * every scene in reading order, from the scenes' metadata, with mentions in the prose shown apart.
 * The type, zoom and size live in the address.
 */
export function PresencePage({ novelId, novel, workspace }: { novelId: string; novel: Book; workspace: Workspace }) {
  const [params, setParams] = useViewParams();
  const w = useWords();
  const types = presenceTypes(novel);
  const first = types[0]?.key ?? "";
  const type = types.some((t) => t.key === params.get("type")) ? params.get("type")! : first;
  const typeDef = types.find((t) => t.key === type);
  const zoom = params.get("zoom") ?? undefined;
  const size = readSize(params.get("size"));
  const label = novel.entityTypes.find((t) => t.key === type)?.label ?? type;
  const order: RowOrder = (["first", "total", "name"] as const).find((o) => o === params.get("sort")) ?? "first";
  const threshold = readGap(params.get("gap")) ?? DEFAULT_GAP;
  // Absences are found in the whole book (one can cross the zoom's edge); the grid shows the zoom.
  const whole = useMemo(() => presence(novel, type), [novel, type]);
  const m = useMemo(() => (zoom ? presence(novel, type, zoomed(novel, novel.pieces, zoom)) : whole), [novel, type, zoom, whole]);
  const marks = useMemo(() => new Map([...m.marks].map(([k, p]) => [k, markOf(p)])), [m]);
  const rows = useMemo(() => {
    const count = totals(whole);
    return sortRows(whole, order).map((r) => ({ id: r.id, name: r.name, aside: number.format(count.get(r.id) ?? 0) }));
  }, [whole, order]);
  const absences = useMemo(() => gaps({ lanes: sortRows(whole, order), scenes: whole.scenes, marks: whole.marks, words: whole.words }, threshold), [whole, order, writeGap(threshold)]); // eslint-disable-line react-hooks/exhaustive-deps
  const inGap = useMemo(() => {
    const out = new Map<string, Gap>();
    const ids = whole.scenes.map((s) => s.id);
    for (const g of absences) for (const id of ids.slice(ids.indexOf(g.from), ids.indexOf(g.to) + 1)) out.set(gridKey(g.lane, id), g);
    return out;
  }, [absences, whole]);
  const shaded = useMemo(() => new Set(inGap.keys()), [inGap]);
  // The field a cell adds an entry to, and the one that carries a scene (its point of view) for entries of its type.
  const list = listFieldOf(novel, type);
  const carrying = carryingFieldOf(novel, type);
  // What the legend calls the list: the book's own types' entries are listed as, e.g., "artifacts".
  const listName = !list || list.type.kind === "own-entities" ? plural(label).toLowerCase() : fieldName(list).toLowerCase();
  const sceneEdit = useSceneEdit(novelId, workspace);
  const [editing, setEditing] = useState<{ row: string; scene: string; el: HTMLElement }>();

  /** A change to an entry in a scene's list (and, for one of the carrier's type, whether it carries the scene: its point of view). */
  const change = (scene: Piece, entry: Entity, what: EntryChange | { carries: boolean }, done?: string) =>
    sceneEdit(
      scene,
      (fm): YamlEdit[] => {
        const key = carrying?.key;
        if ("carries" in what) return !key ? [] : what.carries ? [{ path: [key], value: entry.id }] : fm[key] === entry.id ? [{ path: [key], remove: true }] : [];
        if (!list) return [];
        const edits = entryEdits(fm, list.key, entry.id, what);
        // Taken out of a scene, an entry no longer carries it either.
        if ("remove" in what && key && fm[key] === entry.id) edits.push({ path: [key], remove: true });
        return edits;
      },
      done,
    );

  /** A cell chosen: not listed, it's added to the scene's list; listed, its editor opens. */
  const choose = (row: string, scene: Piece, el: HTMLElement) => {
    const entry = m.rows.find((r) => r.id === row);
    if (!entry || !list) return;
    if (m.marks.get(gridKey(row, scene.id))?.listed) setEditing({ row, scene: scene.id, el });
    else void change(scene, entry, { add: true }, `Added ${entry.name} to “${scene.title}”.`);
  };
  const editingEntry = editing && m.rows.find((r) => r.id === editing.row);
  const editingScene = editing && m.scenes.find((s) => s.id === editing.scene);

  return (
    <div className="grid content-start gap-3 px-6 py-4">
      <h2 className="sr-only">Presence</h2>
      <div className="flex flex-wrap items-end gap-4 text-sm">
        <label className="grid gap-1 font-medium">
          Rows
          <select value={type} onChange={(e) => setParams({ type: e.target.value === first ? undefined : e.target.value })} className="h-8 rounded-md border border-rule bg-raised px-2 font-normal">
            {types.map((t) => (
              <option key={t.key} value={t.key}>
                {plural(t.label)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 font-medium">
          Show
          <select value={zoom ?? ""} onChange={(e) => setParams({ zoom: e.target.value || undefined })} className="h-8 rounded-md border border-rule bg-raised px-2 font-normal">
            <option value="">The whole book</option>
            {outerSections(novel).map((p) => (
              <option key={p.id} value={p.id}>
                {w.level(p.level).One}: {p.title}
              </option>
            ))}
            {pieceSections(novel).map((c) => (
              <option key={c.id} value={c.id}>
                {w.level(c.level).One}: {chapterTitle(novel, c)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 font-medium">
          Sort
          <select value={order} onChange={(e) => setParams({ sort: e.target.value === "first" ? undefined : e.target.value })} className="h-8 rounded-md border border-rule bg-raised px-2 font-normal">
            {ORDERS.map(([o, l]) => (
              <option key={o} value={o}>
                {l(w)}
              </option>
            ))}
          </select>
        </label>
        <SizeSelect value={size} onChange={(v) => setParams({ size: v })} />
        <GapControls legend="Flag an absence longer than" threshold={threshold} onChange={(gap) => setParams({ gap })} />
        <div className="ml-auto flex gap-2">
          {typeDef && <ExportMenu name={presenceFile(typeDef).replace(/\.svg$/, "")} svg={() => presenceSvg(novel, type)} />}
        </div>
      </div>
      <p className="text-sm text-muted">
        Each column is {w.piece.a}, in reading order.{" "}
        <span className="inline-block size-3 rounded-full bg-accent align-middle" aria-hidden /> listed in the {w.piece.one}'s {listName}
        {carrying && (
          <>
            {" "}
            (<span className="mx-1 inline-block size-3 rounded-full bg-accent align-middle ring-2 ring-accent ring-offset-1" aria-hidden /> its {roleOf(carrying)})
          </>
        )}
        {scaled(novel, type) && ", larger for a stronger one"},{" "}
        <span className="inline-block size-2.5 rounded-full border border-dashed border-accent align-middle" aria-hidden /> mentioned in the prose but not listed; shaded, an absence of more than{" "}
        {amount(threshold, w.piece)}. The number by each name is how many {w.piece.many} it's in.
      </p>
      {!typeDef ? (
        <p className="text-muted">Nothing here lists entries yet.</p>
      ) : !m.rows.length || !m.scenes.length ? (
        <p className="text-muted">{!m.rows.length ? `No ${plural(label).toLowerCase()} yet.` : `The ${w.content.one} has no ${w.piece.many} yet.`}</p>
      ) : (
        <SceneGrid
          novelId={novelId}
          novel={novel}
          workspace={workspace}
          label={`${plural(label)} by ${w.piece.one}`}
          rowHeading={label}
          rows={rows}
          scenes={m.scenes}
          marks={marks}
          shaded={shaded}
          cellLabel={(row: string, scene: Piece) => describe(w, scene.title, m.rows.find((r) => r.id === row)?.name ?? row, m.marks.get(gridKey(row, scene.id)), carrying, list, inGap.get(gridKey(row, scene.id)))}
          onChoose={choose}
          hasPopup={(row, scene) => !!m.marks.get(gridKey(row, scene))?.listed}
          size={size}
        />
      )}
      {m.rows.length > 0 && m.scenes.length > 0 && (
        <section aria-labelledby="absences-heading" className="grid gap-1 text-sm">
          <h2 id="absences-heading" className="font-semibold">
            Long absences
          </h2>
          {absences.length ? (
            <ul className="grid gap-1">
              {absences.map((g) => {
                const name = whole.rows.find((r) => r.id === g.lane)?.name;
                const title = (id: string) => whole.scenes.find((x) => x.id === id)?.title;
                const where = g.from === g.to ? `at “${title(g.from)}”` : `from “${title(g.from)}” to “${title(g.to)}”`;
                return (
                  <li key={`${g.lane}-${g.from}`}>
                    {name}: away for {w.piece.count(g.scenes)} ({number.format(g.words)} words) {where}
                    {g.open ? ", and never back" : ""}.
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-muted">
              No {plural(label).toLowerCase()} away for more than {amount(threshold, w.piece)}.
            </p>
          )}
        </section>
      )}
      {editing && editingEntry && editingScene && (
        <PresenceEditor
          anchor={editing.el}
          list={list}
          scene={editingScene}
          entry={editingEntry}
          presence={m.marks.get(gridKey(editingEntry.id, editingScene.id))}
          carrying={carrying}
          onChange={(what, done) => change(editingScene, editingEntry, what, done)}
          onClose={() => {
            const el = document.querySelector<HTMLElement>(`[data-cell="${gridKey(editing.row, editing.scene)}"]`);
            setEditing(undefined);
            el?.focus();
          }}
        />
      )}
    </div>
  );
}

/** An entry in a scene: as what carries it (its point of view), with what its item carries (a theme's strength, a plotline's weight), or taken out. */
function PresenceEditor({
  anchor,
  list,
  scene,
  entry,
  presence: p,
  carrying,
  onChange,
  onClose,
}: {
  anchor: HTMLElement;
  /** The field the entry is listed in: its choice and scale properties are edited here. */
  list: FieldDef | undefined;
  scene: Piece;
  entry: Entity;
  presence: Presence | undefined;
  /** The kind's carrying field, when entries of this type can carry a scene. */
  carrying: FieldDef | undefined;
  onChange: (what: EntryChange | { carries: boolean }, done?: string) => unknown;
  onClose: () => void;
}) {
  const id = useId();
  const w = useWords();
  // Presence reads an item's first choice and first scale: those are what's edited.
  const choice = propsOf(list).find((x) => x.kind === "choice");
  const scale = propsOf(list).find((x) => x.kind === "scale");
  // Answering at once; the saved value comes back with the model and replaces it.
  const saved = { carries: p?.carries ?? false, strength: p?.strength === undefined ? "" : String(p.strength), weight: p?.weight ?? (choice?.kind === "choice" ? choice.default : undefined) ?? "" };
  const [shown, setShown] = useState(saved);
  const [seen, setSeen] = useState(saved);
  if (JSON.stringify(saved) !== JSON.stringify(seen)) {
    setSeen(saved);
    setShown(saved);
  }
  return (
    <Popover.Root open onOpenChange={(o) => !o && onClose()}>
      <Popover.Anchor virtualRef={{ current: anchor }} />
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          sideOffset={4}
          aria-labelledby={`${id}-title`}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="z-[80] grid w-72 gap-3 rounded-lg border border-rule bg-raised p-4 text-sm text-ink shadow-lg"
        >
          <p id={`${id}-title`} className="font-semibold">
            {entry.name} in “{scene.title}”
          </p>
          {carrying && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={shown.carries}
                onChange={(e) => {
                  setShown({ ...shown, carries: e.target.checked });
                  void onChange({ carries: e.target.checked });
                }}
              />
              The {w.piece.one}'s {carrying.label.toLowerCase()}
            </label>
          )}
          {scale?.kind === "scale" && (
            <label className="grid gap-1 font-medium">
              {scale.label}
              <select
                value={shown.strength}
                onChange={(e) => {
                  setShown({ ...shown, strength: e.target.value });
                  void onChange({ field: scale.key, value: e.target.value ? Number(e.target.value) : undefined });
                }}
                className="h-8 rounded-md border border-rule bg-raised px-2 font-normal"
              >
                <option value="">Not given</option>
                {Object.entries(scale.options).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          )}
          {choice?.kind === "choice" && (
            <label className="grid gap-1 font-medium">
              {choice.label}
              <select
                value={shown.weight}
                onChange={(e) => {
                  setShown({ ...shown, weight: e.target.value });
                  // Its default is what an item without it means: choosing it takes the property out.
                  void onChange({ field: choice.key, value: e.target.value === choice.default ? undefined : e.target.value });
                }}
                className="h-8 rounded-md border border-rule bg-raised px-2 font-normal"
              >
                {choice.default === undefined && <option value="">Not given</option>}
                {choice.values.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex justify-between gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void onChange({ remove: true }, `Took ${entry.name} out of “${scene.title}”.`);
                onClose();
              }}
            >
              Remove from this {w.piece.one}
            </Button>
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
