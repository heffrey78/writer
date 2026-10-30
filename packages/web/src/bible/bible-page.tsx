import { entryPresences, typePlural, vocabulary, word, type Entity, type EntryPresence, type Book, type Vocabulary } from "@writer/core";
import { Plus, Search } from "lucide-react";
import { Fragment, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { moduleRecordTypes } from "../modules.tsx";
import { Button } from "../ui/button.tsx";
import { Picture, usePictureUrl } from "./picture.tsx";
import { pictureAlt, shapeForType } from "./pictures.ts";
import { NewTypeDialog } from "./new-entry.tsx";
import { RelationshipTypes } from "./relationship-types.tsx";
import { markWords } from "./strip.tsx";
import { useBookKind, useWords } from "../novel/kind.ts";
import { entriesByType, matches } from "./types.ts";
import { PAGE } from "../ui/page.ts";
import { cn } from "../ui/cn.ts";

type Sort = "first" | "name" | "most";
const sorts = (w: Vocabulary): { key: Sort; label: string }[] => [
  { key: "first", label: "First appearance" },
  { key: "name", label: "Name" },
  { key: "most", label: `Most ${w.piece.many}` },
];

const MARK = { carries: "bg-accent", present: "bg-accent/40", mentioned: "bg-accent/15", absent: "bg-rule/60" } as const;

/**
 * The story bible (heffrey78/gh-writer#162): every entry as a card, grouped by type, with its picture (heffrey78/gh-writer#168), its summary, a fact or two, a
 * small strip of the scenes it's in and how many; searchable by name or other name and sorted by
 * first appearance, name or most scenes. The kind's modules add their records' sections after the
 * entries (off-page events). An entry or a record opens in a modal over it (`over`, heffrey78/gh-writer#236, heffrey78/gh-writer#237).
 */
export function BiblePage({ novelId, novel, over }: { novelId: string; novel: Book; over?: ReactNode }) {
  const w = vocabulary(novel.kind);
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const navigate = useNavigate();
  /** A new entry (of a type, or chosen), in its modal over the gallery. */
  const add = (type?: string) => void navigate(`/novels/${novelId}/bible/new${type ? `?type=${encodeURIComponent(type)}` : ""}`, { state: { fromGallery: true } });
  const [addingType, setAddingType] = useState(false);
  const searchId = useId();
  const sort: Sort = (params.get("sort") as Sort | null) ?? "first";
  const sortId = useId();
  const presences = useMemo(() => entryPresences(novel), [novel]);
  const order = (a: Entity, b: Entity) => {
    const pa = presences.get(a.id);
    const pb = presences.get(b.id);
    if (sort === "most") return (pb?.count ?? 0) - (pa?.count ?? 0) || a.name.localeCompare(b.name);
    if (sort === "first") {
      const at = (p: EntryPresence | undefined) => (p?.first ? novel.pieces.indexOf(p.first) : Infinity);
      return at(pa) - at(pb) || a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name);
  };
  const groups = entriesByType(novel).map((g) => ({ ...g, shown: g.entries.filter((e) => matches(e, query)).sort(order) }));
  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const found = groups.reduce((n, g) => n + g.shown.length, 0);
  const records = moduleRecordTypes(novel.kind);
  // Arriving at a group (the book pane's Off the page links to #off-the-page): scrolled to it.
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  return (
    <div className={cn(PAGE, "grid gap-6")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{w.codex.One}</h1>
        <div className="flex gap-2">
          <Button onClick={() => setAddingType(true)}>New type</Button>
          <Button variant="primary" onClick={() => add()}>
            <Plus className="size-4" aria-hidden /> New {w.entity.one}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1">
          <label htmlFor={searchId} className="sr-only">
            Search the {w.codex.short}
          </label>
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted" aria-hidden />
          <input
            id={searchId}
            type="search"
            placeholder="Search by name or other name"
            value={query}
            onChange={(e) => setParam("q", e.target.value || undefined)}
            className="h-9 w-full rounded-md border border-rule bg-raised pr-3 pl-9 text-sm"
          />
        </div>
        <label htmlFor={sortId} className="flex items-center gap-2 text-sm text-muted">
          Sort
          <select id={sortId} value={sort} onChange={(e) => setParam("sort", e.target.value === "first" ? undefined : e.target.value)} className="h-9 rounded-md border border-rule bg-raised px-2 text-ink">
            {sorts(w).map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {query && (
        <p role="status" className="text-sm text-muted">
          {w.entity.count(found)} match “{query}”{records.length > 0 && ` (and the ${records.map((t) => word(t.def.noun).many).join(" and ")} below that do)`}
        </p>
      )}
      {groups.map(({ type, entries, shown }) =>
        query && !shown.length ? null : (
          <section key={type.key} aria-labelledby={`type-${type.key}`} className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <h2 id={`type-${type.key}`} className="font-semibold">
                {typePlural(type)} <span className="text-sm font-normal text-muted">{entries.length}</span>
              </h2>
              <Button size="sm" variant="ghost" onClick={() => add(type.key)} aria-label={`New ${type.label.toLowerCase()}`}>
                <Plus className="size-4" aria-hidden /> New
              </Button>
            </div>
            {shown.length ? (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((e) => (
                  <li key={e.id} className="grid">
                    <EntryCard novelId={novelId} entity={e} presence={presences.get(e.id)} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No {typePlural(type).toLowerCase()} yet.</p>
            )}
          </section>
        ),
      )}
      {records.map((t) => (
        <Fragment key={t.type}>{t.gallery({ novelId, novel, query, sort })}</Fragment>
      ))}
      {!query && <RelationshipTypes novelId={novelId} novel={novel} />}
      <NewTypeDialog novelId={novelId} novel={novel} open={addingType} onOpenChange={setAddingType} />
      {over}
    </div>
  );
}

/**
 * An entry in the gallery: what it is at a glance, opening its profile. A portrait sits beside the
 * name (its initials where there's none); a place's picture is a banner across the card.
 */
function EntryCard({ novelId, entity, presence }: { novelId: string; entity: Entity; presence: EntryPresence | undefined }) {
  const shape = shapeForType(entity.type);
  const url = usePictureUrl(novelId, entity.image);
  const count = presence?.count ?? 0;
  const n = presence?.scenes.length ?? 0;
  const w = useWords();
  const words = markWords(useBookKind(), entity.type, w);
  const facts = [
    ...Object.entries(entity.fields)
      .slice(0, 2)
      .map(([, v]) => (typeof v === "boolean" ? null : String(v)))
      .filter(Boolean),
    ...(entity.aliases.length ? [`also ${entity.aliases.join(", ")}`] : []),
  ].slice(0, 2);
  return (
    <Link to={`/novels/${novelId}/bible/${entity.id}`} state={{ fromGallery: true }} className="grid content-start gap-2 rounded-lg border border-rule bg-raised px-4 py-3 hover:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
      {shape.key === "wide" ? (
        <>
          {url ? (
            <Picture src={url} alt={pictureAlt(shape, entity.name)} focus={entity.imageFocus} className="h-24 w-full rounded-md" />
          ) : (
            <span className="grid h-12 place-items-center rounded-md bg-panel text-[13px] text-muted">No picture yet</span>
          )}
          <span className="font-semibold">{entity.name}</span>
          {entity.summary && <span className="line-clamp-2 font-prose leading-snug">{entity.summary}</span>}
        </>
      ) : (
        <span className="flex items-start gap-3">
          {url ? (
            <Picture src={url} alt={pictureAlt(shape, entity.name)} focus={entity.imageFocus} className="h-[70px] w-14 shrink-0 rounded-md" />
          ) : (
            <span aria-hidden className="grid h-[70px] w-14 shrink-0 place-items-center rounded-md bg-panel text-lg font-semibold text-muted">
              {initials(entity.name)}
            </span>
          )}
          <span className="grid min-w-0 gap-1">
            <span className="font-semibold">{entity.name}</span>
            {entity.summary && <span className="line-clamp-2 font-prose leading-snug">{entity.summary}</span>}
          </span>
        </span>
      )}
      {facts.length > 0 && <span className="text-[13px] text-muted">{facts.join(" · ")}</span>}
      <span className="flex items-center gap-2.5">
        {n > 0 && (
          <span aria-hidden className="grid flex-1" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: n > 40 ? 0 : 2 }}>
            {presence!.scenes.map(({ scene, mark }) => (
              <span key={scene.id} title={`${scene.title}: ${mark === "absent" ? "not there" : (words[mark] ?? words.present)}`} className={`h-2 rounded-[2px] ${MARK[mark]}`} />
            ))}
          </span>
        )}
        <span className="text-xs whitespace-nowrap text-muted">{count === 0 ? `Not in the ${w.content.one} yet` : w.piece.count(count)}</span>
      </span>
    </Link>
  );
}

/** "AV" for Ada Varn: a card's stand-in for a portrait. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => [...w.replace(/^\P{L}+/u, "")][0]!.toUpperCase())
    .join("");
}
