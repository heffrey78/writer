// @vitest-environment jsdom
import "./dom.ts";
import { Editor } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, test } from "vitest";
import { changeLink, getMarkdown, linkAt, LinksExtension, loadMarkdown, proseContent, removeLink } from "../src/index.ts";

/** A link's address seen, and its words and address changed, from the text. */

let editor: Editor;
afterEach(() => editor?.destroy());

function open(md: string) {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({ element, extensions: [...proseContent, UndoRedo, LinksExtension] });
  loadMarkdown(editor, md);
  return editor;
}

const at = (text: string, offset = 0) => {
  let pos = -1;
  editor.state.doc.descendants((node, p) => {
    if (pos < 0 && node.isText && node.text!.includes(text)) pos = p + node.text!.indexOf(text) + offset;
  });
  return pos;
};
const caret = (pos: number) => editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));

describe("a link in the text", () => {
  test("is found around the caret, at its last letter too, and not beside it", () => {
    open("Watch [the ferry video](https://www.youtube.com/watch?v=abc) tonight.\n");
    caret(at("ferry"));
    expect(linkAt(editor.state)).toEqual({ from: at("the ferry"), to: at("the ferry") + "the ferry video".length, text: "the ferry video", href: "https://www.youtube.com/watch?v=abc" });
    caret(at("video", 5));
    expect(linkAt(editor.state)?.text).toBe("the ferry video");
    caret(at("tonight"));
    expect(linkAt(editor.state)).toBeUndefined();
  });

  test("has its words and address changed in place, the rest of the file as it was", () => {
    open("Watch [the ferry video](https://www.youtube.com/watch?v=abc) tonight.\n\nNothing else.\n");
    caret(at("ferry"));
    changeLink(editor.view, linkAt(editor.state)!, "Crossing at dawn", "https://youtu.be/xyz");
    expect(getMarkdown(editor)).toBe("Watch [Crossing at dawn](https://youtu.be/xyz) tonight.\n\nNothing else.\n");
    // Without words, it reads as its address.
    caret(at("Crossing"));
    changeLink(editor.view, linkAt(editor.state)!, "  ", "https://youtu.be/xyz");
    expect(getMarkdown(editor)).toBe("Watch <https://youtu.be/xyz> tonight.\n\nNothing else.\n");
  });

  test("is taken off, its words kept", () => {
    open("Watch [the ferry video](https://www.youtube.com/watch?v=abc) tonight.\n");
    caret(at("ferry"));
    removeLink(editor.view, linkAt(editor.state)!);
    expect(getMarkdown(editor)).toBe("Watch the ferry video tonight.\n");
  });

  test("shows its bar with its address while the text has the focus, and Mod+K edits it", () => {
    open("Watch [the ferry video](https://www.youtube.com/watch?v=abc) tonight.\n");
    editor.view.focus();
    caret(at("ferry"));
    const bar = document.querySelector<HTMLElement>(".ghw-link-bar")!;
    expect(bar.hidden).toBe(false);
    expect(bar.querySelector(".ghw-link-address")!.textContent).toBe("https://www.youtube.com/watch?v=abc");
    expect([...bar.querySelectorAll<HTMLButtonElement>("button")].filter((b) => !b.hidden && !b.closest("[hidden]")).map((b) => b.textContent)).toEqual(["Open", "Edit", "Remove link"]);
    editor.commands.keyboardShortcut("Mod-k");
    const text = bar.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(document.activeElement).toBe(text);
    expect(text.value).toBe("the ferry video");
    text.value = "The ferry";
    bar.querySelector("form")!.requestSubmit();
    expect(getMarkdown(editor)).toBe("Watch [The ferry](https://www.youtube.com/watch?v=abc) tonight.\n");
  });
});
