import { fieldLabel, typePlural, type Book, type Entity, type EntryFieldDef, type EntryPresence, type FieldValue } from "@writer/core";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Columns3, Copy } from "lucide-react";
import { Dialog, Popover } from "radix-ui";
import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { api, keys } from "../api.ts";
import { useCommands } from "../commands.ts";
import { useNotice } from "../novel/notice.tsx";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { Picker } from "../ui/picker.tsx";
import { allColumns, cellText, fieldEdit, fieldValue, isGap, shownColumns, sortRows, tableText, type Column, type Direction, type TableBook } from "./table-columns.ts";

/*
 * The index's Table view (#139, #168): one type's entries side by side, a row each, its fields as
 * columns. It's an ARIA grid: the arrow keys move from cell to cell (Home and End along a row, Ctrl with
 * them to the corners), a header's button sorts by its column, and Enter edits the cell in focus with a
 * control for what its field holds. Enter saves, Escape leaves it as it was, and Tab saves and moves on.
 * A save is refused, as on the profile, if the entry's file changed since the cell was opened.
 *
 * Rows are selected by their checkboxes, Space, Shift+click and Shift+arrows (#169); a tag, a field's
 * value or a relationship is then given to every one of them in one commit, undone as one. Copy as a
 * table puts the selected rows (or all) on the clipboard for a spreadsheet.
 */

interface Kept {
  /** The columns shown, in order. */
  shown: string[];
  /** Every column there was when they were chosen: a field declared since then is shown too. */
  known: string[];
  sort?: { key: string; direction: Direction };
}

const keptKey = (novelId: string, type: string) => `ghw:index-table:${novelId}:${type}`;

function readKept(novelId: string, type: string): Kept | undefined {
  try {
    const raw = JSON.parse(localStorage.getItem(keptKey(novelId, type)) ?? "null") as Partial<Kept> | null;
    if (!raw || !Array.isArray(raw.shown)) return undefined;
    return { shown: raw.shown.map(String), known: Array.isArray(raw.known) ? raw.known.map(String) : raw.shown.map(String), ...(raw.sort ? { sort: raw.sort } : {}) };
  } catch {
    return undefined;
  }
}

/** The table's columns and sort for a type, kept per book on this device. */
function useKept(novelId: string, type: string): [Kept | undefined, (k: Kept) => void] {
  const [kept, setKept] = useState(() => readKept(novelId, type));
  useEffect(() => setKept(readKept(novelId, type)), [novelId, type]);
  const set = (k: Kept) => {
    setKept(k);
    try {
      localStorage.setItem(keptKey(novelId, type), JSON.stringify(k));
    } catch {
      // Not kept for next time; still as asked now.
    }
  };
  return [kept, set];
}

/**
 * A long table (more rows than this) draws only the rows in the window and some either side of it, as
 * it's scrolled: hundreds of rows of fields laid out at once would make each sort and scroll wait.
 */
const LONG = 100;
/** A row's height before one is measured, in pixels. */
const ROW_HEIGHT = 33;
/** Rows drawn beyond each edge of the window. */
const OVERSCAN = 20;

/** Which columns a cell can be edited in. */
const editable = (c: Column) => c.kind === "field" || c.kind === "tags";

/** A cell, by its entry and its column (so it stays put as the rows are sorted again); the header row is "head". */
type At = { row: string; col: string };

export function EntryTable({
  novelId,
  novel,
  type,
  rows: listed,
  presences,
  href,
  onOpen,
  current,
}: {
  novelId: string;
  novel: Book;
  type: Book["entityTypes"][number];
  /** The type's entries the search and filters leave, in the list's order. */
  rows: Entity[];
  presences: ReadonlyMap<string, EntryPresence>;
  href: (id: string) => string;
  onOpen: (to: string, e?: MouseEvent) => Promise<void>;
  /** The entry open beside the table. */
  current: string | undefined;
}) {
  const queryClient = useQueryClient();
  const show = useNotice((n) => n.show);
  const table: TableBook = useMemo(() => ({ book: novel, presences }), [novel, presences]);
  const columns = useMemo(() => allColumns(novel, type.key), [novel, type.key]);
  const [kept, setKept] = useKept(novelId, type.key);
  // The same columns until they're chosen again (not when only the sort changes).
  const chosenColumns = JSON.stringify(kept ? [kept.shown, kept.known] : null);
  const shown = useMemo(() => shownColumns(columns, kept), [columns, chosenColumns]); // eslint-disable-line react-hooks/exhaustive-deps
  const keep = (change: Partial<Kept>) => setKept({ shown: shown.map((c) => c.key), known: columns.map((c) => c.key), ...(kept?.sort ? { sort: kept.sort } : {}), ...change });
  const sortColumn = kept?.sort && shown.find((c) => c.key === kept.sort!.key);
  const direction = kept?.sort?.direction;
  const rows = useMemo(() => (sortColumn && direction ? sortRows(table, listed, sortColumn, direction) : listed), [table, listed, sortColumn, direction]);
  const sortBy = (c: Column) => keep({ sort: { key: c.key, direction: kept?.sort?.key === c.key && kept.sort.direction === "ascending" ? "descending" : "ascending" } });
  const gaps = useMemo(() => rows.reduce((n, e) => n + shown.filter((c) => isGap(novel, e, c)).length, 0), [novel, rows, shown]);

  // The cell in focus (the grid's one stop for Tab), and whether it's being edited.
  const [at, setAt] = useState<At>({ row: "head", col: "name" });
  const [editing, setEditing] = useState(false);
  const grid = useRef<HTMLTableElement>(null);
  const rowIds = ["head", ...rows.map((e) => e.id)];
  // The columns as the keyboard moves through them: the checkboxes first.
  const navKeys = ["select", ...shown.map((x) => x.key)];
  const r = Math.max(0, rowIds.indexOf(at.row));
  const c = Math.max(0, navKeys.indexOf(at.col));
  const here: At = { row: rowIds[r]!, col: navKeys[c]! };
  const cellEl = (to: At) => grid.current?.querySelector<HTMLElement>(`[data-cell="${CSS.escape(`${to.row}|${to.col}`)}"]`);
  // A long table's rows drawn now: those from the window's top to its bottom (worked out from where the
  // body is on the screen as anything scrolls), in steps of ten so a scroll draws again only now and then.
  const body = useRef<HTMLTableSectionElement>(null);
  const long = rows.length > LONG;
  const [rowHeight, setRowHeight] = useState(ROW_HEIGHT);
  const [win, setWin] = useState({ from: 0, to: 3 * OVERSCAN });
  useEffect(() => {
    if (!long) return;
    const update = () => {
      const el = body.current;
      if (!el) return;
      const h = el.querySelector("tr[aria-rowindex]")?.getBoundingClientRect().height || rowHeight;
      if (Math.abs(h - rowHeight) > 0.5) setRowHeight(h);
      const top = el.getBoundingClientRect().top;
      const from = Math.max(0, Math.floor((Math.floor(-top / h) - OVERSCAN) / 10) * 10);
      const to = Math.min(rows.length, Math.ceil((Math.ceil((window.innerHeight - top) / h) + OVERSCAN) / 10) * 10);
      setWin((w) => (w.from === from && w.to === to ? w : { from, to: Math.max(from, to) }));
    };
    update();
    document.addEventListener("scroll", update, { capture: true, passive: true });
    window.addEventListener("resize", update);
    return () => {
      document.removeEventListener("scroll", update, { capture: true });
      window.removeEventListener("resize", update);
    };
  }, [long, rows.length, rowHeight]);
  // The row being edited stays drawn, wherever the table's scrolled: what's typed in it isn't lost.
  const editedAt = editing ? rows.findIndex((e) => e.id === at.row) : -1;
  const from = !long ? 0 : editedAt >= 0 ? Math.min(win.from, editedAt) : win.from;
  const to = !long ? rows.length : Math.max(win.to, editedAt + 1);

  // The cell to move the focus to once it's drawn as the one in focus (and no longer being edited).
  const pending = useRef<At>(undefined);
  const focusCell = (to: At) => {
    setAt(to);
    pending.current = to;
    // Into a row of a long table that isn't drawn: drawn first, then the focus scrolls it into view.
    const i = rows.findIndex((e) => e.id === to.row);
    if (long && i >= 0 && (i < win.from || i >= win.to)) setWin({ from: Math.max(0, i - OVERSCAN), to: Math.min(rows.length, i + OVERSCAN) });
  };
  useEffect(() => {
    const to = pending.current;
    if (!to || editing) return;
    const el = cellEl(to);
    if (!el) return;
    pending.current = undefined;
    (el.querySelector<HTMLElement>("[data-focus]") ?? el).focus();
  });
  const move = (dr: number, dc: number) => focusCell({ row: rowIds[Math.min(rowIds.length - 1, Math.max(0, r + dr))]!, col: navKeys[Math.min(navKeys.length - 1, Math.max(0, c + dc))]! });

  // The rows chosen (kept by ID, so sorting again keeps them), and the one a Shift range runs from.
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string>(undefined);
  const selected = rows.filter((e) => chosen.has(e.id));
  const toggle = (id: string, on = !chosen.has(id)) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    setChosen(next);
    anchor.current = id;
  };
  /** The rows from the anchor to `to` chosen too. */
  const range = (to: string) => {
    const from = anchor.current ?? to;
    const [i, j] = [rows.findIndex((e) => e.id === from), rows.findIndex((e) => e.id === to)].sort((a, b) => a - b);
    const next = new Set(chosen);
    for (const e of rows.slice(Math.max(0, i!), j! + 1)) next.add(e.id);
    setChosen(next);
  };
  /** Shift+arrow: on to the next row, choosing it and the rows from the anchor. */
  const extend = (by: 1 | -1) => {
    if (r === 0) return move(by, 0);
    anchor.current ??= rowIds[r]!;
    const to = rowIds[Math.min(rowIds.length - 1, Math.max(1, r + by))]!;
    range(to);
    focusCell({ row: to, col: here.col });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (editing || e.altKey || e.metaKey) return;
    // A checkbox's own Space.
    if (e.key === " " && e.target instanceof HTMLInputElement) return;
    const keys: Record<string, () => void> = {
      ArrowDown: () => (e.shiftKey ? extend(1) : move(1, 0)),
      ArrowUp: () => (e.shiftKey ? extend(-1) : move(-1, 0)),
      " ": () => here.row !== "head" && toggle(here.row),
      ArrowRight: () => move(0, 1),
      ArrowLeft: () => move(0, -1),
      Home: () => (e.ctrlKey ? focusCell({ row: rowIds[1] ?? "head", col: navKeys[0]! }) : move(0, -navKeys.length)),
      End: () => (e.ctrlKey ? focusCell({ row: rowIds.at(-1)!, col: navKeys.at(-1)! }) : move(0, navKeys.length)),
      PageDown: () => move(10, 0),
      PageUp: () => move(-10, 0),
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  };

  /** Save a cell: the entry's file as it was when the cell was opened, or refused. */
  const save = async (entity: Entity, column: Column, base: string, value: FieldValue | undefined) => {
    const changes = column.kind === "tags" ? { tags: Array.isArray(value) ? value.map(String) : [] } : column.kind === "field" ? fieldEdit(novel, entity, column.field, value) : {};
    await api.bible.updateEntity(novelId, entity.id, base, changes);
    await queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
  };

  // What a row does, the same object every time (each call reaches the table as it is now), so sorting
  // or moving the focus draws again only the rows it changes: a long table re-sorts within a frame or two.
  const latest = useRef({ setAt, setEditing, save, move, focusCell, toggle, range, onOpen, novelId, anchor });
  latest.current = { setAt, setEditing, save, move, focusCell, toggle, range, onOpen, novelId, anchor };
  const actions = useMemo<RowActions>(
    () => ({
      focus: (row, col) => latest.current.setAt({ row, col }),
      edit: (on) => latest.current.setEditing(on),
      save: (...args) => latest.current.save(...args),
      leave: (row, col, by) => (by ? latest.current.move(0, by) : latest.current.focusCell({ row, col })),
      open: (to, e) => latest.current.onOpen(to, e),
      toggle: (id, on) => latest.current.toggle(id, on),
      shiftClick: (id) => {
        if (!latest.current.anchor.current) return false;
        latest.current.range(id);
        return true;
      },
      novelId: () => latest.current.novelId,
    }),
    [],
  );

  const plural = typePlural(type).toLowerCase();
  const copy = async () => {
    const copied = selected.length ? selected : rows;
    try {
      await navigator.clipboard.writeText(tableText(table, copied, shown));
      show({ message: `Copied ${copied.length} ${copied.length === 1 ? type.label.toLowerCase() : plural} as a table.` });
    } catch {
      show({ message: "Couldn't copy: the clipboard wasn't available. Try again with the window in front." });
    }
  };
  const [bulk, setBulk] = useState<Bulk>();
  const all = rows.length > 0 && selected.length === rows.length;
  const [columnsOpen, setColumnsOpen] = useState(false);
  // A new order, said: the rows change under the focus without a word otherwise.
  const [sorted, setSorted] = useState("");
  const sortAndSay = (col: Column) => {
    const next = kept?.sort?.key === col.key && kept.sort.direction === "ascending" ? "descending" : "ascending";
    sortBy(col);
    setSorted(`Sorted by ${col.label}, ${next}`);
  };
  const canRelate = relationshipTypes(novel, type.key).length > 0;
  // Everything the table does, in the palette too (#178).
  const acts = useRef({ copy, sortAndSay, setBulk, setChosen, rows, setColumnsOpen });
  acts.current = { copy, sortAndSay, setBulk, setChosen, rows, setColumnsOpen };
  useCommands(
    () => [
      { id: "table.columns", title: `Choose the table's columns…`, group: "Table", keywords: ["show", "hide", "order"], run: () => acts.current.setColumnsOpen(true) },
      { id: "table.copy", title: selected.length ? "Copy the selected rows as a table" : "Copy the table", group: "Table", keywords: ["spreadsheet", "clipboard"], run: () => void acts.current.copy() },
      ...shown.map((col) => ({ id: `table.sort.${col.key}`, title: `Sort the table by ${col.label}`, group: "Table", keywords: ["order"], run: () => acts.current.sortAndSay(col) })),
      { id: "table.selectAll", title: `Select every one of the ${plural}`, group: "Table", run: () => acts.current.setChosen(new Set(acts.current.rows.map((e) => e.id))) },
      ...(selected.length
        ? [
            { id: "table.tag", title: "Add a tag to the selected…", group: "Table", run: () => acts.current.setBulk("tag") },
            { id: "table.field", title: "Set a field on the selected…", group: "Table", run: () => acts.current.setBulk("field") },
            ...(canRelate ? [{ id: "table.relationship", title: "Add a relationship from the selected…", group: "Table", run: () => acts.current.setBulk("relationship") }] : []),
            { id: "table.clear", title: "Clear the selection", group: "Table", run: () => acts.current.setChosen(new Set()) },
          ]
        : []),
    ],
    [shown, selected.length > 0, plural, canRelate],
  );

  const caption = `${rows.length} ${(rows.length === 1 ? type.label : typePlural(type)).toLowerCase()}${gaps ? ` · ${gaps} ${gaps === 1 ? "gap" : "gaps"}` : ""}`;
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`type-${type.key}`} className="font-semibold">
          {typePlural(type)} <span className="text-sm font-normal text-muted">{rows.length}</span>
        </h2>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => void copy()} title={selected.length ? "Copy the selected rows, for a spreadsheet" : "Copy every row, for a spreadsheet"}>
            <Copy className="size-4" aria-hidden /> Copy as a table
          </Button>
          <ColumnsMenu columns={columns} shown={shown} onChange={(keys) => keep({ shown: keys })} open={columnsOpen} onOpenChange={setColumnsOpen} />
        </div>
      </div>
      <p aria-live="polite" className="sr-only">
        {selected.length ? `${selected.length} selected` : ""}
      </p>
      <p aria-live="polite" className="sr-only">
        {sorted}
      </p>
      {selected.length > 0 && (
        <div role="toolbar" aria-label="The selected rows" className="flex flex-wrap items-center gap-2 rounded-md bg-accent-soft px-2.5 py-1.5">
          <span className="text-sm font-semibold">{selected.length} selected</span>
          <Button size="sm" onClick={() => setBulk("tag")}>
            Add a tag…
          </Button>
          <Button size="sm" onClick={() => setBulk("field")}>
            Set a field…
          </Button>
          {relationshipTypes(novel, type.key).length > 0 && (
            <Button size="sm" onClick={() => setBulk("relationship")}>
              Add a relationship…
            </Button>
          )}
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setChosen(new Set())}>
            Clear
          </Button>
        </div>
      )}
      {bulk && <BulkDialog mode={bulk} novelId={novelId} novel={novel} type={type} entries={selected} columns={columns} onClose={() => setBulk(undefined)} focusAfter={() => grid.current?.querySelector<HTMLElement>('[tabindex="0"]')} />}
      {/* Relative: what's there for screen readers alone (an empty cell's "Empty") is placed in it, not down the page. */}
      <div className="relative min-w-0 overflow-x-auto rounded-md border border-rule bg-raised">
        <table ref={grid} role="grid" aria-labelledby={`type-${type.key}`} aria-describedby={`${type.key}-table-foot`} aria-rowcount={rows.length + 1} className="w-full border-separate border-spacing-0 text-sm" onKeyDown={onKeyDown}>
          <thead>
            <tr aria-rowindex={1}>
              <th scope="col" data-cell="head|select" className="sticky top-0 w-8 border-b border-rule bg-panel px-2.5 py-1.5 text-left">
                <input
                  type="checkbox"
                  data-focus=""
                  tabIndex={here.row === "head" && here.col === "select" ? 0 : -1}
                  aria-label={`Select every one of the ${rows.length} ${plural}`}
                  checked={all}
                  ref={(el) => {
                    if (el) el.indeterminate = selected.length > 0 && !all;
                  }}
                  onFocus={() => setAt({ row: "head", col: "select" })}
                  onChange={() => setChosen(all ? new Set() : new Set(rows.map((e) => e.id)))}
                />
              </th>
              {shown.map((col) => {
                const sorted = kept?.sort?.key === col.key ? kept.sort.direction : undefined;
                const active = here.row === "head" && here.col === col.key;
                return (
                  <th key={col.key} scope="col" aria-sort={sorted ?? "none"} data-cell={`head|${col.key}`} className="sticky top-0 border-b border-rule bg-panel px-2.5 py-1.5 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-muted uppercase">
                    <button
                      type="button"
                      data-focus=""
                      tabIndex={active ? 0 : -1}
                      onFocus={() => setAt({ row: "head", col: col.key })}
                      onClick={() => sortAndSay(col)}
                      title={`Sort by ${col.label.toLowerCase()}`}
                      className="inline-flex items-center gap-1 rounded uppercase hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                    >
                      {col.label}
                      {sorted === "ascending" ? <ArrowUp className="size-3.5" aria-hidden /> : sorted === "descending" ? <ArrowDown className="size-3.5" aria-hidden /> : null}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody ref={body}>
            {from > 0 && (
              <tr aria-hidden style={{ height: from * rowHeight }}>
                <td colSpan={shown.length + 1} />
              </tr>
            )}
            {rows.slice(from, to).map((entity, i) => {
              const col = here.row === entity.id ? here.col : undefined;
              return <Row key={entity.id} index={from + i + 2} entity={entity} table={table} shown={shown} href={href(entity.id)} current={entity.id === current} chosen={chosen.has(entity.id)} col={col} editing={!!col && editing} actions={actions} />;
            })}
            {to < rows.length && (
              <tr aria-hidden style={{ height: (rows.length - to) * rowHeight }}>
                <td colSpan={shown.length + 1} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p id={`${type.key}-table-foot`} className="text-xs text-muted">
        <span>{caption}</span>
        <span aria-hidden> · Enter edits a cell, Tab moves on, Esc leaves it as it was · Space selects a row</span>
      </p>
    </div>
  );
}

interface RowActions {
  focus: (row: string, col: string) => void;
  edit: (on: boolean) => void;
  save: (entity: Entity, column: Column, base: string, value: FieldValue | undefined) => Promise<void>;
  /** Back to the cell (0), or saved and on to the next (1) or the one before (-1). */
  leave: (row: string, col: string, by: 0 | 1 | -1) => void;
  open: (to: string, e?: MouseEvent) => Promise<void>;
  toggle: (id: string, on: boolean) => void;
  /** A Shift+click on its checkbox: the rows from the last one chosen to it chosen too; false if there's none to run from. */
  shiftClick: (id: string) => boolean;
  novelId: () => string;
}

/** A row: drawn again only when its entry, its columns or its state (chosen, open, the focus in it) change. */
const Row = memo(function Row({ index, entity, table, shown, href, current, chosen, col, editing, actions }: { index: number; entity: Entity; table: TableBook; shown: Column[]; href: string; current: boolean; chosen: boolean; col: string | undefined; editing: boolean; actions: RowActions }) {
  return (
    <tr aria-rowindex={index} aria-selected={chosen} className={cn((current || chosen) && "bg-accent-soft")}>
      <td data-cell={`${entity.id}|select`} className="border-b border-rule px-2.5 py-1.5 align-middle">
        <input
          type="checkbox"
          data-focus=""
          tabIndex={col === "select" ? 0 : -1}
          aria-label={`Select ${entity.name}`}
          checked={chosen}
          onFocus={() => actions.focus(entity.id, "select")}
          onClick={(e) => {
            if (e.shiftKey && actions.shiftClick(entity.id)) e.preventDefault();
          }}
          onChange={(e) => actions.toggle(entity.id, e.target.checked)}
        />
      </td>
      {shown.map((column) => (
        <Cell key={column.key} table={table} entity={entity} column={column} active={col === column.key} editing={col === column.key && editing} href={href} current={current} actions={actions} />
      ))}
    </tr>
  );
});

function Cell({ table, entity, column, active, editing, href, current, actions }: { table: TableBook; entity: Entity; column: Column; active: boolean; editing: boolean; href: string; current: boolean; actions: RowActions }) {
  const { book } = table;
  const text = cellText(table, entity, column);
  const gap = isGap(book, entity, column);
  // The entry's file as the cell was opened: its save is refused if it's changed since.
  const base = useRef<Promise<string>>(undefined);
  const start = () => {
    if (!editable(column)) return;
    base.current = api.readFile(actions.novelId(), entity.file).then((f) => f.hash);
    actions.edit(true);
  };
  const cell = cn("border-b border-rule px-2.5 py-1.5 align-middle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent", column.kind === "field" && column.field.holds === "number" && "text-right tabular-nums");
  if (editing && editable(column)) {
    return (
      <td data-cell={`${entity.id}|${column.key}`} className={cn(cell, "bg-raised p-1 shadow-[inset_0_0_0_2px_var(--color-accent)]")}>
        <CellEditor
          book={book}
          entity={entity}
          column={column}
          onDone={(by) => {
            actions.edit(false);
            actions.leave(entity.id, column.key, by);
          }}
          onSave={async (value) => actions.save(entity, column, (await base.current) ?? "", value)}
        />
      </td>
    );
  }
  let content: ReactNode = text;
  if (column.kind === "name") {
    content = (
      <a
        href={href}
        tabIndex={active ? 0 : -1}
        data-focus=""
        aria-current={current ? "page" : undefined}
        onClick={(e) => void actions.open(href, e)}
        className="font-semibold text-ink hover:underline focus-visible:outline-none"
      >
        {entity.name}
      </a>
    );
  } else if (gap) {
    content = (
      <span className="text-muted">
        <span aria-hidden>—</span>
        <span className="sr-only">Empty</span>
      </span>
    );
  }
  return (
    <td
      data-cell={`${entity.id}|${column.key}`}
      tabIndex={active && column.kind !== "name" ? 0 : -1}
      onFocus={() => actions.focus(entity.id, column.key)}
      onDoubleClick={start}
      onKeyDown={(e) => {
        // The name is a link: Enter opens the entry, as the list's rows do.
        if ((e.key === "Enter" || e.key === "F2") && column.kind !== "name") {
          e.preventDefault();
          start();
        }
      }}
      className={cell}
    >
      {content}
    </td>
  );
}

/**
 * A cell being edited, with a control for what its column holds: a line of text, a number, yes or no,
 * one of a choice's options, an entry or entries, or tags separated by commas. Emptied, the field comes
 * off the entry. Leaving the cell (but not for a list it opened) saves it.
 */
function CellEditor({ book, entity, column, onDone, onSave }: { book: Book; entity: Entity; column: Column; onDone: (by: 0 | 1 | -1) => void; onSave: (value: FieldValue | undefined) => Promise<void> }) {
  const id = useId();
  const field: EntryFieldDef | undefined = column.kind === "field" ? column.field : undefined;
  const label = field ? fieldLabel(field) : column.label;
  const initial = field ? fieldValue(book, entity, field) : entity.tags;
  const [text, setText] = useState(initial === undefined ? "" : Array.isArray(initial) ? (field ? "" : initial.join(", ")) : String(initial));
  const [ids, setIds] = useState<string[]>(Array.isArray(initial) && field ? [...initial] : typeof initial === "string" && field?.holds === "entry" ? [initial] : []);
  const [problem, setProblem] = useState<string>();
  const [saving, setSaving] = useState(false);
  const finished = useRef(false);
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined);

  const draft = (): FieldValue | undefined | Error => {
    const t = text.trim();
    if (!field) return t ? [...new Set(t.split(",").map((x) => x.trim()).filter(Boolean))] : [];
    switch (field.holds) {
      case "entry":
        return ids[0];
      case "entries":
        return ids.length ? ids : undefined;
      case "number": {
        if (!t) return undefined;
        const n = Number(t.replace(",", "."));
        return Number.isFinite(n) ? n : new Error(`${label} is a number.`);
      }
      case "yes-no":
        return t === "" ? undefined : t === "true";
      default:
        return t || undefined;
    }
  };
  // One save at a time: Enter and the blur that follows it save once.
  const inFlight = useRef(false);
  const save = async (by: 0 | 1 | -1, given?: { v: FieldValue | undefined }) => {
    if (finished.current || inFlight.current) return;
    const v = given ? given.v : draft();
    if (v instanceof Error) return setProblem(v.message);
    if (JSON.stringify(v ?? (field ? undefined : [])) === JSON.stringify(initial ?? (field ? undefined : []))) {
      finished.current = true;
      return onDone(by);
    }
    inFlight.current = true;
    setSaving(true);
    try {
      await onSave(v);
      finished.current = true;
      onDone(by);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  const cancel = () => {
    finished.current = true;
    onDone(0);
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (e.key === "Enter" && !(field?.holds === "long-text" && e.shiftKey) && !e.defaultPrevented) {
      e.preventDefault();
      void save(0);
    } else if (e.key === "Tab" && !e.defaultPrevented) {
      e.preventDefault();
      void save(e.shiftKey ? -1 : 1);
    }
  };
  const common = { id, "aria-label": `${label} of ${entity.name}`, "aria-invalid": problem ? true : undefined, "aria-describedby": problem ? `${id}-problem` : undefined, autoFocus: true, "aria-busy": saving || undefined };
  const input = "h-8 w-full min-w-28 rounded border border-rule bg-raised px-2 text-sm aria-invalid:border-danger";
  const type = field?.type ? book.entityTypes.find((t) => t.key === field.type) : undefined;
  const items = book.entities
    .filter((e) => e.id !== entity.id && (!field?.type || e.type === field.type))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({ value: e.id, label: e.name, keywords: e.aliases }));

  let control: ReactNode;
  if (field?.holds === "entry") {
    control = (
      <select {...common} value={ids[0] ?? ""} onChange={(e) => setIds(e.target.value ? [e.target.value] : [])} onKeyDown={keys} className={input}>
        <option value="">—</option>
        {items.map((i) => (
          <option key={i.value} value={i.value}>
            {i.label}
          </option>
        ))}
        {ids[0] && !items.some((i) => i.value === ids[0]) && <option value={ids[0]}>{ids[0]}</option>}
      </select>
    );
  } else if (field?.holds === "entries") {
    control = (
      <div onKeyDown={keys}>
        <Picker
          label={`${label} of ${entity.name}`}
          items={items}
          value={undefined}
          chosen={ids}
          onChange={(v) => v && setIds((was) => (was.includes(v) ? was.filter((x) => x !== v) : [...was, v]))}
          placeholder={ids.length ? ids.map((i) => book.entities.find((e) => e.id === i)?.name ?? i).join(", ") : `Choose ${type ? typePlural(type).toLowerCase() : "entries"}…`}
          className="[&>span:first-child]:sr-only"
        />
      </div>
    );
  } else if (field?.holds === "choice" || field?.holds === "yes-no") {
    const options = field.holds === "yes-no" ? [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] : (field.options ?? []).map((o) => ({ value: o, label: o }));
    control = (
      <select {...common} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={keys} className={input}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {text && !options.some((o) => o.value === text) && <option value={text}>{text}</option>}
      </select>
    );
  } else if (field?.holds === "long-text") {
    control = <textarea {...common} rows={3} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={keys} className={cn(input, "h-auto min-w-48 py-1")} />;
  } else {
    control = (
      <input
        {...common}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={keys}
        inputMode={field?.holds === "number" ? "decimal" : undefined}
        placeholder={field ? undefined : "Tags, separated by commas"}
        className={input}
      />
    );
  }
  return (
    <div
      data-part-editor=""
      className="grid gap-1"
      // Focus moving within it, or into a list it opened (React carries that focus here), stays.
      onFocus={() => clearTimeout(leaving.current)}
      onBlur={() => {
        clearTimeout(leaving.current);
        leaving.current = setTimeout(() => {
          if (!finished.current && document.hasFocus()) void save(0);
        });
      }}
    >
      {control}
      {problem && (
        <p id={`${id}-problem`} role="alert" className="max-w-64 text-xs text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}

/** Columns: which the table shows, and in what order (the name always first). */
function ColumnsMenu({ columns, shown, onChange, open, onOpenChange }: { columns: Column[]; shown: Column[]; onChange: (keys: string[]) => void; open: boolean; onOpenChange: (open: boolean) => void }) {
  const order = [...shown, ...columns.filter((c) => !shown.includes(c))];
  const keysOf = (cs: Column[]) => cs.filter((c) => c.kind !== "name").map((c) => c.key);
  const set = (key: string, on: boolean) => onChange(keysOf(order.filter((c) => (c.key === key ? on : shown.includes(c)))));
  const moveBy = (key: string, by: -1 | 1) => {
    const list = keysOf(shown);
    const i = list.indexOf(key);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    onChange(list);
  };
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <Button size="sm" variant="ghost">
          <Columns3 className="size-4" aria-hidden /> Columns
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content aria-label="Columns" align="end" sideOffset={4} className="z-[80] grid max-h-96 w-72 gap-0.5 overflow-y-auto rounded-md border border-rule bg-raised p-2 text-sm text-ink shadow-lg">
          <p className="px-1 pb-1 text-xs text-muted">Shown in this order. The name is always first.</p>
          <ul className="grid gap-0.5">
            {order
              .filter((c) => c.kind !== "name")
              .map((c) => {
                const on = shown.includes(c);
                return (
                  <li key={c.key} className="flex items-center gap-1 rounded px-1 hover:bg-panel">
                    <label className="flex min-w-0 flex-1 items-center gap-2 py-1">
                      <input type="checkbox" checked={on} onChange={(e) => set(c.key, e.target.checked)} />
                      <span className="truncate">{c.label}</span>
                      {c.kind === "field" && !c.declared && <span className="text-xs text-muted">its own</span>}
                    </label>
                    {on && (
                      <>
                        <button type="button" onClick={() => moveBy(c.key, -1)} aria-label={`Move ${c.label} left`} className="rounded p-1 text-muted hover:bg-paper hover:text-ink">
                          <ArrowUp className="size-3.5" aria-hidden />
                        </button>
                        <button type="button" onClick={() => moveBy(c.key, 1)} aria-label={`Move ${c.label} right`} className="rounded p-1 text-muted hover:bg-paper hover:text-ink">
                          <ArrowDown className="size-3.5" aria-hidden />
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

type Bulk = "tag" | "field" | "relationship";

/** The relationship types an entry of `type` can be the start of. */
function relationshipTypes(book: Book, type: string) {
  return book.relationshipTypes.filter((r) => !r.from_types?.length || r.from_types.includes(type));
}

/** "Ada Varn and Ben Varn", "Ada, Ben and Mirela", or "5 characters". */
function whom(type: Book["entityTypes"][number], entries: Entity[]): string {
  if (entries.length > 3) return `${entries.length} ${typePlural(type).toLowerCase()}`;
  const names = entries.map((e) => e.name);
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * One change to every selected entry: a tag added, a field set or cleared, or a relationship from each
 * to another entry. Saved in one commit, against the files as they are when it's saved; the notice
 * after it offers Undo, which puts every file back as one.
 */
function BulkDialog({ mode, novelId, novel, type, entries, columns, onClose, focusAfter }: { mode: Bulk; novelId: string; novel: Book; type: Book["entityTypes"][number]; entries: Entity[]; columns: Column[]; onClose: () => void; /** Where the focus goes after, when what opened it is gone (the palette). */ focusAfter: () => HTMLElement | null | undefined }) {
  const queryClient = useQueryClient();
  const show = useNotice((n) => n.show);
  const ids = { tag: useId(), field: useId(), value: useId(), rel: useId(), to: useId(), tags: useId() };
  const fields = columns.flatMap((c) => (c.kind === "field" ? [c] : []));
  const rels = relationshipTypes(novel, type.key);
  const [tag, setTag] = useState("");
  const [fieldKey, setFieldKey] = useState(fields[0]?.key ?? "");
  const [clear, setClear] = useState(false);
  const [value, setValue] = useState<string[]>([]);
  const [rel, setRel] = useState(rels[0]?.key ?? "");
  const [to, setTo] = useState("");
  const [problem, setProblem] = useState<string>();
  const [saving, setSaving] = useState(false);
  const field = fields.find((f) => f.key === fieldKey)?.field;
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
  const relType = rels.find((r) => r.key === rel);
  const title = mode === "tag" ? `Add a tag to ${whom(type, entries)}` : mode === "field" ? `Set a field on ${whom(type, entries)}` : `Add a relationship from ${whom(type, entries)}`;

  /** The value chosen for the field, as it holds it, or an Error saying what's wrong. */
  const fieldValueOf = (f: EntryFieldDef): FieldValue | undefined | Error => {
    if (clear) return undefined;
    const t = (value[0] ?? "").trim();
    switch (f.holds) {
      case "entries":
        return value.length ? value : new Error("Choose at least one.");
      case "number": {
        const n = Number(t.replace(",", "."));
        return t && Number.isFinite(n) ? n : new Error(`${fieldLabel(f)} is a number.`);
      }
      case "yes-no":
        return t === "true";
      default:
        return t ? t : new Error("Give it a value, or choose Clear it.");
    }
  };

  const submit = async () => {
    setProblem(undefined);
    let run: () => Promise<{ commit: string | null; files: string[] }>;
    let said: string;
    if (mode === "relationship") {
      if (!relType || !to) return setProblem("Choose the relationship and who it's with.");
      const from = entries.filter((e) => e.id !== to);
      if (!from.length) return setProblem("That's the only one selected: choose someone else.");
      run = () => api.bible.addRelationships(novelId, from.map((e) => ({ from: e.id, to, type: relType.key })));
      said = `Added “${relType.label ?? relType.key}” from ${whom(type, from)} to ${novel.entities.find((e) => e.id === to)?.name ?? to}.`;
    } else {
      let change: (e: Entity) => Parameters<typeof api.bible.updateEntity>[3] | undefined;
      if (mode === "tag") {
        const t = tag.trim();
        if (!t) return setProblem("A tag needs a name.");
        change = (e) => (e.tags.includes(t) ? undefined : { tags: [...e.tags, t] });
        said = `Tagged ${whom(type, entries)} “${t}”.`;
      } else {
        if (!field) return setProblem("Choose a field.");
        const v = fieldValueOf(field);
        if (v instanceof Error) return setProblem(v.message);
        change = (e) => (JSON.stringify(fieldValue(novel, e, field)) === JSON.stringify(v) ? undefined : fieldEdit(novel, e, field, v));
        said = `${v === undefined ? "Cleared" : "Set"} ${fieldLabel(field)} on ${whom(type, entries)}.`;
      }
      const changing = entries.flatMap((e) => {
        const c = change(e);
        return c ? [{ e, c }] : [];
      });
      if (!changing.length) return setProblem("They're all like that already.");
      run = async () => {
        const bases = await Promise.all(changing.map(({ e }) => api.readFile(novelId, e.file).then((f) => f.hash)));
        return api.bible.editEntries(novelId, changing.map(({ e, c }, i) => ({ id: e.id, base: bases[i]!, changes: c })));
      };
    }
    setSaving(true);
    try {
      const done = await run();
      await refresh();
      onClose();
      if (done.commit) {
        const commit = done.commit;
        show({
          message: said,
          action: {
            label: "Undo",
            run: () =>
              void api.bible.undo(novelId, commit, done.files).then(
                () => refresh(),
                () => show({ message: "They've changed since, so it wasn't undone." }),
              ),
          },
        });
      }
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const input = "h-9 w-full rounded-md border border-rule bg-raised px-2 text-sm";
  const label = "grid gap-1 text-sm font-medium";
  const entryOptions = (only?: string) =>
    novel.entities
      .filter((e) => !only || e.type === only)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => (
        <option key={e.id} value={e.id}>
          {e.name}
        </option>
      ));
  let valueControl: ReactNode = null;
  if (mode === "field" && field && !clear) {
    const v = value[0] ?? "";
    const one = (e: { target: { value: string } }) => setValue([e.target.value]);
    valueControl =
      field.holds === "entries" ? (
        <select id={ids.value} multiple value={value} onChange={(e) => setValue([...e.target.selectedOptions].map((o) => o.value))} className={cn(input, "h-32")}>
          {entryOptions(field.type)}
        </select>
      ) : field.holds === "entry" || field.holds === "choice" || field.holds === "yes-no" ? (
        <select id={ids.value} value={v} onChange={one} className={input}>
          <option value="">Choose…</option>
          {field.holds === "entry" ? entryOptions(field.type) : field.holds === "yes-no" ? [<option key="t" value="true">Yes</option>, <option key="f" value="false">No</option>] : (field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : field.holds === "long-text" ? (
        <textarea id={ids.value} rows={3} value={v} onChange={one} className={cn(input, "h-auto py-1")} />
      ) : (
        <input id={ids.value} value={v} onChange={one} inputMode={field.holds === "number" ? "decimal" : undefined} className={input} />
      );
  }
  const tags = [...new Set(novel.entities.flatMap((e) => e.tags))].sort();

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          // Back to what opened it; or, where that's gone (the palette) and the focus is left on the page, to focusAfter's.
          onCloseAutoFocus={() =>
            setTimeout(() => {
              if (!document.activeElement || document.activeElement === document.body) focusAfter()?.focus();
            })
          }
          className="fixed top-1/2 left-1/2 z-50 grid w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-rule bg-raised p-5 text-ink shadow-xl">
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {mode === "tag" && (
              <label htmlFor={ids.tag} className={label}>
                Tag
                <input
                  id={ids.tag}
                  list={ids.tags}
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  // WebKit keeps Enter for the suggestions' list: it adds the tag here too.
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                    e.preventDefault();
                    void submit();
                  }}
                  autoFocus
                  className={input}
                />
                <datalist id={ids.tags}>
                  {tags.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </label>
            )}
            {mode === "field" && (
              <>
                <label htmlFor={ids.field} className={label}>
                  Field
                  <select
                    id={ids.field}
                    value={fieldKey}
                    onChange={(e) => {
                      setFieldKey(e.target.value);
                      setValue([]);
                    }}
                    autoFocus
                    className={input}
                  >
                    {fields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset className="flex flex-wrap gap-4 text-sm">
                  <legend className="sr-only">Set or clear</legend>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" name={ids.value} checked={!clear} onChange={() => setClear(false)} /> Set it to
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" name={ids.value} checked={clear} onChange={() => setClear(true)} /> Clear it
                  </label>
                </fieldset>
                {valueControl && (
                  <label htmlFor={ids.value} className={label}>
                    {field ? fieldLabel(field) : "Value"}
                    {valueControl}
                  </label>
                )}
              </>
            )}
            {mode === "relationship" && (
              <>
                <label htmlFor={ids.rel} className={label}>
                  Relationship
                  <select id={ids.rel} value={rel} onChange={(e) => setRel(e.target.value)} autoFocus className={input}>
                    {rels.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label ?? r.key}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor={ids.to} className={label}>
                  With
                  <select id={ids.to} value={to} onChange={(e) => setTo(e.target.value)} className={input}>
                    <option value="">Choose…</option>
                    {entryOptions(relType?.to_types?.length === 1 ? relType.to_types[0] : undefined)}
                  </select>
                </label>
              </>
            )}
            {problem && (
              <p role="alert" className="text-sm text-danger">
                {problem}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button">Cancel</Button>
              </Dialog.Close>
              <Button type="submit" variant="primary" disabled={saving}>
                {mode === "tag" ? "Add the tag" : mode === "field" ? (clear ? "Clear it" : "Set it") : "Add it"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
