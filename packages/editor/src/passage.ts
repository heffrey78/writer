import type { Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { resolveAnchor } from "@writer/core";
import { sceneTextAt } from "./issue-marks.ts";
import { editorScenes } from "./search.ts";

/** Where a passage is (core's Passage.block): its block's text, which of the blocks reading the same, and the name and its sentence in it. */
export interface PassagePlace {
  text: string;
  nth: number;
  at: [number, number];
  sentence: [number, number];
}

/**
 * A textblock's text as core reads prose (proseBlocks): a mention as its words, anything else that
 * isn't text (a picture, a break, a footnote's marker) one character. With where in the block each
 * stretch of it starts: a mention's words are one position, its atom.
 */
function readBlock(block: Node): { text: string; spans: { at: number; length: number; pos: number; atom: boolean }[] } {
  let text = "";
  const spans: { at: number; length: number; pos: number; atom: boolean }[] = [];
  block.forEach((child, pos) => {
    const words = child.isText ? child.text! : child.type.name === "mention" ? String(child.attrs.label) : "\uFFFC";
    spans.push({ at: text.length, length: words.length, pos, atom: !child.isText });
    text += words;
  });
  return { text, spans };
}

/** A place in a block's text (from readBlock) as a position in it: inside a mention's words, its start or (`end`) its end. */
function positionAt(spans: ReturnType<typeof readBlock>["spans"], offset: number, end: boolean): number {
  for (const s of spans) {
    if (end ? offset > s.at + s.length : offset >= s.at + s.length) continue;
    if (!s.atom) return s.pos + offset - s.at;
    return end ? s.pos + 1 : s.pos;
  }
  const last = spans.at(-1);
  return last ? last.pos + (last.atom ? 1 : last.length) : 0;
}

/**
 * Where a passage of a piece is in the editor, as [from, to]: the piece's `nth` paragraph or heading
 * whose text reads `text` as core reads it, and `at` in it (a mention whole). In a chapter, only the
 * piece whose file is `file` is looked in. Undefined when the text has changed since and no block
 * reads that way.
 */
export function passageRange(doc: Node, file: string, place: PassagePlace, what: "at" | "sentence" = "at"): [number, number] | undefined {
  let root: Node | undefined = doc;
  let offset = 0;
  if (doc.type.name === "chapter") {
    root = undefined;
    doc.forEach((node, pos) => {
      if (!root && node.attrs.id === file) {
        root = node;
        offset = pos + 1;
      }
    });
  }
  if (!root) return undefined;
  let seen = 0;
  let found: [number, number] | undefined;
  root.descendants((node, pos) => {
    if (found !== undefined) return false;
    if (!node.isTextblock) return true;
    if (node.type.spec.code) return false;
    const { text, spans } = readBlock(node);
    if (text === place.text && seen++ === place.nth) {
      const start = offset + pos + 1;
      found = [start + positionAt(spans, place[what][0], false), start + positionAt(spans, place[what][1], true)];
    }
    return false;
  });
  return found;
}

/** Select a passage's sentence in the editor and bring it into view, with the focus. False if it isn't there any more. */
export function selectPassage(editor: Editor, file: string, place: PassagePlace): boolean {
  const range = passageRange(editor.state.doc, file, place, "sentence");
  if (!range) return false;
  editor.chain().focus().setTextSelection({ from: range[0], to: range[1] }).scrollIntoView().run();
  return true;
}

/**
 * Where a quote kept from a piece (an entry's notes, #157) is in the editor now, found as an issue's
 * passage is (resolveAnchor over the piece's text): undefined if the piece isn't in the editor or
 * no longer reads close enough to it.
 */
export function quoteRange(editor: Editor, file: string, quote: string): [number, number] | undefined {
  const scene = editorScenes(editor).get(file);
  if (!scene) return undefined;
  const { text, from, to } = sceneTextAt(scene.node, scene.contentStart);
  const match = resolveAnchor(text, quote);
  if (!match || match.to <= match.from) return undefined;
  return [from[match.from]!, to[match.to - 1]!];
}

/** Select a quote kept from a piece and bring it into view, with the focus. False if it can't be found. */
export function selectQuote(editor: Editor, file: string, quote: string): boolean {
  const range = quoteRange(editor, file, quote);
  if (!range) return false;
  editor.chain().focus().setTextSelection({ from: range[0], to: range[1] }).scrollIntoView().run();
  return true;
}
