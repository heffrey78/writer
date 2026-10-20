import type { Book, Piece } from "@writer/core";
import { pieceInstant, storyTimeline } from "./time.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A stretch of story time, as read: "40 min", "8 h 10 min", "3 days", "2 years". */
export function readableSpan(ms: number): string {
  if (ms < HOUR) return `${Math.round(ms / MINUTE)} min`;
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR);
    const m = Math.round((ms % HOUR) / MINUTE);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  if (ms < 365 * DAY) {
    const d = Math.round(ms / DAY);
    return `${d} day${d === 1 ? "" : "s"}`;
  }
  const y = Math.round(ms / (365 * DAY));
  return `${y} year${y === 1 ? "" : "s"}`;
}

/**
 * What story time says about a piece, among its facts (heffrey78/gh-writer#154): how it sits against
 * the piece before, and an off-page event right before or after it.
 */
export function timeFacts(novel: Book, scene: Piece): string[] {
  const scenes = novel.pieces;
  const at = scenes.findIndex((s) => s.id === scene.id);
  const facts: string[] = [];
  // Against the latest point the story had reached before it (the scene before, or after a
  // flashback the one it went back from), on the same scale.
  const here = pieceInstant(novel, scene);
  if (!here) return facts;
  let latest: { title: string; start: number; end: number } | undefined;
  for (const before of scenes.slice(0, at)) {
    const then = pieceInstant(novel, before);
    if (then && then.dated === here.dated && (!latest || then.end >= latest.end)) latest = { title: before.title, ...then };
  }
  if (latest) {
    if (here.start < latest.start) facts.push(`A flashback: ${readableSpan(latest.start - here.start)} before “${latest.title}”.`);
    else if (here.start < latest.end) facts.push(`Overlaps “${latest.title}” in story time.`);
    else if (here.start === latest.end) facts.push(`Follows straight on from “${latest.title}”.`);
    else facts.push(`${readableSpan(here.start - latest.end)} after “${latest.title}”.`);
  }

  // An off-page event right before or after it in story time, with no scene between (heffrey78/gh-writer#165).
  const items = storyTimeline(novel).items;
  const i = items.findIndex((x) => x.kind === "scene" && x.scene.id === scene.id);
  const neighbour = (j: number) => {
    const x = items[j];
    return x?.kind === "event" && x.at.dated === here.dated && x.event.scene !== scene.id ? { title: x.event.title, ...x.at } : undefined;
  };
  const before = neighbour(i - 1);
  const after = neighbour(i + 1);
  if (before) {
    if (here.start < before.end) facts.push(`During the off-page event “${before.title}”.`);
    else if (here.start === before.end) facts.push(`Straight after the off-page event “${before.title}”.`);
    else facts.push(`${readableSpan(here.start - before.end)} after the off-page event “${before.title}”.`);
  }
  if (after) facts.push(after.start <= here.end ? `The off-page event “${after.title}” begins during it.` : `${readableSpan(after.start - here.end)} before the off-page event “${after.title}”.`);
  return facts;
}
