import type { EntityTypeDef } from "./ids.ts";
import type { IssueKind } from "./issue-kinds.ts";

/*
 * Kinds of book (D14, D15): what makes a novel a novel, as data the base reads rather than code it
 * holds. The app's entry points register the kinds they ship (registerKind); the base never imports
 * one. A book in format v2 has no `kind`: every one is a novel (V2_KIND).
 */

/** A level of sections above the pieces, such as a part or a chapter. */
export interface LevelDef {
  key: string;
  label: string;
  prefix: string;
  /** Whether a book may go without it, as a novel may have no parts. */
  optional?: boolean;
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
  piece: { key: string; label: string; prefix: string };
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

/** A level of the kind, by its key. */
export function levelOf(kind: BookKind, key: string): LevelDef {
  const level = kind.levels.find((l) => l.key === key);
  if (!level) throw new Error(`A ${kind.label.toLowerCase()} has no level “${key}”`);
  return level;
}
