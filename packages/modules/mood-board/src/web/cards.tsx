import { imageUrl } from "@writer/client";
import { shownPictures, type Book, type Entity, type Note } from "@writer/core";
import { cardFacts } from "@writer/web/bible/types.ts";
import { cardText } from "@writer/web/notes/note-card.tsx";
import { NOTE_BG } from "@writer/web/notes/note-colors.tsx";
import { cn } from "@writer/web/ui/cn.ts";
import type { BoardCard } from "../core/index.ts";

/*
 * What each kind of card shows (#207), filling the size it's given on the board: a picture alone with
 * no border; a note with its first picture (or its words only) and its words cut short; one of a note's
 * pictures on its own; an entry with its picture and card fields.
 */

/** What the board knows of a card: what it shows, and what it's called to a screen reader. */
export interface Shown {
  label: string;
  /** The note or entry it opens, by its page in the book. */
  opens?: { path: string; label: string };
}

const typeLabel = (book: Book, entity: Entity) => book.entityTypes.find((t) => t.key === entity.type)?.label ?? entity.type;

/** What a card is called and what it opens, from the book as it is. */
export function shown(book: Book, card: BoardCard): Shown {
  if (card.kind === "picture") return { label: `Picture: ${card.description || card.picture.replace(/^images\//, "")}` };
  if (card.kind === "entry") {
    const entity = book.entities.find((e) => e.id === card.entry);
    return entity ? { label: `${typeLabel(book, entity)}: ${entity.name}`, opens: { path: `bible/${entity.id}`, label: `Open ${entity.name}` } } : { label: `Missing: ${card.entry}` };
  }
  const note = book.notes.find((n) => n.id === card.note);
  if (!note) return { label: `Missing note: ${card.note}` };
  const opens = { path: `note/${note.id}`, label: "Open the note" };
  if (card.kind === "note") return { label: `Note: ${note.title}`, opens };
  const alt = shownPictures(note.body).find((p) => p.path === card.picture)?.alt;
  return { label: `Picture from the note ${note.title}${alt ? `: ${alt}` : ""}`, opens };
}

function Picture({ novelId, path, alt, className }: { novelId: string; path: string | undefined; alt: string; className?: string }) {
  const src = imageUrl(novelId, path);
  return src ? <img src={src} alt={alt} draggable={false} className={cn("block size-full object-cover", className)} /> : <span aria-hidden className={cn("block size-full bg-panel", className)} />;
}

function Missing({ what }: { what: string }) {
  return <div className="grid size-full place-items-center rounded-xl border border-dashed border-rule bg-raised p-3 text-center text-sm text-muted">{what}</div>;
}

/** A note as a card: its first picture unless it's words only, its title, its words cut short, and how many of its pictures are on the board. */
function NoteCard({ novelId, note, wordsOnly, onBoard }: { novelId: string; note: Note; wordsOnly: boolean; onBoard: number }) {
  const pictures = shownPictures(note.body);
  const first = wordsOnly ? undefined : pictures[0];
  const text = cardText(note.body);
  return (
    <div className={cn("flex size-full flex-col overflow-hidden rounded-xl border shadow-sm", note.color ? cn(NOTE_BG[note.color], "border-ink/10") : "border-rule bg-raised")}>
      {first && <Picture novelId={novelId} path={first.path} alt="" className="h-[45%] shrink-0" />}
      <div className="flex min-h-0 flex-1 flex-col gap-1 px-3 py-2.5">
        <span className="leading-snug font-semibold">{note.title}</span>
        {text && <span className="min-h-0 flex-1 overflow-hidden font-prose text-sm leading-snug text-ink/80">{text}</span>}
        <span className="text-xs text-muted">
          Note{pictures.length ? ` · ${pictures.length} ${pictures.length === 1 ? "picture" : "pictures"}${onBoard ? `, ${onBoard} on this board` : ""}` : ""}
        </span>
      </div>
    </div>
  );
}

function EntryCard({ novelId, book, entity }: { novelId: string; book: Book; entity: Entity }) {
  const facts = cardFacts(entity, book);
  return (
    <div className="flex size-full flex-col overflow-hidden rounded-xl border border-rule bg-raised shadow-sm">
      {entity.image && <Picture novelId={novelId} path={entity.image} alt="" className="h-[55%] shrink-0" />}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 px-3 py-2.5">
        <span className="text-[11px] tracking-wide text-muted uppercase">{typeLabel(book, entity)}</span>
        <span className="leading-snug font-semibold">{entity.name}</span>
        {facts.length > 0 && <span className="truncate text-xs text-muted">{facts.join(" · ")}</span>}
      </div>
    </div>
  );
}

/** A card's face, filling its place on the board. `notesShown`: the notes with a card of their own here. */
export function CardFace({ novelId, book, card, cards, notesShown }: { novelId: string; book: Book; card: BoardCard; cards: readonly (BoardCard | undefined)[]; notesShown: ReadonlySet<string> }) {
  if (card.kind === "picture") return <Picture novelId={novelId} path={card.picture} alt={card.description ?? ""} className="rounded-sm" />;
  if (card.kind === "entry") {
    const entity = book.entities.find((e) => e.id === card.entry);
    return entity ? <EntryCard novelId={novelId} book={book} entity={entity} /> : <Missing what="This entry isn't in the book any more." />;
  }
  const note = book.notes.find((n) => n.id === card.note);
  if (!note) return <Missing what="This note isn't in the book any more." />;
  if (card.kind === "note") {
    const onBoard = new Set(cards.flatMap((c) => (c?.kind === "note-picture" && c.note === note.id ? [c.picture] : []))).size;
    return <NoteCard novelId={novelId} note={note} wordsOnly={card.wordsOnly} onBoard={onBoard} />;
  }
  const alt = shownPictures(note.body).find((p) => p.path === card.picture)?.alt ?? "";
  return (
    <div className="flex size-full flex-col">
      <Picture novelId={novelId} path={card.picture} alt={alt} className="min-h-0 flex-1 rounded-sm shadow-sm" />
      {/* Its note isn't on the board: which note it's from (#195). */}
      {!notesShown.has(note.id) && <span className="truncate pt-1 text-xs text-muted">From “{note.title}”</span>}
    </div>
  );
}
