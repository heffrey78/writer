// @vitest-environment jsdom
import "./dom.ts";
import { Editor } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import fc from "fast-check";
import { afterEach, describe, expect, test, vi } from "vitest";
import { chapterContent, getMarkdown, insertPicture, loadChapter, loadMarkdown, movePicture, pictureAt, PicturesExtension, proseContent, removePicture, serializeChapter, setPicture, type PictureCallbacks } from "../src/index.ts";

/** Pictures put in, changed and handed to the app (D10, heffrey78/gh-writer#203). */

const MAP = { url: "/images/map.jpg", alt: "A map of Varn", caption: "The valley" };
let editor: Editor;
afterEach(() => editor?.destroy());

function open(md: string, callbacks: PictureCallbacks = {}) {
  editor = new Editor({ element: document.createElement("div"), extensions: [...proseContent, UndoRedo, PicturesExtension.configure({ callbacks: () => callbacks })] });
  loadMarkdown(editor, md);
  return editor;
}

/** The position just inside the first textblock holding `text`. */
function inText(text: string): number {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent.includes(text)) at = pos + 1;
  });
  return at;
}

describe("insertPicture", () => {
  test("goes after the block holding the caret, which moves on into the next paragraph", () => {
    open("One _here_.\n\nTwo.\n");
    insertPicture(editor, MAP, inText("One"));
    expect(getMarkdown(editor)).toBe('One _here_.\n\n![A map of Varn](/images/map.jpg "The valley")\n\nTwo.\n');
    expect(editor.state.selection.$from.parent.textContent).toBe("Two.");
  });

  test("at the end, leaves an empty paragraph to write on in, unwritten until something's typed", () => {
    open("One.\n");
    insertPicture(editor, { url: "/images/seal.png", alt: "The seal" }, inText("One"));
    expect(getMarkdown(editor)).toBe("One.\n\n![The seal](/images/seal.png)\n");
    editor.commands.insertContent("After.");
    expect(getMarkdown(editor)).toBe("One.\n\n![The seal](/images/seal.png)\n\nAfter.\n");
  });

  test("takes an empty paragraph's place, and goes after a whole list from inside one", () => {
    open("One.\n\n- a\n- b\n\nTwo.\n");
    insertPicture(editor, { url: "/images/x.jpg", alt: "X" }, inText("a"));
    expect(getMarkdown(editor)).toBe("One.\n\n- a\n- b\n\n![X](/images/x.jpg)\n\nTwo.\n");
    editor.chain().setTextSelection(inText("One") + 4).splitBlock().run();
    insertPicture(editor, { url: "/images/y.jpg", alt: "Y" });
    expect(getMarkdown(editor)).toBe("One.\n\n![Y](/images/y.jpg)\n\n- a\n- b\n\n![X](/images/x.jpg)\n\nTwo.\n");
  });

  test("between two of a chapter's scenes, goes in the scene before, adding none", () => {
    editor = new Editor({ element: document.createElement("div"), extensions: [...chapterContent, UndoRedo] });
    loadChapter(editor, [
      { id: "a", title: "A", markdown: "First.\n" },
      { id: "b", title: "B", markdown: "Second.\n" },
    ]);
    const between = editor.state.doc.firstChild!.nodeSize;
    insertPicture(editor, MAP, between);
    expect(editor.state.doc.childCount).toBe(2);
    expect(serializeChapter(editor.state.doc)).toEqual([
      { id: "a", markdown: 'First.\n\n![A map of Varn](/images/map.jpg "The valley")\n' },
      { id: "b", markdown: "Second.\n" },
    ]);
  });
});

describe("a picture in the text", () => {
  const md = "Some _emphasis_ here.\n\n![Old](/images/map.jpg 'Old caption')\n\nMore  text.\n";

  test("is read, and changed with only its own line rewritten", () => {
    open(md);
    const at = inText("Some") - 1 + editor.state.doc.firstChild!.nodeSize;
    expect(pictureAt(editor, at)).toEqual({ url: "/images/map.jpg", alt: "Old", caption: "Old caption" });
    expect(pictureAt(editor, 0)).toBeUndefined();
    setPicture(editor, at, { alt: "New", caption: "" });
    expect(getMarkdown(editor)).toBe("Some _emphasis_ here.\n\n![New](/images/map.jpg)\n\nMore  text.\n");
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    // Selected, Delete takes it.
    editor.commands.deleteSelection();
    expect(getMarkdown(editor)).toBe("Some _emphasis_ here.\n\nMore  text.\n");
  });

  test("selected, Enter hands it to the app to change; elsewhere Enter is Enter", () => {
    const edit = vi.fn();
    open(md, { edit });
    const at = editor.state.doc.firstChild!.nodeSize;
    const enter = () => editor.view.someProp("handleKeyDown", (f) => f(editor.view, new KeyboardEvent("keydown", { key: "Enter" })));
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, at)));
    expect(enter()).toBe(true);
    expect(edit).toHaveBeenCalledWith(at);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, inText("More"))));
    enter();
    expect(edit).toHaveBeenCalledTimes(1);
  });

  test("given a url, shows another picture, its line alone rewritten", () => {
    open(md);
    const at = editor.state.doc.firstChild!.nodeSize;
    setPicture(editor, at, { url: "/images/map-2.jpg", alt: "Old", caption: "Old caption" });
    expect(getMarkdown(editor)).toBe('Some _emphasis_ here.\n\n![Old](/images/map-2.jpg "Old caption")\n\nMore  text.\n');
  });

  test("is removed, the caret where it was", () => {
    open(md);
    expect(removePicture(editor, editor.state.doc.firstChild!.nodeSize)).toBe(true);
    expect(getMarkdown(editor)).toBe("Some _emphasis_ here.\n\nMore  text.\n");
    expect(removePicture(editor, 0)).toBe(false);
  });
});

describe("moving a picture (#200)", () => {
  const md = "One.\n\n![A](/images/a.jpg)\n\n![B](/images/b.jpg)\n\nTwo.\n";
  const pos = (n: number) => {
    let at = 0;
    for (let i = 0; i < n; i++) at += editor.state.doc.child(i).nodeSize;
    return at;
  };
  const alt = (e: string) => editor.view.someProp("handleKeyDown", (f) => f(editor.view, new KeyboardEvent("keydown", { key: e, altKey: true })));

  test("Alt+↑ and Alt+↓ move it past the block before or after, still selected", () => {
    open(md);
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos(1))));
    expect(alt("ArrowUp")).toBe(true);
    expect(getMarkdown(editor)).toBe("![A](/images/a.jpg)\n\nOne.\n\n![B](/images/b.jpg)\n\nTwo.\n");
    expect(pictureAt(editor, (editor.state.selection as NodeSelection).from)?.alt).toBe("A");
    // At the start it stays.
    expect(alt("ArrowUp")).toBe(true);
    expect(editor.state.doc.child(0).attrs.alt).toBe("A");
    alt("ArrowDown");
    alt("ArrowDown");
    expect(getMarkdown(editor)).toBe("One.\n\n![B](/images/b.jpg)\n\n![A](/images/a.jpg)\n\nTwo.\n");
    expect((editor.state.selection as NodeSelection).node.attrs.alt).toBe("A");
  });

  test("goes past the empty line left after a picture put in, to the next block with something in it", () => {
    open("One.\n\n![B](/images/b.jpg)\n\nTwo.\n");
    insertPicture(editor, { url: "/images/a.jpg", alt: "A" }, inText("One"));
    // One, A, an empty paragraph, B, Two.
    expect(editor.state.doc.child(2).childCount).toBe(0);
    expect(movePicture(editor, pos(1), 1)).toBe(true);
    expect(getMarkdown(editor)).toBe("One.\n\n![B](/images/b.jpg)\n\n![A](/images/a.jpg)\n\nTwo.\n");
    expect((editor.state.selection as NodeSelection).node.attrs.alt).toBe("A");
    expect(movePicture(editor, (editor.state.selection as NodeSelection).from, -1)).toBe(true);
    expect(getMarkdown(editor)).toBe("One.\n\n![A](/images/a.jpg)\n\n![B](/images/b.jpg)\n\nTwo.\n");
  });

  test("Alt+arrows on text are left alone, and movePicture says when it can't", () => {
    open(md);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, inText("One"))));
    expect(alt("ArrowDown")).toBeFalsy();
    expect(movePicture(editor, pos(2), 1)).toBe(true);
    expect(getMarkdown(editor)).toBe("One.\n\n![A](/images/a.jpg)\n\nTwo.\n\n![B](/images/b.jpg)\n");
    expect(movePicture(editor, pos(3), 1)).toBe(false);
    expect(movePicture(editor, pos(0), 1)).toBe(false);
  });
});

describe("pictures on neighbouring lines (#201)", () => {
  /** Each picture's row size as shown, in order: 0 for one on its own. */
  const rows = () => [...editor.view.dom.querySelectorAll("figure")].map((f) => Number(/--ghw-row: (\d)/.exec(f.getAttribute("style") ?? "")?.[1] ?? 0));
  const pic = (n: number) => `![P${n}](/images/p${n}.jpg)`;

  test("show as rows of up to three, a fourth starting another, a picture alone left alone", () => {
    open([pic(1), "Words.", pic(2), pic(3), "More.", pic(4), pic(5), pic(6), pic(7), pic(8)].join("\n\n") + "\n");
    expect(rows()).toEqual([0, 2, 2, 3, 3, 3, 2, 2]);
    // In the DOM, each still a figure of its own, in order.
    const figures = [...editor.view.dom.querySelectorAll("figure")];
    expect(figures.map((f) => f.querySelector("img")!.alt)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"]);
    expect(figures.map((f) => f.classList.contains("ghw-picture-row-first"))).toEqual([false, true, false, true, false, false, true, false]);
  });

  test("in a chapter, a scene's own pictures make its rows", () => {
    editor = new Editor({ element: document.createElement("div"), extensions: [...chapterContent, UndoRedo, PicturesExtension] });
    loadChapter(editor, [
      { id: "a", title: "A", markdown: `${pic(1)}\n` },
      { id: "b", title: "B", markdown: `${pic(2)}\n\n${pic(3)}\n` },
    ]);
    expect(rows()).toEqual([0, 2, 2]);
  });

  test("a run of pictures and paragraphs round-trips byte for byte", () => {
    const block = fc.oneof(fc.integer({ min: 1, max: 9 }).map(pic), fc.constantFrom("Words.", "Some _more_ words.", '![Captioned](/images/c.jpg "A caption")'));
    fc.assert(
      fc.property(fc.array(block, { minLength: 1, maxLength: 10 }), (blocks) => {
        const md = `${blocks.join("\n\n")}\n`;
        open(md);
        const same = getMarkdown(editor) === md;
        editor.destroy();
        return same;
      }),
      { numRuns: 200 },
    );
  });
});
