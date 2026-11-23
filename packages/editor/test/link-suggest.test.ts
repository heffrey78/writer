// @vitest-environment jsdom
import "./dom.ts";
import { Editor } from "@tiptap/core";
import { nameMatcher, namesInBlock, proseBlocks } from "@writer/core";
import fc from "fast-check";
import { afterEach, beforeEach, expect, test } from "vitest";
import { getMarkdown, linkNameAtCaret, linkSuggestKey, LinkSuggestExtension, loadMarkdown, notANameAtCaret, proseContent, writingModes, type MentionEntity } from "../src/index.ts";
import type { NotName } from "@writer/core";

const entities: MentionEntity[] = [
  { id: "char_7f3k2q", name: "Ada Varn", aliases: ["Ada"], type: "Character" },
  { id: "char_b3n0vs", name: "Ben Varn", aliases: ["Ben"], type: "Character" },
  { id: "loc_br1dg3", name: "The Varn Bridge", aliases: ["the bridge"], type: "Location" },
];

let editor: Editor;
beforeEach(() => writingModes.setState({ linkSuggestions: true }));
afterEach(() => {
  editor?.destroy();
  writingModes.setState({ linkSuggestions: false });
});

function open(markdown: string) {
  editor = new Editor({ element: document.body.appendChild(document.createElement("div")), extensions: [...proseContent, LinkSuggestExtension.configure({ entities: () => entities })] });
  loadMarkdown(editor, markdown);
  return editor;
}
const suggested = () => (linkSuggestKey.getState(editor.state)?.find() ?? []).map((d) => editor.state.doc.textBetween(d.from, d.to));

test("underlines whole names and aliases written as plain text, longest first, never mentions or links", () => {
  open("Ada Varn met Ben on the bridge. Adam and BEN didn't. [Ada](#char_7f3k2q) and [Ben](https://x.example) waved, and *Ada* too.\n");
  expect(suggested()).toEqual(["Ada Varn", "Ben", "the bridge", "Ada"]);
  expect(editor.view.dom.querySelectorAll(".ghw-unlinked")).toHaveLength(4);
});

test("off by default, and turning it off clears the underlines; nothing changes without the author", () => {
  open("Ada waved.\n");
  expect(suggested()).toEqual(["Ada"]);
  writingModes.setState({ linkSuggestions: false });
  expect(suggested()).toEqual([]);
  expect(getMarkdown(editor)).toBe("Ada waved.\n");
});

test("linking the name at the caret makes a mention showing the words as written", () => {
  open("Then the bridge held, and *Ben* laughed.\n");
  editor.commands.setTextSelection(8); // inside "the bridge"
  expect(linkNameAtCaret(editor)).toBe(true);
  editor.commands.setTextSelection(editor.state.doc.content.size - 10); // inside "Ben"
  expect(linkNameAtCaret(editor)).toBe(true);
  expect(getMarkdown(editor)).toBe("Then [the bridge](#loc_br1dg3) held, and *[Ben](#char_b3n0vs)* laughed.\n");
  editor.commands.setTextSelection(2);
  expect(linkNameAtCaret(editor)).toBe(false);
});

test("Alt+Enter links the name at the caret, beside the mention card's shortcut", async () => {
  const { MentionInfoExtension } = await import("../src/index.ts");
  editor = new Editor({
    element: document.body.appendChild(document.createElement("div")),
    extensions: [...proseContent, LinkSuggestExtension.configure({ entities: () => entities }), MentionInfoExtension],
  });
  loadMarkdown(editor, "Then the bridge held.\n");
  editor.commands.setTextSelection(8);
  const event = new KeyboardEvent("keydown", { key: "Enter", altKey: true, bubbles: true, cancelable: true });
  expect(editor.view.someProp("handleKeyDown", (f) => f(editor.view, event))).toBe(true);
  expect(getMarkdown(editor)).toBe("Then [the bridge](#loc_br1dg3) held.\n");
});

// The names underlined here are the passages not linked on an entry's profile (#135): core finds both.
const coreSuggested = (markdown: string) => {
  const m = nameMatcher(entities);
  return proseBlocks(markdown).flatMap((b) => namesInBlock(markdown, b, m).filter((h) => !h.linked).map((h) => b.text.slice(...h.at)));
};

test("underlines exactly the names core lists as passages not linked", () => {
  for (const markdown of [
    "Ada Varn met Ben on the bridge. Adam and BEN didn't. [Ada](#char_7f3k2q) and [Ben](https://x.example) waved, and *Ada* too.\n",
    "# Ada at the bridge\n\nShe saw *Ada* Varn and **the bridge**, snake_Ada and _Ben_.\n",
    "- Ben first\n- then Ada\n\n> Ben, quoted.\n\n```\nAda in code\n```\n\nA note `Ben` in code.\n",
    "Fish \\& chips &amp; Ben. ![Ada](/images/ada.jpg) Ada.\n",
    "| Who | Where |\n| --- | --- |\n| Ada | the bridge |\n",
  ]) {
    open(markdown);
    expect(suggested(), markdown).toEqual(coreSuggested(markdown));
    editor.destroy();
  }
});

test("agrees with core on random prose of names, words, emphasis and links", () => {
  const token = fc.oneof(
    fc.constantFrom("she", "walked", "Adam", "Bennet", "bridges", ",", ".", "Varn", "the"),
    fc.constantFrom("Ada", "Ada Varn", "Ben", "the bridge"),
    fc.constantFrom("[Ada](#char_7f3k2q)", "[a link](https://x.example)", "*Ben*", "**Ada**", "_the bridge_", "`Ada`"),
  );
  const paragraph = fc.array(token, { minLength: 1, maxLength: 10 }).map((t) => t.join(" ").replace(/ ([,.])/g, "$1"));
  fc.assert(
    fc.property(fc.array(paragraph, { minLength: 1, maxLength: 3 }), (paragraphs) => {
      const markdown = `${paragraphs.join("\n\n")}\n`;
      open(markdown);
      try {
        expect(suggested()).toEqual(coreSuggested(markdown));
      } finally {
        editor.destroy();
      }
    }),
    { numRuns: 60 },
  );
});

test("leaves a word judged not a name here un-underlined, by core's one rule, and keeps a new judgement from the caret (D19)", () => {
  const ADA = "char_7f3k2q";
  const kept: NotName[] = [];
  let judgements: NotName[] = [{ entry: ADA, piece: "sc_aaaaaa", sentence: "Then Ada went, and Ada came back.", nth: 1 }];
  editor = new Editor({
    element: document.body.appendChild(document.createElement("div")),
    extensions: [...proseContent, LinkSuggestExtension.configure({ entities: () => entities, notNames: () => judgements, piece: () => "sc_aaaaaa", onNotName: (j) => void kept.push(j) })],
  });
  loadMarkdown(editor, "Ada said so. Then Ada went, and Ada came back.\n");
  const at = (n: number) => (linkSuggestKey.getState(editor.state)?.find() ?? []).map((d) => d.from)[n]!;
  expect(suggested()).toEqual(["Ada", "Ada"]);
  // Another piece's judgement doesn't hold here.
  judgements = [{ ...judgements[0]!, piece: "sc_zzzzzz" }];
  editor.view.dispatch(editor.state.tr.setMeta(linkSuggestKey, true));
  expect(suggested()).toEqual(["Ada", "Ada", "Ada"]);
  editor.commands.setTextSelection(at(1) + 1);
  expect(notANameAtCaret(editor)).toBe(true);
  expect(kept).toEqual([{ entry: ADA, piece: "sc_aaaaaa", sentence: "Then Ada went, and Ada came back.", nth: 0 }]);
  editor.commands.setTextSelection(2);
  expect(notANameAtCaret(editor)).toBe(true);
  expect(kept[1]).toEqual({ entry: ADA, piece: "sc_aaaaaa", sentence: "Ada said so.", nth: 0 });
});
