import { when } from "./diagrams.ts";
import { entriesOf } from "./fields.ts";
import type { Book, Piece } from "./model.ts";
import { storyInstant, type TimelineItem } from "./time.ts";

/*
 * What a profile says that depends on the entry's type (heffrey78/gh-writer#161): a location's visitors and the story
 * time its scenes span; a theme's strength scene by scene. A plotline's is its module's.
 */

/** Entries counted by how many scenes they're in, most first, then by name. */
export interface Tally {
  id: string;
  name: string;
  scenes: number;
}

export function tally(novel: Book, ids: Iterable<string>[]): Tally[] {
  const counts = new Map<string, number>();
  for (const list of ids) for (const id of new Set(list)) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts]
    .map(([id, scenes]) => ({ id, name: novel.entities.find((e) => e.id === id)?.name ?? id, scenes }))
    .sort((a, b) => b.scenes - a.scenes || a.name.localeCompare(b.name));
}


/** The story time a set of scenes covers: its earliest and latest, as read ("Day 1, 09:10"). */
export function storySpan(novel: Book, scenes: Piece[]): { from: string; to: string } | undefined {
  const calendar = novel.config?.calendar?.start;
  const timed = scenes
    .flatMap((scene): TimelineItem[] => {
      const at = storyInstant(scene.when, scene.duration, calendar);
      return at ? [{ kind: "scene", scene, at }] : [];
    })
    // Dated times first, as the timeline orders them; a book mixing scales reads its dated span.
    .sort((a, b) => Number(b.at.dated) - Number(a.at.dated) || a.at.start - b.at.start);
  const dated = timed.filter((t) => t.at.dated === timed[0]?.at.dated);
  if (!dated.length) return undefined;
  return { from: when(dated[0]!), to: when(dated.at(-1)!) };
}

export interface LocationProfile {
  /** Who's in its scenes (point of view or characters), by how often. */
  visitors: Tally[];
  /** The scenes set there, in reading order. */
  scenes: Piece[];
  span?: { from: string; to: string };
}

export function locationProfile(novel: Book, id: string): LocationProfile {
  const scenes = novel.pieces.filter((s) => s.locations.includes(id));
  const span = storySpan(novel, scenes);
  return { visitors: tally(novel, scenes.map((s) => entriesOf(novel, s, "character"))), scenes, ...(span ? { span } : {}) };
}

export interface ThemeProfile {
  /** Each scene in reading order: the theme's strength there (0: not listed; listed without one: 2). */
  strengths: { scene: Piece; strength: 0 | 1 | 2 | 3; note?: string }[];
}

export function themeProfile(novel: Book, id: string): ThemeProfile {
  return {
    strengths: novel.pieces.map((scene) => {
      const t = scene.themes.find((x) => x.id === id);
      const strength = !t ? 0 : t.strength === 1 || t.strength === 2 || t.strength === 3 ? t.strength : 2;
      return { scene, strength, ...(t?.note ? { note: t.note } : {}) };
    }),
  };
}
