import { novel } from "@writer/kinds";
import { describe, expect, it } from "vitest";
import { vocabulary, word } from "../src/index.ts";
import { diary } from "./kinds.ts";

/** The words on screen (#22): each kind's own, in the forms sentences need. */

describe("a kind's words", () => {
  it("are the novel's as the app has always said them", () => {
    const w = vocabulary(novel);
    expect([w.book.one, w.piece.one, w.level("part").one, w.level("chapter").one, w.content.One, w.codex.One, w.entity.one]).toEqual(["novel", "scene", "part", "chapter", "Manuscript", "Story bible", "entry"]);
    expect([w.piece.Many, w.level("chapter").many, w.codex.one, w.entity.many]).toEqual(["Scenes", "chapters", "story bible", "entries"]);
    expect([w.piece.a, w.entity.a, w.book.a]).toEqual(["a scene", "an entry", "a novel"]);
    expect([w.piece.count(1), w.piece.count(3), w.level("chapter").count(0)]).toEqual(["1 scene", "3 scenes", "0 chapters"]);
    expect([w.of("scene").one, w.of("part").One]).toEqual(["scene", "Part"]);
    expect([w.codex.short, w.piece.short]).toEqual(["bible", "scene"]);
  });

  it("are another kind's own, with nothing of the novel's", () => {
    const w = vocabulary(diary);
    expect([w.book.one, w.level("month").one, w.piece.one, w.content.One, w.codex.a, w.entity.many]).toEqual(["diary", "month", "day", "Pages", "an index", "items"]);
  });

  it("keep an acronym as it is, and say the article the kind gives", () => {
    expect(word({ label: "NPC", plural: "NPCs", article: "an" })).toMatchObject({ one: "NPC", many: "NPCs", a: "an NPC" });
    expect(word({ label: "Unit", plural: "Units", article: "a" }).a).toBe("a unit");
    expect(word({ label: "Hour", plural: "Hours", article: "an" }).a).toBe("an hour");
  });
});
