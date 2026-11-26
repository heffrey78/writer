import { imageUrl } from "@writer/client";
import { proseText, type Book, type Note, type ShownPicture } from "@writer/core";
import { Link as LinkIcon, Pin } from "lucide-react";
import { useLayoutEffect, type RefObject } from "react";
import { Link } from "react-router";
import { cn } from "../ui/cn.ts";
import { colorName, NOTE_BG } from "./note-colors.tsx";

/** A note's body without the pictures it starts with: a shared video's comes before its link (#229). */
const afterPictures = (body: string) => body.trimStart().replace(/^(?:!\[(?:[^\]\\]|\\.)*\]\([^)\s]+(?:\s+"(?:[^"\\]|\\.)*")?\)\s*)+/, "");

/**
 * The site a note's words start with a link to (a link shared to Writer, #205), after any pictures:
 * "youtube.com". A link that comes after words is the words' business, not the card's.
 */
export function leadingSite(body: string): string | undefined {
  const href = afterPictures(body).match(/^(?:<(https?:\/\/[^>\s]+)>|\[(?:[^\]\\]|\\.)*\]\((https?:\/\/[^)\s]+)\))/i);
  const url = href?.[1] ?? href?.[2];
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** A card's words: the note's prose on one line, without the address of the link it starts with (the site's above them). */
export function cardText(body: string): string {
  const rest = afterPictures(body).replace(/^<https?:\/\/[^>\s]+>/i, "");
  return proseText(rest).replace(/\s+/g, " ").trim();
}

/**
 * A note in the gallery (#225): filled with its color or plain, its first picture and how many it has
 * (#202), the site of the link it starts with, its title, up to five lines of its words, its pieces
 * (pinned ones marked) and its tags. A screen reader hears the title, then the color, then the words.
 */
export function NoteCard({ novelId, novel, note, pictures }: { novelId: string; novel: Book; note: Note; pictures: readonly ShownPicture[] }) {
  const text = cardText(note.body);
  const site = leadingSite(note.body);
  const first = pictures[0];
  const sceneTitle = (id: string) => novel.allPieces.find((s) => s.id === id)?.title ?? id;
  return (
    <Link
      to={`/novels/${novelId}/note/${note.id}`}
      state={{ fromGallery: true }}
      className={cn(
        "grid content-start gap-1.5 overflow-hidden rounded-xl border px-3.5 py-3 hover:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
        note.color ? cn(NOTE_BG[note.color], "border-ink/10") : "border-rule bg-raised",
      )}
    >
      {site && (
        <span className="flex items-center gap-1.5 text-[13px] text-muted">
          <LinkIcon className="size-3.5 shrink-0" aria-hidden />
          {site}
        </span>
      )}
      <span className="leading-snug font-semibold">
        {note.title}
        {note.color && <span className="sr-only">{`, ${colorName(note.color).toLowerCase()}.`}</span>}
      </span>
      {text && <span className="line-clamp-5 font-prose leading-snug">{text}</span>}
      {note.scenes.length > 0 && (
        <span className="flex flex-wrap items-center gap-1 text-[13px] text-muted">
          On{" "}
          {note.scenes.map((id, i) => (
            <span key={id} className="inline-flex items-center gap-0.5">
              {note.pinned.includes(id) && <Pin className="size-3" aria-label="pinned in" />}
              {sceneTitle(id)}
              {i < note.scenes.length - 1 && ","}
            </span>
          ))}
        </span>
      )}
      {note.tags.length > 0 && (
        <span className="flex flex-wrap gap-1 pt-0.5">
          {note.tags.map((t) => (
            <span key={t} className="rounded-full border border-ink/15 px-2 py-px text-xs text-muted">
              {t}
            </span>
          ))}
        </span>
      )}
      {/* Shown first, read last: a screen reader hears the title, then the words. */}
      {first && (
        <span className="relative order-first -mx-3.5 -mt-3 mb-1 block aspect-[4/3] bg-panel">
          <img src={imageUrl(novelId, first.path)} alt="" loading="lazy" className="size-full object-cover" />
          {pictures.length > 1 && <span className="absolute right-2 bottom-2 rounded-full bg-black/65 px-2 py-0.5 text-xs font-medium text-white">{pictures.length} pictures</span>}
        </span>
      )}
    </Link>
  );
}

/** The grid's rows, in px: a card spans as many as its height needs, with the gap. */
const ROW = 4;
const GAP = 12;

/**
 * Cards of their own heights in columns, read in order row by row (#225): the list is one CSS grid of
 * small rows, each card spanning its height's worth, placed in order into the first column with room.
 * The DOM, reading and Tab order stay the notes' own, newest first. Each card's height is watched, as a
 * picture loads or the window's width changes it.
 */
export function useMasonry(list: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const ul = list.current;
    if (!ul || typeof ResizeObserver !== "function") return;
    const size = (card: Element) => {
      const li = card.parentElement;
      if (li) li.style.gridRowEnd = `span ${Math.ceil((card.getBoundingClientRect().height + GAP) / ROW)}`;
    };
    const watching = new ResizeObserver((entries) => entries.forEach((e) => size(e.target)));
    // Sized at once, before the page is painted (or scrolled), then again as each changes.
    const watchAll = () => {
      watching.disconnect();
      for (const li of ul.children) {
        if (!li.firstElementChild) continue;
        size(li.firstElementChild);
        watching.observe(li.firstElementChild);
      }
    };
    watchAll();
    const added = new MutationObserver(watchAll);
    added.observe(ul, { childList: true });
    return () => {
      watching.disconnect();
      added.disconnect();
    };
  }, [list]);
}

/** The list's classes for useMasonry: two columns on a phone, up to four as the room allows. */
export const MASONRY = "grid grid-cols-2 gap-x-3 auto-rows-[4px] @[600px]:grid-cols-3 @[1100px]:grid-cols-4";
