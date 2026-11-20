import { roleOf, typePlural, vocabulary, type Book, type EntryFilters } from "@writer/core";
import { Plus, X } from "lucide-react";
import { Popover } from "radix-ui";
import { useId, useState, type KeyboardEvent } from "react";
import { Button } from "../ui/button.tsx";

/*
 * The index's filters (#134), as chips under its search: by type, tag, a field's value, a part or
 * chapter, a role a piece gives (a novel's point of view), and entries not in the book yet. They're kept
 * in the address, so a filtered list can be bookmarked and Back brings it back.
 */

/** The address's keys the filters are kept under. */
export const FILTER_KEYS = ["type", "tag", "field", "value", "in", "role", "absent"] as const;

/** The filters an address holds. */
export function filtersOf(params: URLSearchParams): EntryFilters {
  const list = (key: string) => params.get(key)?.split(",").filter(Boolean) ?? [];
  const field = params.get("field");
  return {
    ...(list("type").length ? { types: list("type") } : {}),
    ...(list("tag").length ? { tags: list("tag") } : {}),
    ...(field ? { field: { key: field, value: params.get("value") ?? "" } } : {}),
    ...(params.get("in") ? { in: params.get("in")! } : {}),
    ...(params.get("role") ? { role: params.get("role")! } : {}),
    ...(params.get("absent") ? { absent: true } : {}),
  };
}

export const anyFilter = (f: EntryFilters) => Object.keys(f).length > 0;

type Kind = "type" | "tag" | "field" | "in" | "role" | "absent";

/** The kind's fields that name entries, by the role they give: a novel's point of view, set here, present. */
const roleFields = (novel: Book) => novel.kind.fields.filter((f) => f.type.kind === "entity" || f.type.kind === "entities" || f.type.kind === "own-entities");
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The parts and chapters (in the kind's words), outermost first, each with its level's word. */
function sections(novel: Book): { id: string; label: string }[] {
  const w = vocabulary(novel.kind);
  const depth = (id: string | undefined): number => {
    let n = 0;
    for (let at = novel.allSections.find((s) => s.id === id)?.parentId; at; at = novel.allSections.find((s) => s.id === at)?.parentId) n++;
    return n;
  };
  return novel.sections.map((s) => ({ id: s.id, label: `${" ".repeat(depth(s.id))}${w.level(s.level).One}: ${s.title || "Untitled"}` }));
}

export function FilterBar({ novel, filters, onChange }: { novel: Book; filters: EntryFilters; onChange: (changes: Record<string, string | undefined>) => void }) {
  const w = vocabulary(novel.kind);
  const chips: { key: string; label: string; remove: Record<string, string | undefined> }[] = [];
  for (const t of filters.types ?? []) {
    const type = novel.entityTypes.find((x) => x.key === t);
    const rest = (filters.types ?? []).filter((x) => x !== t).join(",");
    chips.push({ key: `type:${t}`, label: type ? typePlural(type) : t, remove: { type: rest || undefined } });
  }
  for (const t of filters.tags ?? []) {
    const rest = (filters.tags ?? []).filter((x) => x !== t).join(",");
    chips.push({ key: `tag:${t}`, label: `Tag: ${t}`, remove: { tag: rest || undefined } });
  }
  if (filters.field) chips.push({ key: "field", label: `${sentence(filters.field.key.replace(/_/g, " "))}: ${filters.field.value}`, remove: { field: undefined, value: undefined } });
  if (filters.in) {
    const s = novel.allSections.find((x) => x.id === filters.in);
    chips.push({ key: "in", label: `In “${s?.title || filters.in}”`, remove: { in: undefined } });
  }
  if (filters.role) {
    const f = novel.kind.fields.find((x) => x.key === filters.role);
    chips.push({ key: "role", label: sentence(f ? roleOf(f) : filters.role), remove: { role: undefined } });
  }
  if (filters.absent) chips.push({ key: "absent", label: `Not in the ${w.content.one} yet`, remove: { absent: undefined } });

  const onChipKey = (e: KeyboardEvent<HTMLButtonElement>, remove: Record<string, string | undefined>) => {
    if (e.key !== "Backspace" && e.key !== "Delete") return;
    e.preventDefault();
    const next = (e.currentTarget.nextElementSibling ?? e.currentTarget.previousElementSibling) as HTMLElement | null;
    onChange(remove);
    next?.focus();
  };

  return (
    <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onChange(c.remove)}
          onKeyDown={(e) => onChipKey(e, c.remove)}
          aria-label={`Remove the filter: ${c.label}`}
          title="Remove the filter (Backspace)"
          className="flex h-7 items-center gap-1 rounded-full border border-accent bg-accent-soft px-2.5 text-xs text-accent hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          {c.label} <X className="size-3" aria-hidden />
        </button>
      ))}
      <AddFilter novel={novel} filters={filters} onAdd={onChange} />
    </div>
  );
}

function AddFilter({ novel, filters, onAdd }: { novel: Book; filters: EntryFilters; onAdd: (changes: Record<string, string | undefined>) => void }) {
  const w = vocabulary(novel.kind);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("type");
  const [value, setValue] = useState("");
  const [fieldValue, setFieldValue] = useState("");
  const ids = { kind: useId(), value: useId(), fieldValue: useId(), heading: useId() };
  const tags = [...new Set(novel.entities.flatMap((e) => e.tags))].sort((a, b) => a.localeCompare(b));
  const fieldKeys = [...new Set(novel.entities.flatMap((e) => Object.keys(e.fields)))].sort((a, b) => a.localeCompare(b));
  const fieldValues = (key: string) => [...new Set(novel.entities.flatMap((e) => (e.fields[key] === undefined ? [] : [String(e.fields[key])])))].sort((a, b) => a.localeCompare(b));
  const roles = roleFields(novel);

  const kinds: { key: Kind; label: string; options: { value: string; label: string }[] }[] = [
    { key: "type" as const, label: "Type", options: novel.entityTypes.filter((t) => !filters.types?.includes(t.key)).map((t) => ({ value: t.key, label: typePlural(t) })) },
    { key: "tag" as const, label: "Tag", options: tags.filter((t) => !filters.tags?.includes(t)).map((t) => ({ value: t, label: t })) },
    { key: "field" as const, label: "A field's value", options: fieldKeys.map((k) => ({ value: k, label: sentence(k.replace(/_/g, " ")) })) },
    { key: "in" as const, label: `In a ${novel.kind.levels.map((l) => l.label.toLowerCase()).join(" or ")}`, options: sections(novel).map((s) => ({ value: s.id, label: s.label })) },
    { key: "role" as const, label: "Role", options: roles.map((f) => ({ value: f.key, label: sentence(roleOf(f)) })) },
    { key: "absent" as const, label: `Not in the ${w.content.one} yet`, options: [] },
  ].filter((k) => k.key === "absent" ? !filters.absent : k.options.length > 0);

  const current = kinds.find((k) => k.key === kind) ?? kinds[0];
  const chosen = current && current.options.some((o) => o.value === value) ? value : (current?.options[0]?.value ?? "");
  const values = current?.key === "field" ? fieldValues(chosen) : [];
  const chosenValue = values.includes(fieldValue) ? fieldValue : (values[0] ?? "");

  const add = () => {
    if (!current) return;
    const join = (list: readonly string[] | undefined, v: string) => [...(list ?? []), v].join(",");
    if (current.key === "type") onAdd({ type: join(filters.types, chosen) });
    else if (current.key === "tag") onAdd({ tag: join(filters.tags, chosen) });
    else if (current.key === "field") onAdd({ field: chosen, value: chosenValue });
    else if (current.key === "in") onAdd({ in: chosen });
    else if (current.key === "role") onAdd({ role: chosen });
    else onAdd({ absent: "1" });
    setOpen(false);
  };

  if (!kinds.length) return null;
  const select = "h-8 w-full rounded-md border border-rule bg-paper px-2 text-sm";
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="flex h-7 items-center gap-1 rounded-full border border-dashed border-rule px-2.5 text-xs text-muted hover:border-accent hover:text-ink">
          <Plus className="size-3" aria-hidden /> Filter
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} aria-labelledby={ids.heading} className="z-40 grid w-72 gap-3 rounded-lg border border-rule bg-raised p-3 text-sm text-ink shadow-lg">
          <h2 id={ids.heading} className="font-semibold">
            Filter the {w.codex.short ?? w.codex.one}
          </h2>
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <label htmlFor={ids.kind} className="grid gap-1 text-xs font-medium">
              By
              <select id={ids.kind} value={current?.key} onChange={(e) => setKind(e.target.value as Kind)} className={select}>
                {kinds.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            {current && current.key !== "absent" && (
              <label htmlFor={ids.value} className="grid gap-1 text-xs font-medium">
                {current.key === "field" ? "Field" : current.label}
                <select id={ids.value} value={chosen} onChange={(e) => setValue(e.target.value)} className={select}>
                  {current.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {current?.key === "field" && (
              <label htmlFor={ids.fieldValue} className="grid gap-1 text-xs font-medium">
                Value
                <select id={ids.fieldValue} value={chosenValue} onChange={(e) => setFieldValue(e.target.value)} className={select}>
                  {values.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button type="submit" size="sm" variant="primary" className="justify-self-start">
              Add the filter
            </Button>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
