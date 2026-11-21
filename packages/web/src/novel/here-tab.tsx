import { entriesInPiece, entryIds, itemText, vocabulary, type Book, type InPiece, type Piece } from "@writer/core";
import type { SpellService } from "@writer/editor/react";
import { ChevronDown } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Link } from "react-router";
import { EntryPage } from "../bible/entry-page.tsx";
import { Picture, usePictureUrl } from "../bible/picture.tsx";
import { shapeForType } from "../bible/pictures.ts";
import { cardFacts, initials } from "../bible/types.ts";
import { moduleRecordType } from "../modules.tsx";
import { cn } from "../ui/cn.ts";
import type { Workspace } from "./workspace.ts";

/*
 * In this scene (#149): everyone and everything in the piece being written, each once, with its role
 * there and what its card says, so a name needn't be opened to be checked. One expands in place to its
 * profile at the sidebar's size; Open goes to it in the index.
 */

interface Props {
  novelId: string;
  novel: Book;
  workspace: Workspace;
  spell: { service: SpellService; onAddWord: (w: string) => void } | undefined;
  piece: Piece;
}

export function HereTab({ novelId, novel, workspace, spell, piece }: Props) {
  const w = vocabulary(novel.kind);
  const here = useMemo(() => entriesInPiece(novel, piece.id), [novel, piece.id]);
  const [open, setOpen] = useState<string>();
  const heading = useId();
  return (
    <section aria-labelledby={heading} className="grid content-start gap-2 p-4 text-sm">
      <h2 id={heading} className="text-xs font-semibold tracking-wide text-muted uppercase">
        {piece.title} · {here.length}
      </h2>
      {here.length === 0 ? (
        <p className="text-muted">
          No one and nothing is named in this {w.piece.one} yet. Type @ in the text to mention {w.entity.a}, or add one on the {w.piece.One} tab.
        </p>
      ) : (
        <ul aria-label={`In “${piece.title}”`} className="grid gap-1.5">
          {here.map((x) => (
            <HereRow key={x.id} {...{ novelId, novel, workspace, spell, piece }} item={x} expanded={open === x.id} onToggle={() => setOpen(open === x.id ? undefined : x.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function HereRow({ novelId, novel, workspace, spell, piece, item, expanded, onToggle }: Props & { item: InPiece; expanded: boolean; onToggle: () => void }) {
  const w = vocabulary(novel.kind);
  const entity = novel.entities.find((e) => e.id === item.id);
  const record = entity ? undefined : novel.moduleRecords.find((r) => r.id === item.id);
  const recordType = record && moduleRecordType(novel.kind, record.type);
  const picture = usePictureUrl(novelId, entity?.image);
  const ids = { panel: useId(), heading: useId() };
  const name = entity?.name ?? record?.title ?? item.id;
  const wide = shapeForType(entity?.type ?? "").key === "wide";

  // What its field says of it here, as the piece's card does: " (minor) “First sign of the sale”".
  const field = novel.kind.fields.find((f) => f.key === item.via);
  const value = field ? piece.fields[field.key] : undefined;
  const listed = field && Array.isArray(value) ? value.find((v) => entryIds(field, [v])[0] === item.id) : undefined;
  const role = item.role + (field && listed !== undefined ? itemText(field, listed) : "");
  const facts = entity ? cardFacts(entity) : [];
  const to = entity ? `/novels/${novelId}/bible/${entity.id}` : `/novels/${novelId}/${record!.type}/${record!.id}`;

  return (
    <li className={cn("rounded-lg border bg-paper", expanded ? "border-accent" : "border-rule")}>
      <div className="flex items-center gap-2 py-1.5 pr-2 pl-2">
        {picture ? (
          // Decorative: the name beside it says who it is.
          <Picture src={picture} alt="" decorative focus={entity?.imageFocus} className={wide ? "h-7 w-10 shrink-0 rounded" : "h-10 w-8 shrink-0 rounded"} />
        ) : (
          <span aria-hidden className={cn("grid shrink-0 place-items-center rounded bg-panel text-[11px] font-semibold text-muted", wide ? "h-7 w-10" : "h-10 w-8")}>
            {initials(name)}
          </span>
        )}
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={expanded ? ids.panel : undefined}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md text-left focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          <span className="grid min-w-0 flex-1">
            <span className="truncate font-semibold">{name}</span>
            <span className="truncate text-xs text-muted">
              {role}
              {facts.length ? ` · ${facts.join(" · ")}` : ""}
            </span>
          </span>
          <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform", expanded && "rotate-180")} aria-hidden />
        </button>
        <Link to={to} aria-label={`Open ${name} in the ${w.codex.short}`} className="shrink-0 rounded px-1.5 py-1 text-xs text-accent hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
          Open
        </Link>
      </div>
      {expanded && (
        <div id={ids.panel} className="border-t border-rule p-3">
          {entity ? (
            <EntryPage novelId={novelId} novel={novel} entity={entity} workspace={workspace} spell={spell} embedded={{ headingId: ids.heading }} size="tab" />
          ) : record && recordType ? (
            recordType.page({ novelId, novel, workspace, record, spell, embedded: { headingId: ids.heading }, size: "tab" })
          ) : null}
        </div>
      )}
    </li>
  );
}
