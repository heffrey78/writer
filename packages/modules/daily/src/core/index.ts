import { defineModule, type Book, type BookModule, type Piece } from "@writer/core";
import { timeOf } from "@writer/module-story-time/core";

/*
 * Daily writing (D14, #38): a piece a day, as a journal keeps entries. Today's entry is one action
 * away: the piece dated today (in story time's `when`), or a new one at the end of its month, in its
 * year where the book keeps years, made as needed. A calendar shows the month's entries. It needs
 * story time: a piece's date is its `when`.
 */

/** A day, as YYYY-MM-DD. */
export type Day = string;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `s` is a day of the calendar, as YYYY-MM-DD. */
export const isDay = (s: unknown): s is Day => typeof s === "string" && DAY.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/** Today where the writer is: their clock's date, not the server's or UTC's. */
export function today(now = new Date()): Day {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

// Names spelled out, not the platform's: an entry's title is the same wherever it's made.
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const at = (day: Day) => new Date(`${day}T00:00:00Z`);
const monthOf = (day: Day) => MONTHS[at(day).getUTCMonth()]!;

/** A day as a new entry's title: "Tuesday, 20 October". */
export const entryTitle = (day: Day) => `${WEEKDAYS[at(day).getUTCDay()]}, ${at(day).getUTCDate()} ${monthOf(day)}`;

/** The day a piece is dated, from its `when` (a date, or a date and time), if it has one. */
export function dayOf(piece: Piece): Day | undefined {
  const when = timeOf(piece).when;
  return when && "at" in when ? when.at.slice(0, 10) : undefined;
}

/** The book's entry for a day: the first piece dated that day. */
export const entryOn = (book: Book, day: Day): Piece | undefined => book.allPieces.find((p) => dayOf(p) === day);

/**
 * The sections a day's entry goes in, by their titles, from the level the book starts at: its year
 * ("2026") and month ("October") where it keeps years (the level out from the entries'), else its
 * month and year ("October 2026").
 */
export function placeOf(book: Book, day: Day): string[] {
  const month = monthOf(day);
  const year = day.slice(0, 4);
  const levels = book.kind.levels;
  const from = levels.findIndex((l) => l.key === book.levels[0]);
  const used = levels.slice(from < 0 ? levels.length - 1 : from);
  return used.length > 1 ? [...used.slice(0, -2).map(() => year), year, month] : [`${month} ${year}`];
}

/** The pieces dated in a month ("2026-10"), by day. */
export function entriesIn(book: Book, month: string): Map<Day, Piece[]> {
  const out = new Map<Day, Piece[]>();
  for (const p of book.allPieces) {
    const day = dayOf(p);
    if (day?.startsWith(`${month}-`)) out.set(day, [...(out.get(day) ?? []), p]);
  }
  return out;
}

export const daily: BookModule = defineModule({ id: "daily", label: "Daily writing", needs: ["story-time"] });
