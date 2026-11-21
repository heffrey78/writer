import { entriesInPiece, entryIds, itemText, namesNotLinkedIn, vocabulary, type Book, type InPiece, type Passage, type Piece } from "@writer/core";
import { linkName, passageRange } from "@writer/editor";
import type { SpellService } from "@writer/editor/react";
import { ChevronDown, Pin, PinOff } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Link } from "react-router";
import { useStore } from "zustand";
import { EntryPage } from "../bible/entry-page.tsx";
import { linkPassage } from "../bible/link-passage.ts";
import { setPinned, usePinnedEntries } from "../bible/pins.ts";
import { Picture, usePictureUrl } from "../bible/picture.tsx";
import { shapeForType } from "../bible/pictures.ts";
import { cardFacts, initials } from "../bible/types.ts";
import { moduleRecordType } from "../modules.tsx";
import { cn } from "../ui/cn.ts";
import { useWritingEditor } from "./writing-view.tsx";
import type { Workspace } from "./workspace.ts";

/*
 * In this scene (#149): everyone and everything in the piece being written, each once, with its role
 * there and what its card says, so a name needn't be opened to be checked. One expands in place to its
 * profile at the sidebar's size; Open goes to it in the index. Entries pinned (#156) come first in
 * every piece; the names the piece writes without a link are listed under the cards, to link.
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
  const pins = usePinnedEntries(novelId);
  const [open, setOpen] = useState<string>();
  const [said, setSaid] = useState("");
  const heading = useId();
  const nameOf = (id: string) => novel.entities.find((e) => e.id === id)?.name ?? novel.moduleRecords.find((r) => r.id === id)?.title;
  // Pinned first, as they're in this piece or not; those since deleted are left out.
  const pinned: InPiece[] = pins.flatMap((id) => (nameOf(id) === undefined ? [] : [here.find((x) => x.id === id) ?? { id, via: "", role: `not in this ${w.piece.one}` }]));
  const rest = here.filter((x) => !pins.includes(x.id));
  const row = (x: InPiece) => (
    <HereRow
      key={x.id}
      {...{ novelId, novel, workspace, spell, piece }}
      item={x}
      expanded={open === x.id}
      onToggle={() => setOpen(open === x.id ? undefined : x.id)}
      pinned={pins.includes(x.id)}
      onPin={(pin) => {
        setPinned(novelId, x.id, pin);
        setSaid(pin ? `Pinned ${nameOf(x.id)} beside the text.` : `Unpinned ${nameOf(x.id)}.`);
      }}
    />
  );
  return (
    <section aria-labelledby={heading} className="grid content-start gap-2 p-4 text-sm">
      <p role="status" className="sr-only">
        {said}
      </p>
      {pinned.length > 0 && (
        <>
          <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">Pinned</h2>
          <ul aria-label="Pinned" className="grid gap-1.5">
            {pinned.map(row)}
          </ul>
        </>
      )}
      <h2 id={heading} className={cn("text-xs font-semibold tracking-wide text-muted uppercase", pinned.length > 0 && "pt-2")}>
        {piece.title} · {here.length}
      </h2>
      {here.length === 0 ? (
        <p className="text-muted">
          No one and nothing is named in this {w.piece.one} yet. Type @ in the text to mention {w.entity.a}, or add one on the {w.piece.One} tab.
        </p>
      ) : rest.length > 0 ? (
        <ul aria-label={`In “${piece.title}”`} className="grid gap-1.5">
          {rest.map(row)}
        </ul>
      ) : (
        <p className="text-muted">Only those pinned.</p>
      )}
      <NotLinkedHere novel={novel} workspace={workspace} piece={piece} onLinked={setSaid} />
    </section>
  );
}

/**
 * The names this piece writes without a link, as the editor underlines them, each with how often:
 * one linked selects its first in the text and makes it a mention there, as Alt+Enter does (or, the
 * piece not in the editor, in its file, as from an entry's profile).
 */
function NotLinkedHere({ novel, workspace, piece, onLinked }: { novel: Book; workspace: Workspace; piece: Piece; onLinked: (said: string) => void }) {
  // As it's being written, not as the book was last read.
  const body = useStore(workspace.store, (s) => s.files[piece.file]?.body);
  const live = useMemo(() => (body === undefined || body === piece.body ? piece : { ...piece, body }), [piece, body]);
  const names = useMemo(() => namesNotLinkedIn(novel, live), [novel, live]);
  const heading = useId();
  if (!names.length) return null;
  const nameOf = (id: string) => novel.entities.find((e) => e.id === id)?.name ?? novel.moduleRecords.find((r) => r.id === id)?.title ?? id;
  const link = async (id: string, first: Passage) => {
    const words = first.text.slice(...first.at);
    const editor = useWritingEditor.getState().editor;
    const range = editor && !editor.isDestroyed ? passageRange(editor.state.doc, piece.file, first.block) : undefined;
    let done = false;
    if (editor && range) {
      editor.chain().focus().setTextSelection(range[1]).run();
      done = linkName(editor, range[0], range[1], id);
    } else done = (await linkPassage(workspace, { ...novel, pieces: [live] }, first, id)) !== undefined;
    onLinked(done ? `Linked “${words}” to ${nameOf(id)}.` : `“${words}” reads differently now, so it wasn't linked.`);
  };
  return (
    <section aria-labelledby={heading} className="grid gap-1.5 border-t border-rule pt-3">
      <h2 id={heading} className="text-xs font-semibold tracking-wide text-muted uppercase">
        Not linked here
      </h2>
      <ul className="flex flex-wrap gap-1.5">
        {names.map(({ id, passages }) => {
          const words = passages[0]!.text.slice(...passages[0]!.at);
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => void link(id, passages[0]!)}
                aria-label={`Link “${words}” to ${nameOf(id)}: ${passages.length} not linked in this ${vocabulary(novel.kind).piece.one}`}
                title={`Link the first “${words}” to ${nameOf(id)}`}
                className="rounded-full border border-warn/50 px-2.5 py-0.5 text-xs text-warn hover:bg-warn-soft focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                {words}
                {words !== nameOf(id) && <span className="text-muted"> → {nameOf(id)}</span>} · {passages.length}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function HereRow({
  novelId,
  novel,
  workspace,
  spell,
  piece,
  item,
  expanded,
  onToggle,
  pinned,
  onPin,
}: Props & { item: InPiece; expanded: boolean; onToggle: () => void; pinned: boolean; onPin: (pin: boolean) => void }) {
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
        <button
          type="button"
          onClick={() => onPin(!pinned)}
          aria-label={pinned ? `Unpin ${name}` : `Pin ${name} beside the text`}
          title={pinned ? "Unpin" : `Keep it here in every ${w.piece.one}`}
          className="shrink-0 rounded p-1 text-muted hover:bg-accent-soft hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          {pinned ? <PinOff className="size-3.5" aria-hidden /> : <Pin className="size-3.5" aria-hidden />}
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
