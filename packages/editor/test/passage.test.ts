// @vitest-environment jsdom
import "./dom.ts";
import { join } from "node:path";
import { Editor } from "@tiptap/core";
import { loadBook, passagesOf, type Book, type Piece } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { afterEach, expect, test } from "vitest";
import { chapterContent, loadChapter, loadMarkdown, passageRange, proseContent, selectPassage } from "../src/index.ts";

/*
 * A passage listed on an entry's profile (core's passagesOf, #135) opens the writing view with its
 * words selected (#153): core's blocks and the editor's paragraphs must read the same.
 */

const novel = await loadBook(nodeSource(join(import.meta.dirname, "../../../examples/sample-novel")));
const BEN = "char_b3n0vs";

let editor: Editor;
afterEach(() => editor?.destroy());

const scene = (markdown: string) => {
  editor = new Editor({ element: document.createElement("div"), extensions: proseContent });
  loadMarkdown(editor, markdown);
  return editor;
};
const chapter = (pieces: Piece[]) => {
  editor = new Editor({ element: document.createElement("div"), extensions: chapterContent });
  loadChapter(editor, pieces.map((p) => ({ id: p.file, title: p.title, markdown: p.body })));
  return editor;
};
/** The words between two positions, a mention as its words (it's selected whole). */
const words = (e: Editor, [from, to]: [number, number]) => e.state.doc.textBetween(from, to, undefined, (leaf) => (leaf.type.name === "mention" ? String(leaf.attrs.label) : "￼"));

test("every passage of every entry in the sample novel is found in its piece's editor and in its chapter's, at its words", () => {
  let checked = 0;
  for (const entity of novel.entities) {
    for (const p of passagesOf(novel, entity.id)) {
      const want = p.block.text.slice(...p.block.at);
      expect(words(scene(p.piece.body), passageRange(editor.state.doc, p.piece.file, p.block)!)).toBe(want);
      expect(words(editor, passageRange(editor.state.doc, p.piece.file, p.block, "sentence")!)).toBe(p.block.text.slice(...p.block.sentence));
      editor.destroy();
      const siblings = novel.pieces.filter((x) => x.sectionId === p.piece.sectionId);
      expect(words(chapter(siblings), passageRange(editor.state.doc, p.piece.file, p.block)!)).toBe(want);
      editor.destroy();
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(20);
});

test("finds a passage in lists, quotes, tables, headings and after pictures, and the right one of paragraphs reading the same", () => {
  const body = [
    "# Ben at the toll",
    "Ben waits.",
    "> Ben waits.",
    "- one\n- Ben, again",
    "| who | where |\n| --- | --- |\n| Ben | the bridge |",
    "![The bridge](pictures/bridge.jpg) and then [Ben](#char_b3n0vs) left.",
    "",
  ].join("\n\n");
  const book: Book = { ...novel, pieces: [{ ...novel.pieces[0]!, body }] };
  const passages = passagesOf(book, BEN);
  expect(passages.length).toBe(6);
  scene(body);
  const ranges = passages.map((p) => passageRange(editor.state.doc, p.piece.file, p.block)!);
  for (const r of ranges) expect(words(editor, r)).toBe("Ben");
  // The two "Ben waits." are told apart.
  expect(new Set(ranges.map(([from]) => from)).size).toBe(6);
});

test("selects the passage's sentence, or says it's gone when the text no longer reads that way", () => {
  const body = "He waited. Then [Ben](#char_b3n0vs) left. Night fell.\n";
  const [p] = passagesOf({ ...novel, pieces: [{ ...novel.pieces[0]!, body }] }, BEN);
  scene(body);
  expect(selectPassage(editor, p!.piece.file, p!.block)).toBe(true);
  const { from, to } = editor.state.selection;
  expect(words(editor, [from, to])).toBe("Then Ben left.");
  editor.commands.setContent("<p>Then he left.</p>");
  expect(selectPassage(editor, p!.piece.file, p!.block)).toBe(false);
});
