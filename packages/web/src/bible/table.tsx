import { fieldLabel, typePlural, type Book, type Entity, type EntryFieldDef, type EntryPresence, type FieldValue } from "@writer/core";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Columns3 } from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { api, keys } from "../api.ts";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { Picker } from "../ui/picker.tsx";
import { allColumns, cellText, fieldEdit, fieldValue, isGap, shownColumns, sortRows, type Column, type Direction, type TableBook } from "./table-columns.ts";

/*
 * The index's Table view (#139, #168): one type's entries side by side, a row each, its fields as
 * columns. It's an ARIA grid: the arrow keys move from cell to cell (Home and End along a row, Ctrl with
 * them to the corners), a header's button sorts by its column, and Enter edits the cell in focus with a
 * control for what its field holds. Enter saves, Escape leaves it as it was, and Tab saves and moves on.
 * A save is refused, as on the profile, if the entry's file changed since the cell was opened.
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
  const table: TableBook = useMemo(() => ({ book: novel, presences }), [novel, presences]);
  const columns = useMemo(() => allColumns(novel, type.key), [novel, type.key]);
  const [kept, setKept] = useKept(novelId, type.key);
  const shown = shownColumns(columns, kept);
  const keep = (change: Partial<Kept>) => setKept({ shown: shown.map((c) => c.key), known: columns.map((c) => c.key), ...(kept?.sort ? { sort: kept.sort } : {}), ...change });
  const sortColumn = kept?.sort && shown.find((c) => c.key === kept.sort!.key);
  const rows = sortColumn ? sortRows(table, listed, sortColumn, kept!.sort!.direction) : listed;
  const sortBy = (c: Column) => keep({ sort: { key: c.key, direction: kept?.sort?.key === c.key && kept.sort.direction === "ascending" ? "descending" : "ascending" } });
  const gaps = rows.reduce((n, e) => n + shown.filter((c) => isGap(novel, e, c)).length, 0);

  // The cell in focus (the grid's one stop for Tab), and whether it's being edited.
  const [at, setAt] = useState<At>({ row: "head", col: "name" });
  const [editing, setEditing] = useState(false);
  const grid = useRef<HTMLTableElement>(null);
  const rowIds = ["head", ...rows.map((e) => e.id)];
  const r = Math.max(0, rowIds.indexOf(at.row));
  const c = Math.max(0, shown.findIndex((x) => x.key === at.col));
  const here: At = { row: rowIds[r]!, col: shown[c]!.key };
  const cellEl = (to: At) => grid.current?.querySelector<HTMLElement>(`[data-cell="${CSS.escape(`${to.row}|${to.col}`)}"]`);
  // The cell to move the focus to once it's drawn as the one in focus (and no longer being edited).
  const pending = useRef<At>(undefined);
  const focusCell = (to: At) => {
    setAt(to);
    pending.current = to;
  };
  useEffect(() => {
    const to = pending.current;
    if (!to || editing) return;
    const el = cellEl(to);
    if (!el) return;
    pending.current = undefined;
    (el.querySelector<HTMLElement>("[data-focus]") ?? el).focus();
  });
  const move = (dr: number, dc: number) => focusCell({ row: rowIds[Math.min(rowIds.length - 1, Math.max(0, r + dr))]!, col: shown[Math.min(shown.length - 1, Math.max(0, c + dc))]!.key });

  const onKeyDown = (e: KeyboardEvent) => {
    if (editing || e.altKey || e.metaKey) return;
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(1, 0),
      ArrowUp: () => move(-1, 0),
      ArrowRight: () => move(0, 1),
      ArrowLeft: () => move(0, -1),
      Home: () => (e.ctrlKey ? focusCell({ row: rowIds[1] ?? "head", col: "name" }) : move(0, -shown.length)),
      End: () => (e.ctrlKey ? focusCell({ row: rowIds.at(-1)!, col: shown.at(-1)!.key }) : move(0, shown.length)),
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

  const caption = `${rows.length} ${(rows.length === 1 ? type.label : typePlural(type)).toLowerCase()}${gaps ? ` · ${gaps} ${gaps === 1 ? "gap" : "gaps"}` : ""}`;
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`type-${type.key}`} className="font-semibold">
          {typePlural(type)} <span className="text-sm font-normal text-muted">{rows.length}</span>
        </h2>
        <ColumnsMenu columns={columns} shown={shown} onChange={(keys) => keep({ shown: keys })} />
      </div>
      <div className="min-w-0 overflow-x-auto rounded-md border border-rule bg-raised">
        <table ref={grid} role="grid" aria-labelledby={`type-${type.key}`} aria-describedby={`${type.key}-table-foot`} aria-rowcount={rows.length + 1} className="w-full border-separate border-spacing-0 text-sm" onKeyDown={onKeyDown}>
          <thead>
            <tr aria-rowindex={1}>
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
                      onClick={() => sortBy(col)}
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
          <tbody>
            {rows.map((entity, i) => (
              <tr key={entity.id} aria-rowindex={i + 2} className={cn(entity.id === current && "bg-accent-soft")}>
                {shown.map((col) => {
                  const active = here.row === entity.id && here.col === col.key;
                  return (
                    <Cell
                      key={col.key}
                      novelId={novelId}
                      table={table}
                      entity={entity}
                      column={col}
                      active={active}
                      editing={active && editing}
                      href={href(entity.id)}
                      current={entity.id === current}
                      onOpen={onOpen}
                      onFocus={() => setAt({ row: entity.id, col: col.key })}
                      onEdit={(on) => setEditing(on)}
                      onSave={save}
                      onLeave={(by) => (by ? move(0, by) : focusCell({ row: entity.id, col: col.key }))}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p id={`${type.key}-table-foot`} className="text-xs text-muted">
        <span>{caption}</span>
        <span aria-hidden> · Enter edits a cell, Tab moves on, Esc leaves it as it was</span>
      </p>
    </div>
  );
}

function Cell({
  novelId,
  table,
  entity,
  column,
  active,
  editing,
  href,
  current,
  onOpen,
  onFocus,
  onEdit,
  onSave,
  onLeave,
}: {
  novelId: string;
  table: TableBook;
  entity: Entity;
  column: Column;
  active: boolean;
  editing: boolean;
  href: string;
  current: boolean;
  onOpen: (to: string, e?: MouseEvent) => Promise<void>;
  onFocus: () => void;
  onEdit: (on: boolean) => void;
  onSave: (entity: Entity, column: Column, base: string, value: FieldValue | undefined) => Promise<void>;
  /** Back to the cell (0), or saved and on to the next (1) or the one before (-1). */
  onLeave: (by: 0 | 1 | -1) => void;
}) {
  const { book } = table;
  const text = cellText(table, entity, column);
  const gap = isGap(book, entity, column);
  // The entry's file as the cell was opened: its save is refused if it's changed since.
  const base = useRef<Promise<string>>(undefined);
  const start = () => {
    if (!editable(column)) return;
    base.current = api.readFile(novelId, entity.file).then((f) => f.hash);
    onEdit(true);
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
            onEdit(false);
            onLeave(by);
          }}
          onSave={async (value) => onSave(entity, column, (await base.current) ?? "", value)}
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
        onClick={(e) => void onOpen(href, e)}
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
      onFocus={onFocus}
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
function ColumnsMenu({ columns, shown, onChange }: { columns: Column[]; shown: Column[]; onChange: (keys: string[]) => void }) {
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
    <Popover.Root>
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
