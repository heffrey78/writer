import { imageUrl } from "@writer/client";
import type { Book, Piece } from "@writer/core";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { dayOf, MONTHS, type Day } from "../core/index.ts";

/** The journal read back (#5, read-page.tsx): its entries in order, and an entry's text as HTML. */

/** "20 October 2026". */
export const longDate = (day: Day) => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;

/**
 * The entries newest first, to be read through as a blog is: dated entries by their day, latest at the
 * top (a day's entries in the book's order), then any without a date, the book's last first.
 */
export function newestFirst(book: Book): { piece: Piece; day: Day | undefined }[] {
  const dated = book.allPieces.map((piece, i) => ({ piece, day: dayOf(piece), i }));
  return dated
    .sort((a, b) => (a.day && b.day ? (a.day === b.day ? a.i - b.i : a.day < b.day ? 1 : -1) : a.day ? -1 : b.day ? 1 : b.i - a.i))
    .map(({ piece, day }) => ({ piece, day }));
}

/**
 * An entry's text as HTML, safe whatever it holds (micromark: raw HTML shown as text, dangerous links
 * dropped): mentions link to their index entries, pictures load from the book's images, and Writer's
 * hidden notes are left out.
 */
export function entryHtml(markdown: string, novelId: string): string {
  const book = `/novels/${encodeURIComponent(novelId)}`;
  const text = markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\]\(#([a-z]+_[0-9a-z]+)\)/g, (_, id: string) => `](${book}/bible/${id})`)
    .replace(/(!\[[^\]]*\]\()\/(images\/[^)\s]+)/g, (whole, start: string, path: string) => {
      const url = imageUrl(novelId, path);
      return url ? `${start}${url}` : whole;
    });
  return micromark(text, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
}

