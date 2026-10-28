// @vitest-environment jsdom
import "./dom.ts";
import { Editor } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { TextSelection } from "@tiptap/pm/state";
import fc from "fast-check";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  chapterContent,
  contributedMenuItems,
  DictationExtension,
  documentCounts,
  getMarkdown,
  heardText,
  holdHeard,
  joinPhrase,
  leaveDictation,
  loadChapter,
  loadMarkdown,
  offerDictation,
  proseContent,
  serializeChapter,
  setAppContextMenu,
  settleHeard,
  showHeard,
  type DictationOffer,
} from "../src/index.ts";

/** Dictation in the editor (#79): heard words shown and never written; a settled phrase written once, as one change. */

let editor: Editor;
afterEach(() => {
  editor?.destroy();
  offerDictation(undefined);
  setAppContextMenu(false);
});

function open(markdown: string): Editor {
  editor = new Editor({ element: document.createElement("div"), extensions: [...proseContent, UndoRedo, DictationExtension] });
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

const shown = () => editor.view.dom.querySelector(".ghw-heard")?.textContent;

describe("words being heard", () => {
  test("show greyed at the caret and are never in the Markdown, the counts or the undo history", () => {
    open("Fog on the water.\n");
    after("water.");
    showHeard(editor, "then sun");
    expect(heardText(editor.state)).toBe("then sun");
    // At the caret, spaced and capitalised as they'd be written.
    expect(shown()).toBe(" Then sun");
    expect(editor.view.dom.querySelector(".ghw-heard")?.getAttribute("aria-hidden")).toBe("true");
    expect(getMarkdown(editor)).toBe("Fog on the water.\n");
    expect(documentCounts(editor.state.doc, "scene").total).toBe(4);
    expect(editor.can().undo()).toBe(false);
    showHeard(editor, "then sun at last");
    expect(shown()).toBe(" Then sun at last");
  });

  test("follow the caret as the writer types, and every keystroke is kept", () => {
    open("Fog on the water.\n");
    after("Fog");
    showHeard(editor, "and mist");
    editor.commands.insertContent(" thick");
    expect(getMarkdown(editor)).toBe("Fog thick on the water.\n");
    expect(heardText(editor.state)).toBe("and mist");
    settleHeard(editor, "and mist");
    expect(getMarkdown(editor)).toBe("Fog thick and mist on the water.\n");
  });
});

describe("a settled phrase", () => {
  test("is written once at the caret, as one undo step, and stops showing what was heard", () => {
    open("Fog on the water.\n");
    after("water.");
    editor.commands.insertContent(" Grey");
    showHeard(editor, "then sun");
    settleHeard(editor, "then sun.");
    expect(getMarkdown(editor)).toBe("Fog on the water. Grey then sun.\n");
    expect(heardText(editor.state)).toBe("");
    expect(shown()).toBeUndefined();
    // Not merged with the typing just before it.
    editor.commands.undo();
    expect(getMarkdown(editor)).toBe("Fog on the water. Grey\n");
  });

  test("replaces a selection, as typing does", () => {
    open("Fog on the water.\n");
    const start = 1 + "Fog on the ".length;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, start, start + "water".length)));
    settleHeard(editor, "estuary");
    expect(getMarkdown(editor)).toBe("Fog on the estuary.\n");
  });

  test("goes into the scene the caret is in, in a chapter", () => {
    editor = new Editor({ element: document.createElement("div"), extensions: [...chapterContent, UndoRedo, DictationExtension] });
    loadChapter(editor, [
      { id: "a", markdown: "One.\n" },
      { id: "b", markdown: "Two.\n" },
    ]);
    after("Two.");
    settleHeard(editor, "three");
    expect(serializeChapter(editor.state.doc).map((s) => s.markdown)).toEqual(["One.\n", "Two. Three\n"]);
  });

  test("an empty one only clears what was heard", () => {
    open("Fog.\n");
    after("Fog.");
    showHeard(editor, "um");
    settleHeard(editor, "  ");
    expect(getMarkdown(editor)).toBe("Fog.\n");
    expect(heardText(editor.state)).toBe("");
    expect(editor.can().undo()).toBe(false);
  });
});

describe("leaving", () => {
  test("tells the app the editor is going, which writes the words heard so far", () => {
    open("Fog.\n");
    after("Fog.");
    const left = vi.fn((e: Editor) => void holdHeard(e));
    offerDictation({ listening: () => true, toggle: () => {}, focused: () => {}, left });
    showHeard(editor, "then sun");
    leaveDictation(editor);
    expect(getMarkdown(editor)).toBe("Fog. Then sun\n");
    expect(left).toHaveBeenCalledWith(editor);
  });

  test("with nothing listening, writes words still shown", () => {
    open("Fog.\n");
    after("Fog.");
    showHeard(editor, "then sun");
    leaveDictation(editor);
    expect(getMarkdown(editor)).toBe("Fog. Then sun\n");
  });

  test("with nothing heard and nothing listening, changes nothing", () => {
    open("Fog.\n");
    const left = vi.fn();
    offerDictation({ listening: () => false, toggle: () => {}, focused: () => {}, left });
    leaveDictation(editor);
    expect(getMarkdown(editor)).toBe("Fog.\n");
    expect(left).not.toHaveBeenCalled();
  });
});

describe("words held when the page goes (#97)", () => {
  test("are written at once, as heard, and the phrase settled for them takes their place", () => {
    open("Fog.\n");
    after("Fog.");
    showHeard(editor, "then sun at");
    const held = holdHeard(editor)!;
    expect(getMarkdown(editor)).toBe("Fog. Then sun at\n");
    expect(heardText(editor.state)).toBe("");
    held.settle("Then, sun at last.");
    expect(getMarkdown(editor)).toBe("Fog. Then, sun at last.\n");
    // The host's last phrases come one by one: each settles the words held, all of them.
    held.settle("Then, sun at last. And wind.");
    expect(getMarkdown(editor)).toBe("Fog. Then, sun at last. And wind.\n");
  });

  test("follow what's typed around them, and between words keep their spacing", () => {
    open("Fog. Rain.\n");
    after("Fog.");
    showHeard(editor, "then sun");
    const held = holdHeard(editor)!;
    expect(getMarkdown(editor)).toBe("Fog. Then sun Rain.\n");
    after("Fog");
    editor.commands.insertContent(" thick");
    held.settle("then sun.");
    expect(getMarkdown(editor)).toBe("Fog thick. Then sun. Rain.\n");
  });

  test("changed since they were written, are left as they are", () => {
    open("Fog.\n");
    after("Fog.");
    showHeard(editor, "then sun");
    const held = holdHeard(editor)!;
    after("Then sun");
    editor.commands.insertContent("ny");
    held.settle("Then, sun.");
    expect(getMarkdown(editor)).toBe("Fog. Then sunny\n");
  });

  test("settled as \"new paragraph\" said alone, they become one", () => {
    open("Fog.\n");
    after("Fog.");
    showHeard(editor, "new pair of graph");
    const held = holdHeard(editor)!;
    held.settle("New paragraph.");
    expect(editor.state.doc.childCount).toBe(2);
    expect(getMarkdown(editor)).toBe("Fog.\n");
  });

  test("heard as \"new paragraph\", it's made at once, and nothing is held", () => {
    open("Fog.\n");
    after("Fog.");
    showHeard(editor, "new paragraph");
    expect(holdHeard(editor)).toBeUndefined();
    expect(editor.state.doc.childCount).toBe(2);
  });

  test("nothing heard, nothing held", () => {
    open("Fog.\n");
    expect(holdHeard(editor)).toBeUndefined();
    expect(getMarkdown(editor)).toBe("Fog.\n");
  });
});

describe("Dictate in the editor", () => {
  const offer = (listening = false) => ({ listening: () => listening, toggle: vi.fn<DictationOffer["toggle"]>(), focused: vi.fn<DictationOffer["focused"]>(), left: vi.fn<DictationOffer["left"]>() });

  test("Mod-Shift-D asks the app, only once it offers dictation", () => {
    open("Fog.\n");
    const press = () => {
      const event = new KeyboardEvent("keydown", { key: "D", shiftKey: true, ctrlKey: true, bubbles: true });
      // ProseMirror falls back to keyCode for shifted letters; jsdom doesn't set it.
      Object.defineProperty(event, "keyCode", { value: 68 });
      return editor.view.someProp("handleKeyDown", (f) => f(editor.view, event));
    };
    expect(press()).toBeFalsy();
    const app = offer();
    offerDictation(app);
    expect(press()).toBe(true);
    expect(app.toggle).toHaveBeenCalledWith(editor);
  });

  test("the editor taking the caret is told to the app", () => {
    open("Fog.\n");
    const app = offer();
    offerDictation(app);
    editor.emit("focus", { editor, event: new FocusEvent("focus"), transaction: editor.state.tr });
    expect(app.focused).toHaveBeenCalledWith(editor);
  });

  test("the right-click menu has Dictate, or Stop dictating while listening, in the app's menu only", () => {
    open("Fog.\n");
    const click = () => {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(event);
      return contributedMenuItems(event).flatMap((g) => (Array.isArray(g.items) ? g.items.map((i) => i.label) : []));
    };
    offerDictation(offer());
    expect(click()).toEqual([]);
    setAppContextMenu(true);
    expect(click()).toEqual(["Dictate"]);
    offerDictation(offer(true));
    expect(click()).toEqual(["Stop dictating"]);
    offerDictation(undefined);
    expect(click()).toEqual([]);
  });
});

describe("joining a phrase to the text around it", () => {
  test.each([
    ["", "fog on the water.", "", "Fog on the water."],
    ["Fog.", "then sun", "", " Then sun"],
    ["Fog. ", "then sun", "", "Then sun"],
    ["Fog and", "Ada came", "", " Ada came"],
    ["Fog and", "mist", " on the water.", " mist"],
    ["Fog", ", then sun", "", ", then sun"],
    ["She said “", "go", "”", "go"],
    ["(", "aside", ")", "aside"],
    ["Fog ", "and", "mist", "and "],
    ["Is it fog?”", "no", "", " No"],
    ["fog", "   and   mist  ", "", " and mist"],
    ["fog", "   ", "", ""],
  ])("%j + %j + %j", (before, phrase, after, written) => {
    expect(joinPhrase(before, phrase, after)).toBe(written);
  });

  test("never makes a double space where it joins, or a space before punctuation", () => {
    const text = fc.stringMatching(/^[a-zA-Z .,!?]{0,12}$/);
    fc.assert(
      fc.property(text, text, text, (before, phrase, after) => {
        const inserted = joinPhrase(before, phrase, after);
        if (!inserted) return;
        expect(`${before.slice(-1)}${inserted}${after.slice(0, 1)}`).not.toMatch(/ {2}/);
        expect(inserted).not.toMatch(/^ [.,;:!?]/);
      }),
    );
  });
});
