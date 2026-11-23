import { entriesNaming, fieldLabel, fieldsAt, fieldsOfType, fieldText, typePlural, uniqueId, vocabulary, type Book, type Entity, type EntryFieldDef, type FieldChange, type FieldValue } from "@writer/core";
import { X } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { api } from "../api.ts";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { Picker, type PickerItem } from "../ui/picker.tsx";
import { AddButton, EditorButtons, EditorFrame, FieldRows, PencilButton, readField, type InPlace } from "./profile.tsx";

/*
 * An entry's fields on its profile (#138, #163): those its type declares, in order, each edited with a
 * control for what it holds (an entry from a picker of that type's, with New … there), and empty ones
 * offered as Add…, written to the file only once filled. Fields the entry has of its own follow under
 * Other, named and edited as before.
 */

type Fields = Record<string, FieldValue>;

interface Props {
  novelId: string;
  novel: Book;
  entity: Entity;
  place: InPlace;
  /** Save the entry's fields, or its changes at pieces, as they are to be: resolves once saved, throws to say why it couldn't be. */
  save: (changes: { fields?: Fields; changes?: FieldChange[] | null }) => Promise<unknown>;
  compact?: boolean;
  /** The piece the profile is read at (#140), or none: the whole book, each field's latest value. */
  at: string | undefined;
  onAt: (at: string | undefined) => void;
  /** The level of its "Other" heading: under the entry's name, h2 where that's the page's h1. */
  heading?: "h2" | "h3";
}

export function EntryFields({ novelId, novel, entity, place, save, compact, at, onAt, heading: Sub = "h3" }: Props) {
  const change = (fields: Fields) => save({ fields });
  const w = vocabulary(novel.kind);
  const readAtId = useId();
  const declared = fieldsOfType(novel, entity.type);
  const reading = fieldsAt(novel, entity, at);
  const changes = entity.changes ?? [];
  const order = new Map(novel.pieces.map((p, i) => [p.id, i]));
  const title = (id: string) => novel.allPieces.find((p) => p.id === id)?.title ?? id;
  /** A field's changes in reading order (those from a piece not in it last). */
  const changesOf = (key: string) => changes.filter((c) => c.field === key).sort((a, b) => (order.get(a.since) ?? Infinity) - (order.get(b.since) ?? Infinity));
  /**
   * A changing field's new value, as the profile is read: at a piece, from that piece on; over the whole
   * book, its latest (its last change's, or the start's when it has none). Other fields, the start's.
   */
  const setValue = (f: EntryFieldDef, v: FieldValue | undefined) => {
    if (!f.changes) return change(withValue(f.key, v));
    if (at !== undefined) return save({ changes: [...changes.filter((c) => !(c.field === f.key && c.since === at)), { field: f.key, value: v ?? null, since: at }] });
    const last = changesOf(f.key).at(-1);
    if (!last) return change(withValue(f.key, v));
    return save({ changes: changes.map((c) => (c === last ? { ...c, value: v ?? null } : c)) });
  };
  const changing = declared.some((f) => f.changes) || changes.length > 0;
  const own = Object.entries(entity.fields).filter(([k]) => !declared.some((f) => f.key === k));
  const keys = [...declared.map((f) => f.key), ...own.map(([k]) => k)];
  /** The fields with `key` set to `value`, or taken off (undefined); a new key goes last, as in the file. */
  const withValue = (key: string, value: FieldValue | undefined): Fields => {
    const next = { ...entity.fields };
    if (value === undefined) delete next[key];
    else next[key] = value;
    return next;
  };
  /** The fields with the entry's own field at `at` changed, renamed or removed, in their order. */
  const withOwn = (name: string, to: [string, FieldValue] | undefined): Fields => {
    const entries = Object.entries(entity.fields);
    const at = entries.findIndex(([k]) => k === name);
    if (at < 0) return to ? { ...entity.fields, [to[0]]: to[1] } : entity.fields;
    if (to) entries.splice(at, 1, to);
    else entries.splice(at, 1);
    return Object.fromEntries(entries);
  };

  return (
    <div className="grid gap-1">
      {changing && (
        <div className="flex flex-wrap items-center gap-2 pb-1">
          <label htmlFor={readAtId} className="text-[13px] text-muted">
            Read at
          </label>
          <select id={readAtId} value={at ?? ""} onChange={(e) => onAt(e.target.value || undefined)} className="h-7 max-w-full min-w-0 rounded-md border border-rule bg-raised px-1.5 text-[13px]">
            <option value="">The whole {w.book.one}: the latest</option>
            {novel.pieces.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title || `Untitled ${w.piece.one}`}
              </option>
            ))}
          </select>
        </div>
      )}
      {declared.length > 0 && (
        <dl aria-label="Fields" className="grid gap-0.5">
          {declared.map((f) => {
            const value = reading.fields[f.key];
            const from = reading.from[f.key];
            const part = `field:${f.key}`;
            const label = fieldLabel(f);
            const history = at === undefined ? changesOf(f.key) : [];
            const hint = !f.changes ? undefined : at !== undefined ? `From “${title(at)}” on` : history.length ? `Its latest value, from “${title(history.at(-1)!.since)}”` : `From the start of the ${w.book.one}`;
            return (
              <div key={f.key} className={cn("group -mx-1.5 flex items-baseline gap-2.5 rounded-md px-1.5", compact ? "py-0.5" : "py-1")}>
                <dt className={cn("shrink-0 text-[13px] text-muted", compact ? "w-24" : "w-32")}>{label}</dt>
                <dd className="grid min-w-0 flex-1 gap-0.5">
                  <div className="flex min-w-0 items-baseline gap-1">
                    {place.editing === part ? (
                      <ValueEditor novelId={novelId} novel={novel} self={entity.id} place={place} field={f} value={value} hint={hint} onSave={(v) => setValue(f, v)} />
                    ) : value === undefined ? (
                      <button ref={place.trigger(part)} type="button" onClick={() => place.start(part)} aria-label={`Add ${label.toLowerCase()}`} className="rounded px-1 text-[13px] text-muted hover:bg-paper hover:text-ink">
                        Add…
                      </button>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 break-words whitespace-pre-line">
                          {shown(novelId, novel, f, value)}
                          {from && <span className="text-[13px] text-muted"> · from “{title(from)}”</span>}
                        </span>
                        <PencilButton place={place} part={part} label={label.toLowerCase()} />
                      </>
                    )}
                  </div>
                  {history.length > 0 && place.editing !== part && (
                    <ul aria-label={`Changes of ${label.toLowerCase()}`} className="grid gap-0.5 text-[13px] text-muted">
                      {history.map((c) => (
                        <li key={`${c.since}:${String(c.value)}`} className="flex items-center gap-1">
                          <span className="min-w-0 flex-1">
                            From “{title(c.since)}”: {c.value === null ? "nothing" : readField(c.value, novel)}
                          </span>
                          <button
                            type="button"
                            onClick={() => void save({ changes: changes.filter((x) => x !== c) })}
                            aria-label={`Remove the change of ${label.toLowerCase()} at “${title(c.since)}”`}
                            className="rounded p-0.5 hover:bg-paper hover:text-ink"
                          >
                            <X className="size-3.5" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {own.length > 0 && (
        <>
          {declared.length > 0 && <Sub className="pt-2 text-xs font-semibold tracking-wide text-muted uppercase">Other</Sub>}
          <FieldRows
            fields={own}
            compact={compact}
            names={novel}
            value={(key, value) =>
              place.editing === `field:${key}` ? (
                <FieldEditor place={place} name={key} value={value} others={keys.filter((k) => k !== key)} onSave={(to) => change(withOwn(key, to))} />
              ) : (
                <>
                  <span className="flex-1">{readField(value, novel)}</span>
                  {/* A list of entries its type doesn't declare is edited in the file, not as a line of text. */}
                  {!Array.isArray(value) && <PencilButton place={place} part={`field:${key}`} label={key.replace(/_/g, " ")} />}
                </>
              )
            }
          />
        </>
      )}
      {place.editing === "field:" ? (
        <FieldEditor place={place} name="" value="" others={keys} onSave={(to) => change(withOwn("", to))} />
      ) : (
        <AddButton place={place} part="field:">
          Add a field
        </AddButton>
      )}
    </div>
  );
}

/** A value as the profile reads it: an entry it names as a link to it, a list as links. */
function shown(novelId: string, novel: Book, f: EntryFieldDef, value: FieldValue): ReactNode {
  if ((f.holds !== "entry" && f.holds !== "entries") || typeof value === "number" || typeof value === "boolean") return readField(value, novel);
  const ids = Array.isArray(value) ? value : [value];
  return ids.map((id, i) => (
    <span key={id}>
      {i > 0 && ", "}
      <EntryLink novelId={novelId} novel={novel} id={id} />
    </span>
  ));
}

function EntryLink({ novelId, novel, id }: { novelId: string; novel: Book; id: string }) {
  const named = novel.entities.find((e) => e.id === id);
  // Text where an ID was meant, or an entry since deleted: as written (the validator says which).
  if (!named) return <>{id}</>;
  return (
    <Link to={`/novels/${novelId}/bible/${id}`} className="text-accent underline decoration-accent/35 underline-offset-[3px] hover:decoration-accent">
      {named.name}
    </Link>
  );
}

/** The entries a field may name: those of its type, or (no type) every entry, grouped by type. */
function entryItems(novel: Book, f: EntryFieldDef, except: string): PickerItem[] {
  return novel.entities
    .filter((e) => e.id !== except && (!f.type || e.type === f.type))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({ value: e.id, label: e.name, keywords: e.aliases, ...(f.type ? {} : { group: typePlural(novel.entityTypes.find((t) => t.key === e.type) ?? { label: e.type }) }) }));
}

/**
 * A declared field's value edited in place, with a control for what it holds: a line or lines of text,
 * a number, yes or no, one of its options, an entry or entries from a picker. Emptied, the field comes
 * off the entry. Enter (or Save) saves, Escape leaves it as it was.
 */
function ValueEditor({
  novelId,
  novel,
  self,
  place,
  field: f,
  value,
  hint,
  onSave,
}: {
  novelId: string;
  novel: Book;
  /** The entry whose field it is: not offered as its own faction or home. */
  self: string;
  place: InPlace;
  field: EntryFieldDef;
  value: FieldValue | undefined;
  /** Where the value holds from, for a field that changes: "From “The Betrayal” on". */
  hint?: string | undefined;
  onSave: (value: FieldValue | undefined) => Promise<unknown>;
}) {
  const id = useId();
  const label = fieldLabel(f);
  const [text, setText] = useState(value === undefined || Array.isArray(value) ? "" : String(value));
  const [ids, setIds] = useState<string[]>(Array.isArray(value) ? [...value] : typeof value === "string" && f.holds === "entry" ? [value] : []);
  const [problem, setProblem] = useState<string>();
  const [saving, setSaving] = useState(false);
  // Entries named here by New …, made when the field is saved.
  const made = useRef(new Map<string, string>());
  const type = f.type ? novel.entityTypes.find((t) => t.key === f.type) : undefined;
  const entity = (id: string) => novel.entities.find((e) => e.id === id);

  const draft = (): FieldValue | undefined | Error => {
    const t = text.trim();
    switch (f.holds) {
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
  /** Save what's chosen, or `given` (an entry just picked, saved at once). */
  const save = async (given?: { v: FieldValue | undefined }) => {
    const v = given ? given.v : draft();
    if (v instanceof Error) return (setProblem(v.message), false);
    if (JSON.stringify(v) === JSON.stringify(value)) return (place.done(), true);
    setSaving(true);
    try {
      // An entry named by New … is made first, with the ID the field names it by.
      for (const [newId, name] of made.current) {
        if (type && (v === newId || (Array.isArray(v) && v.includes(newId)))) await api.bible.createEntity(novelId, type.key, { name }, "", newId);
      }
      await onSave(v);
      place.done();
      return true;
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  };
  const enter = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !(f.holds === "long-text" && e.shiftKey)) {
      e.preventDefault();
      void save();
    }
  };
  const input = "h-8 w-full min-w-0 rounded-md border border-rule bg-raised px-2 text-sm aria-invalid:border-danger";
  const common = { id, "aria-invalid": problem ? true : undefined, "aria-describedby": problem ? `${id}-problem` : undefined };
  const create = type && {
    noun: type.label.toLowerCase(),
    create: (name: string) => {
      const n = name.trim();
      if (!n) return undefined;
      const fresh = uniqueId(type.prefix, new Set([...novel.entities.map((e) => e.id), ...made.current.keys()]));
      made.current.set(fresh, n);
      return fresh;
    },
  };
  const items = [...entryItems(novel, f, self), ...[...made.current].map(([value, label]) => ({ value, label }))];

  let control: ReactNode;
  if (f.holds === "entry") {
    control = <Picker label={label} items={items} value={ids[0]} onChange={(v) => {
          setIds(v ? [v] : []);
          void save({ v });
        }} placeholder={`Choose ${type ? `${/^[aeiou]/i.test(type.label) ? "an" : "a"} ${type.label.toLowerCase()}` : vocabulary(novel.kind).entity.a}…`} allowNone {...(create ? { create } : {})} />;
  } else if (f.holds === "entries") {
    control = (
      <div className="grid gap-1.5">
        <Picker label={label} items={items} value={undefined} chosen={ids} onChange={(v) => v && setIds((was) => (was.includes(v) ? was.filter((x) => x !== v) : [...was, v]))} placeholder={ids.length ? ids.map((i) => entity(i)?.name ?? made.current.get(i) ?? i).join(", ") : "Choose…"} {...(create ? { create } : {})} />
      </div>
    );
  } else if (f.holds === "choice") {
    control = (
      <label htmlFor={id} className="grid gap-1 text-xs font-medium">
        {label}
        <select {...common} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={enter} className={input}>
          <option value="">—</option>
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          {/* A value written by hand that isn't one of them, kept until changed. */}
          {text && !(f.options ?? []).includes(text) && <option value={text}>{text}</option>}
        </select>
      </label>
    );
  } else if (f.holds === "yes-no") {
    control = (
      <label htmlFor={id} className="grid gap-1 text-xs font-medium">
        {label}
        <select {...common} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={enter} className={input}>
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>
    );
  } else {
    control = (
      <label htmlFor={id} className="grid gap-1 text-xs font-medium">
        {label}
        {f.holds === "long-text" ? (
          <textarea {...common} rows={3} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={enter} className={cn(input, "h-auto py-1")} />
        ) : (
          <input {...common} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={enter} inputMode={f.holds === "number" ? "decimal" : undefined} placeholder={f.holds === "time" ? "As the book's calendar writes it" : undefined} className={input} />
        )}
      </label>
    );
  }

  return (
    <EditorFrame place={place} className="flex-1" save={save}>
      {control}
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {problem && (
        <p id={`${id}-problem`} className="text-xs text-danger">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <EditorButtons onSave={() => void save()} onCancel={() => place.done()} saving={saving} hint={f.holds === "long-text" ? "Enter saves · Shift+Enter for a new line · Esc cancels" : "Enter saves · Esc cancels"} />
        {value !== undefined && (
          <Button size="sm" variant="ghost" onClick={() => void onSave(undefined).then(() => place.done(), (e: unknown) => setProblem(e instanceof Error ? e.message : String(e)))} disabled={saving}>
            <X className="size-4" aria-hidden /> Clear
          </Button>
        )}
      </div>
    </EditorFrame>
  );
}

/**
 * A field the entry has of its own, edited in place: its name and value (a number stays a number,
 * true/false a checkbox), saved together; Remove takes it off. A name another field has is refused.
 */
export function FieldEditor({
  place,
  name,
  value,
  others,
  onSave,
}: {
  place: InPlace;
  name: string;
  value: FieldValue;
  others: string[];
  onSave: (to: [string, FieldValue] | undefined) => Promise<unknown>;
}) {
  const [key, setKey] = useState(name);
  const [text, setText] = useState(String(value));
  const [problem, setProblem] = useState<string>();
  const [saving, setSaving] = useState(false);
  const isNew = name === "";
  const run = async (to: [string, FieldValue] | undefined) => {
    setSaving(true);
    try {
      await onSave(to);
      // Back to the field under its name now, or, removed, to "+ Add a field".
      place.done(to ? `field:${to[0]}` : "field:");
      return true;
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  };
  const save = async () => {
    const k = key.trim();
    // A new field left with nothing in it is no field.
    if (isNew && !k && !text.trim()) return (place.done(), true);
    if (!k) return (setProblem("A field needs a name."), false);
    if (others.includes(k)) return (setProblem(`There's already a field “${k}”.`), false);
    const v: FieldValue = typeof value === "boolean" ? text === "true" : typeof value === "number" && text.trim() !== "" && !Number.isNaN(Number(text)) ? Number(text) : text.trim();
    if (k === name && v === value) return (place.done(), true);
    return run([k, v]);
  };
  const enter = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void save();
    }
  };
  return (
    <EditorFrame place={place} className="flex-1" save={save}>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <label className="grid gap-1 text-xs font-medium">
          Field name
          <input value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={enter} className="h-8 w-full min-w-0 rounded-md border border-rule bg-raised px-2 text-sm font-normal" />
        </label>
        {typeof value === "boolean" ? (
          <label className="flex items-center gap-2 self-end pb-1.5 text-sm">
            <input type="checkbox" checked={text === "true"} onChange={(e) => setText(String(e.target.checked))} />
            {key || "Value"}
          </label>
        ) : (
          <label className="grid gap-1 text-xs font-medium">
            Value
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={enter} inputMode={typeof value === "number" ? "decimal" : undefined} className="h-8 w-full min-w-0 rounded-md border border-rule bg-raised px-2 text-sm font-normal" />
          </label>
        )}
      </div>
      {problem && <p className="text-xs text-danger">{problem}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <EditorButtons onSave={() => void save()} onCancel={() => place.done()} saving={saving} hint="Enter saves · Esc cancels" />
        {!isNew && (
          <Button size="sm" variant="ghost" onClick={() => void run(undefined)} disabled={saving}>
            <X className="size-4" aria-hidden /> Remove the field
          </Button>
        )}
      </div>
    </EditorFrame>
  );
}

/**
 * The entries whose fields name this one (#138): a faction's NPCs, a place's people, a person's books,
 * each under its type and the field ("NPCs · Faction").
 */
export function NamedBy({ novelId, novel, entity, compact }: { novelId: string; novel: Book; entity: Entity; compact?: boolean }) {
  const heading = useId();
  const naming = entriesNaming(novel, entity.id);
  if (!naming.length) return null;
  const groups = new Map<string, { title: string; entries: Entity[] }>();
  for (const { entry, field } of naming) {
    const type = novel.entityTypes.find((t) => t.key === entry.type);
    const key = `${entry.type}:${field.key}`;
    const group = groups.get(key) ?? { title: `${type ? typePlural(type) : entry.type} · ${fieldLabel(field)}`, entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  }
  return (
    <section aria-labelledby={heading} className="grid gap-1 border-t border-rule pt-4">
      <h2 id={heading} className="text-xs font-semibold tracking-wide text-muted uppercase">
        Named in their fields
      </h2>
      <dl className="grid gap-0.5">
        {[...groups.values()].map((g) => (
          <div key={g.title} className={cn("flex items-baseline gap-2.5", compact ? "py-0.5" : "py-1")}>
            <dt className={cn("shrink-0 text-[13px] text-muted", compact ? "w-24" : "w-32")}>{g.title}</dt>
            <dd className="min-w-0 flex-1">
              {g.entries
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((e, i) => (
                  <span key={e.id}>
                    {i > 0 && ", "}
                    <EntryLink novelId={novelId} novel={novel} id={e.id} />
                  </span>
                ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
