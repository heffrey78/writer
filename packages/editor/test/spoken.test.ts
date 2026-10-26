// @vitest-environment jsdom
import "./dom.ts";
import { Editor } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { afterEach, describe, expect, it } from "vitest";
import { DictationExtension, getMarkdown, loadMarkdown, MentionSuggestExtension, proseContent, settleHeard, sound, spokenPhrase, type MentionEntity, type SpokenName } from "../src/index.ts";

/** What a settled phrase writes (#81): the book's names as it spells them, and "new paragraph" or "new line" said alone. */

// From the sample books: a novel's characters, a journal's people, a campaign's codex.
const novel: SpokenName[] = [
  { name: "Tomas Hale", aliases: ["Tomas"] },
  { name: "Ada Varn", aliases: ["Ada"] },
  { name: "The Station", aliases: [] },
];
const journal: SpokenName[] = [
  { name: "Tomas Vey", aliases: ["Tomas"] },
  { name: "Mira Hale", aliases: ["Mira"] },
];
const campaign: SpokenName[] = [
  { name: "Marta Hollin", aliases: ["Marta"] },
  { name: "Why the Bell Rings", aliases: ["the bell"] },
  { name: "Voss", aliases: [] },
];
const text = (phrase: string, names: readonly SpokenName[]) => {
  const spoken = spokenPhrase(phrase, names);
  return spoken.kind === "text" ? spoken.text : spoken.kind;
};

describe("a settled phrase", () => {
  it("that's only new paragraph or new line says so", () => {
    for (const phrase of ["New paragraph.", "new paragraph", " New paragraph! "]) expect(spokenPhrase(phrase, novel)).toEqual({ kind: "paragraph" });
    expect(spokenPhrase("New line.", novel)).toEqual({ kind: "line" });
    // Said in a sentence, they're words.
    expect(text("She turned to a new paragraph of the letter.", novel)).toBe("She turned to a new paragraph of the letter.");
    expect(text("New line of work.", novel)).toBe("New line of work.");
  });

  it("writes a name heard as it sounds as the book spells it, in a novel, a journal and a campaign", () => {
    expect(text("Thomas came down to the bridge.", novel)).toBe("Tomas came down to the bridge.");
    expect(text("I met Thomas Hale at the gate.", novel)).toBe("I met Tomas Hale at the gate.");
    expect(text("Thomas's workshop was cold.", novel)).toBe("Tomas's workshop was cold.");
    expect(text("Thomas and Myra counted the birds.", journal)).toBe("Tomas and Mira counted the birds.");
    expect(text("We asked Martha Hollin and Vos.", campaign)).toBe("We asked Marta Hollin and Voss.");
    expect(text("ADA waited.", novel)).toBe("Ada waited.");
  });

  it("leaves what the recognizer didn't take for a name", () => {
    // Lower case: an ordinary word, whatever the index calls a place.
    expect(text("He walked to the station.", novel)).toBe("He walked to the station.");
    expect(text("thomas", novel)).toBe("thomas");
    // A sentence's first word is capitalised anyway: a short one must match in letters.
    expect(text("Hop on.", [{ name: "Hope", aliases: [] }])).toBe("Hop on.");
    expect(text("An old man.", [{ name: "Anne", aliases: [] }])).toBe("An old man.");
    expect(text("I saw Ann there.", [{ name: "Anne", aliases: [] }])).toBe("I saw Anne there.");
    expect(text("Times change.", journal)).toBe("Times change.");
    expect(text("The bell rang.", campaign)).toBe("The bell rang.");
    expect(text("Thomas came.", [])).toBe("Thomas came.");
  });

  it("hears alike the spellings that sound alike", () => {
    expect(sound("Thomas")).toBe(sound("Tomas"));
    expect(sound("Ann")).toBe(sound("Anne"));
    expect(sound("Catherine")).toBe(sound("Katherine"));
    expect(sound("Philippa")).toBe(sound("Filipa"));
    expect(sound("Zoë")).toBe(sound("Zoe"));
    expect(sound("Tomas")).not.toBe(sound("Times"));
    expect(sound("Anna")).not.toBe(sound("Anne"));
  });
});

describe("in the editor", () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());
  const entities: MentionEntity[] = novel.map((n, i) => ({ id: `char_${i}`, ...n, aliases: [...n.aliases], type: "Character" }));
  function open(markdown: string, withNames = true): Editor {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [...proseContent, UndoRedo, DictationExtension, ...(withNames ? [MentionSuggestExtension.configure({ entities: () => entities, types: () => [] })] : [])],
    });
    loadMarkdown(editor, markdown);
    editor.commands.focus("end");
    return editor;
  }

  it("spells the index's names as the @ menu has them, and makes a paragraph or a line when told", () => {
    open("Fog.\n");
    settleHeard(editor, "Thomas came.");
    expect(getMarkdown(editor)).toBe("Fog. Tomas came.\n");
    settleHeard(editor, "New paragraph.");
    settleHeard(editor, "then rain.");
    expect(getMarkdown(editor)).toBe("Fog. Tomas came.\n\nThen rain.\n");
    settleHeard(editor, "New line.");
    settleHeard(editor, "Wind.");
    expect(getMarkdown(editor)).toBe("Fog. Tomas came.\n\nThen rain.\\\nWind.\n");
    // Each is its own undo step.
    editor.commands.undo();
    editor.commands.undo();
    expect(getMarkdown(editor)).toBe("Fog. Tomas came.\n\nThen rain.\n");
    editor.commands.undo();
    editor.commands.undo();
    expect(getMarkdown(editor)).toBe("Fog. Tomas came.\n");
  });

  it("without an index, writes what was heard", () => {
    open("Fog.\n", false);
    settleHeard(editor, "Thomas came.");
    expect(getMarkdown(editor)).toBe("Fog. Thomas came.\n");
  });
});
