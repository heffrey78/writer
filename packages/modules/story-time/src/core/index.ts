import { defineModule, type Book, type BookModule, type FieldDef, type Piece, type StoryClock } from "@writer/core";
import { timeFacts } from "./facts.ts";
import { timelineSnapshots } from "./snapshots.ts";
import { cast, overlaps, pieceInstant, sceneNeighbours, storyTimeline, WHEN, type TimelineItem } from "./time.ts";
import { when } from "./timeline.ts";

/*
 * Story time (D14, #30): when each piece happens, a day of the story or a date, and for how long; Day
 * 1's date (calendar.start in the book's settings); the timeline, as a tab of the story map and a
 * snapshot; the outline in story time; how a piece sits in time among its facts; and the warning for
 * someone in two places at once. The off-page events the base still holds (#33) are placed among the
 * pieces, and the base reads their order through the module's clock.
 */

export * from "./facts.ts";
export * from "./snapshots.ts";
export * from "./time.ts";
export * from "./timeline.ts";

export const WHEN_FIELD: FieldDef = { key: WHEN.key, label: "When", type: { kind: "story-time", durationKey: WHEN.durationKey } };

/** The story time some pieces span: their earliest and latest, as read ("Day 1, 09:10"); dated ones first, as the timeline orders them. */
export function storySpan(novel: Book, scenes: Piece[]): { from: string; to: string } | undefined {
  const timed = scenes
    .flatMap((scene): TimelineItem[] => {
      const at = pieceInstant(novel, scene);
      return at ? [{ kind: "scene", scene, at }] : [];
    })
    // A book mixing scales reads its dated span.
    .sort((a, b) => Number(b.at.dated) - Number(a.at.dated) || a.at.start - b.at.start);
  const dated = timed.filter((t) => t.at.dated === timed[0]?.at.dated);
  if (!dated.length) return undefined;
  return { from: when(dated[0]!), to: when(dated.at(-1)!) };
}

export const storyClock: StoryClock = {
  events: (book) => {
    const t = storyTimeline(book);
    return [...t.items.flatMap((i) => (i.kind === "event" ? [i.event] : [])), ...t.undatedEvents];
  },
  around: (book, id) => sceneNeighbours(storyTimeline(book), id),
  span: storySpan,
};

export const storyTime: BookModule = defineModule({
  id: "story-time",
  label: "Story time",
  fields: [WHEN_FIELD],
  checks: [
    {
      code: "W_TIME_OVERLAP",
      severity: "warning",
      find: (book) => {
        const entityName = (id: string) => book.entities.find((e) => e.id === id)?.name ?? id;
        const where = (i: TimelineItem) => `at ${[...cast(book, i).locations].map(entityName).join(" and ")} in ${i.kind === "scene" ? `“${i.scene.title}”` : `the event “${i.event.title}”`}`;
        return overlaps(book, storyTimeline(book)).map((o) => ({
          file: o.a.kind === "scene" ? o.a.scene.file : o.a.event.file,
          message: `${entityName(o.character)} is ${where(o.a)} and ${where(o.b)} at the same time`,
        }));
      },
    },
  ],
  snapshots: timelineSnapshots,
  facts: timeFacts,
  clock: storyClock,
});
