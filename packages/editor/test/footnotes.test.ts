// @vitest-environment jsdom
import "./dom.ts";
import { Editor } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, test } from "vitest";
import { chapterContent, FootnotesExtension, getMarkdown, loadChapter, loadMarkdown, parseProse, proseContent, serializeChapter, serializeProse } from "../src/index.ts";

/** Footnotes in the editor (#58): kept byte for byte, shown and written as notes, added, followed and removed. */

let editor: Editor;
afterEach(() => editor?.destroy());

function open(markdown: string): Editor {
  editor = new Editor({ element: document.createElement("div"), extensions: [...proseContent, UndoRedo, FootnotesExtension] });
  loadMarkdown(editor, markdown);
  return editor;
}

/** The caret just after `text`. */
function after(text: string): void {
  let pos = -1;
  editor.state.doc.descendants((node, p) => {
    if (pos < 0 && node.isText && node.text!.includes(text)) pos = p + node.text!.indexOf(text) + text.length;
  });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
}

const types = (md: string) => {
  const out: string[] = [];
  parseProse(md).descendants((n) => void out.push(n.type.name));
  return out;
};

describe("footnotes in the Markdown", () => {
  test("are read as a reference and a note, and an untouched file is written back byte for byte", () => {
    const md = "The clock ran fast.[^1] It always had.[^watch]\n\n[^1]: Four minutes.\n\n[^watch]: The station master's,\n    hard-wrapped.\n\n    And a second paragraph.\n";
    expect(types(md)).toEqual(["paragraph", "text", "footnote_ref", "text", "footnote_ref", "footnote", "paragraph", "text", "footnote", "paragraph", "text", "paragraph", "text"]);
    expect(serializeProse(parseProse(md))).toBe(md);
  });

  test("a note with more than paragraphs stays raw Markdown, kept as it was", () => {
    const md = "Text.[^1]\n\n[^1]: A list:\n\n    - one\n    - two\n";
    expect(types(md)).toContain("raw_block");
    expect(serializeProse(parseProse(md))).toBe(md);
  });

  test("an edited note is written in canonical form; an empty one still defines its footnote", () => {
    open("Text.[^1]\n\n[^1]: Old.\n");
    after("Old.");
    editor.commands.insertContent(" New.");
    expect(getMarkdown(editor)).toBe("Text.[^1]\n\n[^1]: Old. New.\n");
    open("Text.[^1]\n\n[^1]:\n");
    expect(getMarkdown(editor)).toBe("Text.[^1]\n\n[^1]:\n");
  });
});

describe("working with footnotes", () => {
  test("Mod-Alt-F adds one at the caret, the file's next number, its note at the end with the caret in it", () => {
    open("The clock ran fast.[^1] It always had.\n\nThe end.\n\n[^1]: Four minutes.\n");
    after("It always had.");
    expect(editor.commands.addFootnote()).toBe(true);
    editor.commands.insertContent("Since 1912.");
    expect(getMarkdown(editor)).toBe("The clock ran fast.[^1] It always had.[^2]\n\nThe end.\n\n[^1]: Four minutes.\n\n[^2]: Since 1912.\n");
    // In a note, the same keys go back to where it's referred to.
    expect(editor.commands.followFootnote()).toBe(true);
    expect(editor.state.selection.$from.nodeBefore?.type.name).toBe("footnote_ref");
    expect(editor.state.selection.$from.nodeBefore?.attrs.label).toBe("2");
    // And from just after a reference, to its note.
    expect(editor.commands.followFootnote()).toBe(true);
    expect(editor.state.selection.$from.parent.textContent).toBe("Since 1912.");
  });

  test("deleting a footnote's last reference removes its note; undo brings both back", () => {
    open("A.[^1] B.[^2]\n\n[^1]: One.\n\n[^2]: Two.\n");
    after("A.");
    const pos = editor.state.selection.from;
    editor.view.dispatch(editor.state.tr.delete(pos, pos + 1));
    expect(getMarkdown(editor)).toBe("A. B.[^2]\n\n[^2]: Two.\n");
    editor.commands.undo();
    expect(getMarkdown(editor)).toBe("A.[^1] B.[^2]\n\n[^1]: One.\n\n[^2]: Two.\n");
  });

  test("a note whose reference was never there is left alone", () => {
    open("Text.\n\n[^1]: An orphan.\n");
    after("Text.");
    editor.commands.insertContent(" More.");
    expect(getMarkdown(editor)).toBe("Text. More.\n\n[^1]: An orphan.\n");
  });

  test("in a chapter, each scene's footnotes are its own: numbered, placed and removed there", () => {
    editor = new Editor({ element: document.createElement("div"), extensions: [...chapterContent, UndoRedo, FootnotesExtension] });
    loadChapter(editor, [
      { id: "sc_1", title: "One", markdown: "First.[^1]\n\n[^1]: Note one.\n" },
      { id: "sc_2", title: "Two", markdown: "Second.[^1]\n\n[^1]: Another note one.\n" },
    ]);
    after("Second.");
    editor.commands.addFootnote();
    editor.commands.insertContent("Two's second.");
    const bodies = () => Object.fromEntries(serializeChapter(editor.state.doc).map((s) => [s.id, s.markdown]));
    expect(bodies()).toEqual({
      sc_1: "First.[^1]\n\n[^1]: Note one.\n",
      // The caret was after "Second.", before its reference: the new one goes there, numbered on.
      sc_2: "Second.[^2][^1]\n\n[^1]: Another note one.\n\n[^2]: Two's second.\n",
    });
    // Scene one's [^1] goes; scene two's [^1] stays.
    after("First.");
    const pos = editor.state.selection.from;
    editor.view.dispatch(editor.state.tr.delete(pos, pos + 1));
    expect(bodies().sc_1).toBe("First.\n");
    expect(bodies().sc_2).toContain("[^1]: Another note one.");
  });
});
