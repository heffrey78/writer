import { vocabulary, type BookKind, type Word } from "@writer/core";

/**
 * The words the editor says on screen (#22), from the book's kind: its piece ("scene"), the section
 * that holds pieces ("chapter") and all of them together ("manuscript"). The editor never says a
 * kind's words of its own.
 */
export interface EditorWords {
  piece: Word;
  section: Word;
  content: Word;
}

/** A kind's words for the editor. */
export function editorWords(kind: BookKind): EditorWords {
  const w = vocabulary(kind);
  return { piece: w.piece, section: w.level(kind.levels.at(-1)?.key ?? ""), content: w.content };
}
