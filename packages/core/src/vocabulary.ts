import type { BookKind, Noun } from "./kinds.ts";

/*
 * The words on screen (#22): each kind names its books, their levels, pieces, codex and entities in
 * its own words, and the base says them in the forms its sentences need. Never show "scene" to a
 * journal keeper.
 */

/** A noun in the forms sentences need. */
export interface Word {
  /** As a title, or to start a sentence: "Scene", "Story bible". */
  One: string;
  Many: string;
  /** Inside a sentence: "scene", "story bible" (and "NPC" as it is). */
  one: string;
  many: string;
  /** With its article: "a scene", "an entry". */
  a: string;
  /** With its article, to start a sentence: "A scene", "An entry". */
  A: string;
  /** Its short name inside a sentence, or its name if it has none: "bible" for "story bible". */
  short: string;
  /** How many: "1 scene", "3 scenes". */
  count(n: number): string;
}

export interface Vocabulary {
  /** What a book of the kind is: "novel". */
  book: Word;
  /** The writing unit: "scene". */
  piece: Word;
  /** All the sections and pieces together: "manuscript". */
  content: Word;
  /** The reference half of the book: "story bible". */
  codex: Word;
  /** An item of the codex: "entry". */
  entity: Word;
  /** A level of sections, by key: "chapter". A key the kind hasn't is said as it is. */
  level(key: string): Word;
  /** The piece or a level, by key: what a section or piece in the tree is. */
  of(key: string): Word;
}

/** A label's first letter in lower case, unless the label starts as an acronym does ("NPC"). */
const inSentence = (label: string) => (/^.[A-Z]/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1));

export function word(noun: Noun): Word {
  const one = inSentence(noun.label);
  const many = inSentence(noun.plural);
  const article = noun.article ?? (/^[aeiou]/i.test(noun.label) ? "an" : "a");
  return { One: noun.label, Many: noun.plural, one, many, a: `${article} ${one}`, A: `${article === "an" ? "An" : "A"} ${one}`, short: noun.short ? inSentence(noun.short) : one, count: (n) => `${n} ${n === 1 ? one : many}` };
}

const cache = new WeakMap<BookKind, Vocabulary>();

/** The kind's words. */
export function vocabulary(kind: BookKind): Vocabulary {
  let v = cache.get(kind);
  if (!v) {
    const levels = new Map(kind.levels.map((l) => [l.key, word(l)]));
    const piece = word(kind.piece);
    const level = (key: string) => levels.get(key) ?? word({ label: key, plural: key });
    v = {
      book: word(kind),
      piece,
      content: word(kind.words.content),
      codex: word(kind.words.codex),
      entity: word(kind.words.entity),
      level,
      of: (key) => (key === kind.piece.key ? piece : level(key)),
    };
    cache.set(kind, v);
  }
  return v;
}
