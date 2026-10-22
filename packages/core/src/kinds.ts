import type { EntityTypeDef } from "./ids.ts";
import type { IssueKind } from "./issue-kinds.ts";
import { withModules } from "./modules.ts";

/*
 * Kinds of book (D14, D15): what makes a novel a novel, as data the base reads rather than code it
 * holds. The app's entry points register the kinds they ship (registerKind); the base never imports
 * one. A book in format v2 has no `kind`: every one is a novel (V2_KIND).
 */

/**
 * A word on screen for something in the kind's books (#22), as it reads in a title: "Chapter",
 * "Story bible". The other forms sentences need come from vocabulary().
 */
export interface Noun {
  label: string;
  /** "Chapters". */
  plural: string;
  /** What goes before it, where its first letter doesn't tell: "an" for "Hour", "a" for "Unicorn". */
  article?: "a" | "an";
  /** A shorter name, once the full one has been said: "Bible" for "Story bible". */
  short?: string;
}

/**
 * A level of sections above the pieces, such as a part or a chapter. A section is a folder with
 * _<key>.yaml in it: its ID, title and synopsis, and its children in order under the next level's
 * `list` (the pieces' at the innermost level).
 */
export interface LevelDef extends Noun {
  key: string;
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
  /** Prefixes its sections' IDs may still have from before the book was of this kind: a journal's months, once a novel's chapters (ch). */
  formerPrefixes?: readonly string[];
}

/**
 * Something each item of a list field may carry, as `{ id, <key>: … }` in place of a plain ID: a
 * plotline's weight and beat, a theme's strength.
 */
export type ItemProp = { key: string; label: string; onCard?: boolean } & (
  /** One of some words, the strongest first: `default` is what an item without it means (a plotline is "major"). */
  | { kind: "choice"; values: readonly string[]; default?: string }
  /** A whole number from `min` to `max`: `labels` say what each means on the card, `options` how the choice lists it. */
  | { kind: "scale"; min: number; max: number; labels: Readonly<Record<string, string>>; options: Readonly<Record<string, string>> }
  | { kind: "text" }
);

/**
 * A field of a piece's front matter, declared by its kind (D15): what it holds, how the piece's card
 * shows and edits it, and how the rest of the app reads it. The kind's fields are the card's rows, in
 * order; a piece's id, title, synopsis, status and tags are every kind's.
 */
export interface FieldDef {
  /** Its key in the front matter: "characters". */
  key: string;
  /** Its row's label on the card: "Point of view", "Where". */
  label: string;
  /** What its entries are called where they're chosen and added: "Locations". Default the label. */
  group?: string;
  type:
    /** One entry of a type: a point of view. */
    | { kind: "entity"; entityType: string }
    /** Entries of a type, each an ID or `{ id, … }` carrying `item`'s properties. */
    | { kind: "entities"; entityType: string; item?: readonly ItemProp[] }
    /** Entries of the book's own types (not its kind's), all in one list: a row on the card for each type. */
    | { kind: "own-entities" }
    /** When it happens (`{ at }` or `{ day, time }`), with how long under `durationKey`, read and edited together. */
    | { kind: "story-time"; durationKey: string };
  /** Whether mentioning an entry in a piece's prose adds it here, so the list keeps up with the text. */
  mentionAdds?: boolean;
  /**
   * Whether its entry carries the piece: whose piece it is, as a point of view is. One entry's field
   * at most: presence rings it, the timeline can run a lane for each, profiles count it.
   */
  carries?: boolean;
  /** How an entry in it is in the piece, said after the piece's title: "point of view", "set here". Default its label, in lower case. */
  role?: string;
  /** Whether the timeline can run a lane for each of its entries (by location, by plotline): the choice is named by its entry type. */
  lanes?: boolean;
  /**
   * Whether its entries are threads through the book, as plotlines are: the graph can show only
   * what's in the scenes of one, and a piece's facts say where one begins or ends.
   */
  threads?: boolean;
  /**
   * How an entry in it reads on its presence strip: where it carries the piece (its strongest, "a
   * major beat") and where it's only in it ("a minor beat"). Default: the carrier's role, and "in the scene".
   */
  marks?: { carries?: string; present?: string };
  /** Whether the book's diagram snapshots show where its entries are, piece by piece, as the characters' and themes' are. */
  snapshot?: boolean;
  /**
   * How the outline shows it: as a column of its table, and as a filter of its cards. One entry's
   * field filters by itself ("Point of view"); a list filters by its entry type, matching any field of
   * that type ("Character": in it, or its point of view).
   */
  outline?: { column?: boolean; filter?: boolean };
}

/** A stage a piece moves through, in order: idea, outlined, drafted… */
export interface StatusDef {
  key: string;
  label: string;
  description: string;
  /** Its colour on a GitHub Project's board. */
  color: "GRAY" | "BLUE" | "GREEN" | "YELLOW" | "ORANGE" | "RED" | "PINK" | "PURPLE";
}

/** A kind of book: its label and plural are what a book of it is called ("Novel", "Novels"). */
export interface BookKind extends Noun {
  key: string;
  /** The book's own ID prefix. */
  prefix: string;
  /**
   * Prefixes the book's own ID may still have from before it was of this kind (a journal kept as a
   * novel: nv). IDs never change, so a book converted to the kind keeps its records' IDs: each level,
   * the piece and each entry type may name its former prefixes too. New IDs never use them.
   */
  formerPrefixes?: readonly string[];
  /** The levels of sections, outermost first. */
  levels: readonly LevelDef[];
  /** The writing unit: one file of prose (formerPrefixes as a level's). */
  piece: Noun & {
    key: string;
    prefix: string;
    list: string;
    formerPrefixes?: readonly string[];
    /** The Markdown a new piece starts with, as the editor writes it: a campaign's session prep. Without it, a new piece is empty. */
    template?: string;
    /**
     * A note the palette makes on the open piece in one action, pinned there with the caret in it:
     * `command` is what the palette calls it, and the note is titled `title`: the piece's title.
     */
    quickNote?: { command: string; title: string };
    /**
     * Its title is a heading in the compiled book, beneath its chapter's: a non-fiction book's
     * sections. Without it, pieces are set apart by the preset's break, their titles left out (a
     * novel's scenes).
     */
    headed?: boolean;
  };
  /** The words for what isn't a level or the piece: all the sections and pieces, the codex, and an entity of it. */
  words: { content: Noun; codex: Noun; entity: Noun };
  folders: {
    /** The sections and pieces. */
    content: string;
    /** The entries and relationships, and the records its modules keep (off-page events). */
    codex: string;
    notes: string;
  };
  /** The entry types every book of the kind has; a book may add its own. */
  entityTypes: readonly EntityTypeDef[];
  /** In order: a new piece starts at the first. */
  statuses: readonly StatusDef[];
  /** A piece's fields beyond those every kind has, in the order its card shows them. */
  fields: readonly FieldDef[];
  /** How its books are compiled to Word and PDF: a layout one of its modules brings ("manuscript"), else the base's plain one. */
  compileLayout?: string;
  /** What a book's issues are about: a label kind/<key> each. */
  issueKinds: readonly IssueKind[];
  /** The entry types the relationship graph shows until it's filtered, by key: a campaign's factions with its people. Without it, its types that are people. */
  graphTypes?: readonly string[];
  /** The modules its books use, by id (D14): each adds its fields after the kind's own, its checks and its records. */
  modules?: readonly string[];
  /**
   * The order of its fields with its modules', by key, where a module's shouldn't simply follow the
   * kind's own (the Novel's point of view comes first on the card). Fields it doesn't name follow.
   */
  fieldOrder?: readonly string[];
  /** The order of its entry types with its modules', by key, as `fieldOrder` orders fields. */
  entityTypeOrder?: readonly string[];
}

/** The kind of every book in format v2, which has no `kind`. */
export const V2_KIND = "novel";

const registry = new Map<string, BookKind>();

/**
 * Make a kind of book known: done by the app's entry points, for each kind they ship, after the
 * modules it lists. It's known with what its modules add.
 */
export function registerKind(kind: BookKind): void {
  registry.set(kind.key, withModules(kind));
}

/** Every registered kind of book, in the order the entry points registered them (the Novel first). */
export const knownKinds = (): BookKind[] => [...registry.values()];

/** A registered kind of book, or undefined for one this build doesn't ship. */
export function knownKind(key: string): BookKind | undefined {
  return registry.get(key);
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
