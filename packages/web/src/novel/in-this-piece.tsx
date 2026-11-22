import { entriesInPiece, entryIds, itemText, namesNotLinkedIn, vocabulary, type Book, type InPiece, type Passage, type Piece } from "@writer/core";
import { linkName, passageRange } from "@writer/editor";
import { Pencil, Pin, PinOff } from "lucide-react";
import { useDeferredValue, useId, useMemo, useState, type ReactNode } from "react";
import { linkPassage } from "../bible/link-passage.ts";
import { setPinned, usePinnedEntries } from "../bible/pins.ts";
import { Picture, usePictureUrl } from "../bible/picture.tsx";
import { shapeForType } from "../bible/pictures.ts";
import { cardFacts, initials } from "../bible/types.ts";
import { cn } from "../ui/cn.ts";
import { useEntryPanel } from "./entry-tab.tsx";
import { useWritingEditor } from "./writing-view.tsx";
import type { Workspace } from "./workspace.ts";

/*
 * In this scene (#149, #160): everyone and everything in the piece being written, each once, with its
 * role there and what its card says, so a name needn't be opened to be checked. Part of the piece's
 * own tab, in place of a row for each entry field: a card opens its entry on the Entry tab, and its
 * pencil edits the field that names it here. Entries pinned (#156) come first in every piece; the
 * names the piece writes without a link are listed under the cards, to link.
 */

interface Props {
  novelId: string;
  novel: Book;
  workspace: Workspace;
  /** The piece as it's being written: its fields from the front matter in the workspace, its text as typed. */
  piece: Piece;
  /** A field's editor, by the key of its row in the piece's card: shown under the heading while open. */
  editing: ReactNode;
  /** Edit the field that names an entry here: by its key ("pov", "characters"), and the entry's ID. */
  onEdit: (via: string, id: string) => void;
  /** What ends the heading's line: the card's Add… menu. */
  add: ReactNode;
}

export function InThisPiece({ novelId, novel, workspace, piece, editing, onEdit, add }: Props) {
  const w = vocabulary(novel.kind);
  // Read from the piece as it is now, so an entry added a moment ago shows before the book is read again.
  const here = useMemo(() => entriesInPiece({ ...novel, allPieces: novel.allPieces.map((p) => (p.id === piece.id ? piece : p)) }, piece.id), [novel, piece]);
  const pins = usePinnedEntries(novelId);
  const [said, setSaid] = useState("");
  const heading = useId();
  const nameOf = (id: string) => novel.entities.find((e) => e.id === id)?.name ?? novel.moduleRecords.find((r) => r.id === id)?.title;
  // Pinned first, as they're in this piece or not; those since deleted are left out.
  const pinned: InPiece[] = pins.flatMap((id) => (nameOf(id) === undefined ? [] : [here.find((x) => x.id === id) ?? { id, via: "", role: `not in this ${w.piece.one}` }]));
  const rest = here.filter((x) => !pins.includes(x.id));
  const card = (x: InPiece) => (
    <PieceCard
      key={x.id}
      {...{ novelId, novel, piece }}
      item={x}
      onEdit={novel.kind.fields.some((f) => f.key === x.via) ? () => onEdit(x.via, x.id) : undefined}
      pinned={pins.includes(x.id)}
      onPin={(pin) => {
        setPinned(novelId, x.id, pin);
        setSaid(pin ? `Pinned ${nameOf(x.id)} beside the text.` : `Unpinned ${nameOf(x.id)}.`);
      }}
    />
  );
  return (
    <section aria-labelledby={heading} className="grid content-start gap-2 border-t border-rule pt-3">
      <p role="status" className="sr-only">
        {said}
      </p>
      <div className="flex items-center gap-2">
        <h3 id={heading} className="flex-1 text-xs font-semibold tracking-wide text-muted uppercase">
          In this {w.piece.one} · {here.length}
        </h3>
        {add}
      </div>
      {editing}
      {pinned.length > 0 && (
        <ul aria-label="Pinned" className="grid gap-1.5">
          {pinned.map(card)}
        </ul>
      )}
      {here.length === 0 ? (
        <p className="text-muted">
          No one and nothing is named in this {w.piece.one} yet. Type @ in the text to mention {w.entity.a}, or choose Add….
        </p>
      ) : (
        rest.length > 0 && (
          <ul aria-label={`In “${piece.title}”`} className="grid gap-1.5">
            {rest.map(card)}
          </ul>
        )
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
  // After the keystroke, not in its way: a 10,000-word piece takes a few milliseconds to read.
  const later = useDeferredValue(piece);
  const names = useMemo(() => namesNotLinkedIn(novel, later), [novel, later]);
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
    } else done = (await linkPassage(workspace, { ...novel, pieces: [piece] }, first, id)) !== undefined;
    onLinked(done ? `Linked “${words}” to ${nameOf(id)}.` : `“${words}” reads differently now, so it wasn't linked.`);
  };
  return (
    <section aria-labelledby={heading} className="grid gap-1.5 pt-2">
      <h3 id={heading} className="text-xs font-semibold tracking-wide text-muted uppercase">
        Not linked here
      </h3>
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

function PieceCard({
  novelId,
  novel,
  piece,
  item,
  onEdit,
  pinned,
  onPin,
}: {
  novelId: string;
  novel: Book;
  piece: Piece;
  item: InPiece;
  onEdit: (() => void) | undefined;
  pinned: boolean;
  onPin: (pin: boolean) => void;
}) {
  const w = vocabulary(novel.kind);
  const entity = novel.entities.find((e) => e.id === item.id);
  const record = entity ? undefined : novel.moduleRecords.find((r) => r.id === item.id);
  const picture = usePictureUrl(novelId, entity?.image);
  const name = entity?.name ?? record?.title ?? item.id;
  const wide = shapeForType(entity?.type ?? "").key === "wide";

  // What its field says of it here, as the rows did: " (minor) “First sign of the sale”".
  const field = novel.kind.fields.find((f) => f.key === item.via);
  const value = field ? piece.fields[field.key] : undefined;
  const listed = field && Array.isArray(value) ? value.find((v) => entryIds(field, [v])[0] === item.id) : undefined;
  const role = item.role + (field && listed !== undefined ? itemText(field, listed) : "");
  const facts = entity ? cardFacts(entity) : [];
  const tool = "shrink-0 rounded p-1 text-muted hover:bg-accent-soft hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none";

  return (
    <li className="flex items-center gap-2 rounded-lg border border-rule bg-paper py-1.5 pr-2 pl-2">
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
        onClick={() => useEntryPanel.getState().open(item.id)}
        title={`Show ${name} on the ${w.entity.One} tab`}
        className="grid min-w-0 flex-1 rounded-md text-left focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      >
        <span className="truncate font-semibold">{name}</span>
        <span className="truncate text-xs text-muted">
          {role}
          {facts.length ? ` · ${facts.join(" · ")}` : ""}
        </span>
      </button>
      {onEdit && field && (
        <button type="button" onClick={onEdit} aria-label={`Edit ${field.label.toLowerCase()}`} title={`Edit ${field.label.toLowerCase()}`} className={tool}>
          <Pencil className="size-3.5" aria-hidden />
        </button>
      )}
      <button type="button" onClick={() => onPin(!pinned)} aria-label={pinned ? `Unpin ${name}` : `Pin ${name} beside the text`} title={pinned ? "Unpin" : `Keep it here in every ${w.piece.one}`} className={tool}>
        {pinned ? <PinOff className="size-3.5" aria-hidden /> : <Pin className="size-3.5" aria-hidden />}
      </button>
    </li>
  );
}
