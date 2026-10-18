import type { EntityTypeDef } from "./ids.ts";
import type { IssueKind } from "./issue-kinds.ts";

/*
 * Kinds of book (D14, D15): what makes a novel a novel, as data the base reads rather than code it
 * holds. The app's entry points register the kinds they ship (registerKind); the base never imports
 * one. A book in format v2 has no `kind`: every one is a novel (V2_KIND).
 */

/**
 * A level of sections above the pieces, such as a part or a chapter. A section is a folder with
 * _<key>.yaml in it: its ID, title and synopsis, and its children in order under the next level's
 * `list` (the pieces' at the innermost level).
 */
export interface LevelDef {
  key: string;
  label: string;
  prefix: string;
  /** The key its sections are listed under, in _order.yaml or the level above's file: "chapters". */
  list: string;
  /**
   * Whether a book may go without it, as a novel may have no parts. Only outer levels may be: a book
   * starts at one of its kind's levels and has every level after it.
   */
  optional?: boolean;
  /** Whether its sections must have a title, as a part must and a chapter needn't. */
  titled?: boolean;
}

/** A stage a piece moves through, in order: idea, outlined, drafted… */
export interface StatusDef {
  key: string;
  label: string;
  description: string;
  /** Its colour on a GitHub Project's board. */
  color: "GRAY" | "BLUE" | "GREEN" | "YELLOW" | "ORANGE" | "RED" | "PINK" | "PURPLE";
}

export interface BookKind {
  key: string;
  label: string;
  /** The book's own ID prefix. */
  prefix: string;
  /** The levels of sections, outermost first. */
  levels: readonly LevelDef[];
  /** The writing unit: one file of prose. */
  piece: { key: string; label: string; prefix: string; list: string };
  folders: {
    /** The sections and pieces. */
    content: string;
    /** The entries, relationships and events. */
    codex: string;
    notes: string;
    /** Under the codex folder: off-page events. */
    events: string;
  };
  /** The entry types every book of the kind has; a book may add its own. */
  entityTypes: readonly EntityTypeDef[];
  /** In order: a new piece starts at the first. */
  statuses: readonly StatusDef[];
  /** What a book's issues are about: a label kind/<key> each. */
  issueKinds: readonly IssueKind[];
}

/** The kind of every book in format v2, which has no `kind`. */
export const V2_KIND = "novel";

const registry = new Map<string, BookKind>();

/** Make a kind of book known: done by the app's entry points, for each kind they ship. */
export function registerKind(kind: BookKind): void {
  registry.set(kind.key, kind);
}

/** A registered kind of book. Throws for one no entry point registered: that's a bug, not a book's fault. */
export function kindByKey(key: string): BookKind {
  const kind = registry.get(key);
  if (!kind) throw new Error(`No kind of book “${key}” is registered: the app's entry point registers the kinds it ships`);
  return kind;
}

/** The levels a book of the kind may start at: each optional outer level, then the first that isn't. */
export function startLevels(kind: BookKind): LevelDef[] {
  const first = kind.levels.findIndex((l) => !l.optional);
  return kind.levels.slice(0, first + 1);
}

/** A level of the kind, by its key. */
export function levelOf(kind: BookKind, key: string): LevelDef {
  const level = kind.levels.find((l) => l.key === key);
  if (!level) throw new Error(`A ${kind.label.toLowerCase()} has no level “${key}”`);
  return level;
}
