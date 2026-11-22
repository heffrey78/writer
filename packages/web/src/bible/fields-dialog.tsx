import { fieldLabel, fieldsOfType, sharedFields, typePlural, vocabulary, type Book, type EntryFieldDef, type FieldHolds } from "@writer/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, GripVertical, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { create } from "zustand";
import { api, keys } from "../api.ts";
import { ErrorAlert } from "../ui/alert.tsx";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { Modal } from "../ui/dialog.tsx";

/*
 * A type's fields for this book (#138, #164): added, renamed, moved (by keyboard or by dragging),
 * changed in what they hold and removed, saved together as the type's list in book.yaml. A field
 * renamed can take its values with it in every entry of the type. "Use the fields these entries
 * already have" offers the keys two or more of them share. Removing a field never removes a value:
 * the entries keep it, shown under Other.
 */

/** Which type's fields are being changed: opened from the index, a type's heading or the palette. */
export const useFieldsDialog = create<{ type: string | undefined; open: (type: string) => void; close: () => void }>((set) => ({
  type: undefined,
  open: (type) => set({ type }),
  close: () => set({ type: undefined }),
}));

/** A type's entries in running text: "characters", but "NPCs" as written. */
export const pluralInText = (type: { label: string; plural?: string }) => {
  const p = typePlural(type);
  return /^[A-Z]{2}/.test(p) ? p : p.toLowerCase();
};

/** The dialog's title, and what opens it: "Fields of characters". */
export const fieldsTitle = (type: { label: string; plural?: string }) => `Fields of ${pluralInText(type)}`;

/** What a field may hold, in words. */
const HOLDS_WORDS: Record<FieldHolds, string> = {
  text: "Text",
  "long-text": "Long text",
  number: "A number",
  "yes-no": "Yes or no",
  choice: "One of a list",
  entry: "An entry",
  entries: "Entries",
  time: "A time",
};

/** A field in the dialog: its declaration as it's being edited, with the key it had (to rename its values) and its options as typed. */
interface Row extends EntryFieldDef {
  id: number;
  was?: string;
  optionsText: string;
  /** Its key follows its label until the key is changed by hand. */
  keyFromLabel: boolean;
}

let next = 0;
const row = (f: EntryFieldDef, was?: string): Row => ({ ...f, id: ++next, ...(was ? { was } : {}), label: f.label ?? fieldLabel(f), optionsText: (f.options ?? []).join(", "), keyFromLabel: !was });
const keyOf = (label: string) =>
  label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+|_+$/g, "");

/** The dialog for whichever type useFieldsDialog names; `onNewFormat` asks to move a book in gh-writer's format first. */
export function FieldsDialog({ novelId, novel, onNewFormat }: { novelId: string; novel: Book; onNewFormat: (() => void) | undefined }) {
  const { type: key, close } = useFieldsDialog();
  useEffect(() => () => close(), [novelId, close]);
  const type = novel.entityTypes.find((t) => t.key === key);
  if (!type) return null;
  const title = fieldsTitle(type);
  return (
    <Modal title={title} onClose={close} className="w-[min(44rem,calc(100vw-2rem))]">
      {onNewFormat ? (
        <>
          <p className="text-sm text-muted">A type's fields are kept in the book's settings, which this book has in gh-writer's format. Move it to the new format first.</p>
          <div className="flex justify-end gap-2">
            <Button onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                close();
                onNewFormat();
              }}
            >
              Move to the new format…
            </Button>
          </div>
        </>
      ) : (
        <Editing key={type.key} novelId={novelId} novel={novel} type={type} close={close} />
      )}
    </Modal>
  );
}

function Editing({ novelId, novel, type, close }: { novelId: string; novel: Book; type: Book["entityTypes"][number]; close: () => void }) {
  const queryClient = useQueryClient();
  const w = vocabulary(novel.kind);
  const plural = pluralInText(type);
  const [rows, setRows] = useState<Row[]>(() => fieldsOfType(novel, type.key).map((f) => row(f, f.key)));
  const [said, setSaid] = useState("");
  const [renaming, setRenaming] = useState<Record<string, boolean>>({});
  const [dragging, setDragging] = useState<number>();
  const list = useRef<HTMLOListElement>(null);
  const focusLabel = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (focusLabel.current === undefined) return;
    list.current?.querySelector<HTMLInputElement>(`[data-row="${focusLabel.current}"] input`)?.focus();
    focusLabel.current = undefined;
  });

  const entries = novel.entities.filter((e) => e.type === type.key);
  const suggestions = sharedFields(novel, type.key, rows.map((r) => r.key));
  const set = (id: number, changes: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...changes } : r)));
  const move = (id: number, by: number) => {
    const at = rows.findIndex((r) => r.id === id);
    const to = at + by;
    if (to < 0 || to >= rows.length) return;
    const moved = [...rows];
    moved.splice(to, 0, ...moved.splice(at, 1));
    setRows(moved);
    setSaid(`${rows[at]!.label} moved to ${to + 1} of ${rows.length}.`);
  };
  const add = (f: EntryFieldDef = { key: "", holds: "text" }) => {
    const r = { ...row(f), ...(f.key ? { label: fieldLabel(f), keyFromLabel: false } : {}) };
    setRows((rs) => [...rs, r]);
    focusLabel.current = r.id;
    setSaid(f.key ? `Added ${r.label}.` : "Added a field.");
  };

  // A field whose key changed, with values under its old key in entries of the type: offered to rename there.
  const renamed = rows.filter((r) => r.was && r.was !== r.key && entries.some((e) => e.fields[r.was!] !== undefined));
  const problem = (() => {
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r.key) return `${r.label || "A field"} needs a key: lowercase letters, digits and _.`;
      if (!/^[a-z][a-z0-9_]*$/.test(r.key)) return `“${r.key}” can't be a key: lowercase letters, digits and _, starting with a letter.`;
      if (seen.has(r.key)) return `Two fields have the key “${r.key}”.`;
      seen.add(r.key);
      if (r.holds === "choice" && !r.optionsText.split(",").some((o) => o.trim())) return `${r.label || r.key} is one of a list: give its options, separated by commas.`;
    }
    return undefined;
  })();

  const save = useMutation({
    mutationFn: () =>
      api.bible.setTypeFields(
        novelId,
        type.key,
        rows.map(({ key, label, holds, optionsText, type: of, card, changes }) => ({
          key,
          ...(label && label !== fieldLabel({ key }) ? { label } : {}),
          holds,
          ...(holds === "choice" ? { options: optionsText.split(",").map((o) => o.trim()).filter(Boolean) } : {}),
          ...((holds === "entry" || holds === "entries") && of ? { type: of } : {}),
          ...(card ? { card } : {}),
          ...(changes ? { changes } : {}),
        })),
        renamed.filter((r) => renaming[r.id] !== false).map((r) => ({ from: r.was!, to: r.key })),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
      close();
    },
  });

  const ids = useId();
  const control = "h-8 w-full min-w-0 rounded-md border border-rule bg-raised px-2 text-sm";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem) save.mutate();
      }}
      className="grid gap-4"
    >
      <p className="text-sm text-muted">
        The fields every {type.label.toLowerCase()} has, in order. An entry's value is written to its file once it's filled; removing a field here keeps the values, shown under Other.
      </p>
      <p role="status" className="sr-only">
        {said}
      </p>
      {rows.length ? (
        <ol ref={list} aria-label={`Fields of ${plural}`} className="grid max-h-[50vh] gap-2 overflow-y-auto">
          {rows.map((r, i) => {
            const name = r.label || r.key || "New field";
            return (
              <li
                key={r.id}
                data-row={r.id}
                aria-label={name}
                draggable
                onDragStart={(e) => {
                  setDragging(r.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => dragging !== undefined && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragging === undefined || dragging === r.id) return;
                  move(dragging, i - rows.findIndex((x) => x.id === dragging));
                  setDragging(undefined);
                }}
                onDragEnd={() => setDragging(undefined)}
                onKeyDown={(e) => {
                  // Alt+Up and Alt+Down move the field, wherever in it the focus is.
                  if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                  e.preventDefault();
                  move(r.id, e.key === "ArrowUp" ? -1 : 1);
                }}
                className={cn("grid gap-2 rounded-md border border-rule bg-paper p-2", dragging === r.id && "opacity-50")}
              >
                <div className="flex flex-wrap items-end gap-2">
                  <GripVertical className="mb-2 size-4 shrink-0 cursor-grab text-muted" aria-hidden />
                  <label className="grid min-w-32 flex-[2] gap-1 text-xs font-medium">
                    Label
                    <input
                      value={r.label}
                      onChange={(e) => set(r.id, { label: e.target.value, ...(r.keyFromLabel ? { key: keyOf(e.target.value) } : {}) })}
                      className={control}
                    />
                  </label>
                  <label className="grid min-w-24 flex-1 gap-1 text-xs font-medium">
                    Key
                    <input value={r.key} onChange={(e) => set(r.id, { key: e.target.value.trim(), keyFromLabel: false })} spellCheck={false} className={cn(control, "font-mono text-xs")} />
                  </label>
                  <label className="grid min-w-32 flex-1 gap-1 text-xs font-medium">
                    Holds
                    <select value={r.holds} onChange={(e) => set(r.id, { holds: e.target.value as FieldHolds })} className={control}>
                      {(Object.keys(HOLDS_WORDS) as FieldHolds[]).map((h) => (
                        <option key={h} value={h}>
                          {HOLDS_WORDS[h]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {r.holds === "choice" && (
                  <label className="grid gap-1 pl-6 text-xs font-medium">
                    Options, separated by commas
                    <input value={r.optionsText} onChange={(e) => set(r.id, { optionsText: e.target.value })} placeholder="alive, dead, missing" className={control} />
                  </label>
                )}
                {(r.holds === "entry" || r.holds === "entries") && (
                  <label className="grid gap-1 pl-6 text-xs font-medium">
                    Of the type
                    <select value={r.type ?? ""} onChange={(e) => set(r.id, { type: e.target.value || undefined })} className={control}>
                      <option value="">Any {w.entity.one}</option>
                      {novel.entityTypes.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-6 text-sm">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={!!r.card} onChange={(e) => set(r.id, { card: e.target.checked })} /> On cards
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={!!r.changes} onChange={(e) => set(r.id, { changes: e.target.checked })} /> Can change from one {w.piece.one} to another
                  </label>
                  <span className="flex-1" />
                  <Button size="sm" variant="ghost" onClick={() => move(r.id, -1)} disabled={i === 0} aria-label={`Move ${name} up`} title="Move up (Alt+Up)">
                    <ArrowUp className="size-4" aria-hidden />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => move(r.id, 1)} disabled={i === rows.length - 1} aria-label={`Move ${name} down`} title="Move down (Alt+Down)">
                    <ArrowDown className="size-4" aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setRows((rs) => rs.filter((x) => x.id !== r.id));
                      setSaid(`Removed ${name}.`);
                    }}
                    aria-label={`Remove ${name}`}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted">No fields yet.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => add()}>
          <Plus className="size-4" aria-hidden /> Add a field
        </Button>
      </div>

      {suggestions.length > 0 && (
        <section aria-labelledby={`${ids}-shared`} className="grid gap-2 rounded-md border border-rule p-2">
          <h3 id={`${ids}-shared`} className="text-sm font-medium">
            Use the fields these {plural} already have
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {suggestions.map((f) => (
              <li key={f.key}>
                <Button size="sm" onClick={() => add(f)} aria-label={`Add ${fieldLabel(f)}, ${HOLDS_WORDS[f.holds].toLowerCase()}`}>
                  <Plus className="size-3.5" aria-hidden /> {fieldLabel(f)} <span className="text-muted">· {HOLDS_WORDS[f.holds].toLowerCase()}</span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {renamed.length > 0 && (
        <fieldset className="grid gap-1 text-sm">
          <legend className="font-medium">Renamed</legend>
          {renamed.map((r) => {
            const count = entries.filter((e) => e.fields[r.was!] !== undefined).length;
            return (
              <label key={r.id} className="flex items-center gap-1.5">
                <input type="checkbox" checked={renaming[r.id] !== false} onChange={(e) => setRenaming((was) => ({ ...was, [r.id]: e.target.checked }))} />
                Rename “{r.was}” to “{r.key}” in {count} {count === 1 ? type.label.toLowerCase() : plural}
              </label>
            );
          })}
        </fieldset>
      )}

      {problem && <p className="text-sm text-danger">{problem}</p>}
      {save.isError && <ErrorAlert title="Couldn't save the fields">{save.error instanceof Error ? save.error.message : String(save.error)}</ErrorAlert>}
      <div className="flex justify-end gap-2">
        <Button onClick={close}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!!problem || save.isPending}>
          {save.isPending ? "Saving…" : "Save the fields"}
        </Button>
      </div>
    </form>
  );
}
