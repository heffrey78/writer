import { describe, expect, it } from "vitest";
import { novel } from "@writer/kinds";
import { checkSchema, entryIds, itemText, loadBook, memorySource, schemaFor, validateBook, withModules } from "../src/index.ts";
import { diary, lines } from "./kinds.ts";

/** Declared fields (#25): a kind's fields are its pieces' front matter, checked and read from the declarations. */

const DAY = (front: string[]) => lines("---", "id: day_000001", "title: Monday", ...front, "---", "Words.");
const book = (front: string[]) =>
  loadBook(
    memorySource({
      "novel.yaml": lines("schema_version: 2", "id: dia_000001", "title: Test"),
      "pages/_order.yaml": lines("months: [mon_000001]"),
      "pages/01-march/_month.yaml": lines("id: mon_000001", "days: [day_000001]"),
      "pages/01-march/01-monday.md": DAY(front),
      "index/characters/ada.md": lines("---", "id: char_000001", "name: Ada", "---"),
      "index/locations/varn.md": lines("---", "id: loc_000001", "name: Varn", "---"),
    }),
    diary,
  );

describe("a kind's own field", () => {
  it("is in its pieces' schema, and the novel's fields aren't", () => {
    expect(Object.keys((schemaFor("scene", diary) as { properties: object }).properties)).toEqual(["id", "title", "synopsis", "status", "people", "tags"]);
    expect(checkSchema("scene", { id: "day_000001", title: "x", characters: ["char_000001"] }, undefined, diary).map((d) => [d.code, d.pointer])).toEqual([["W_UNKNOWN_KEY", "/characters"]]);
  });

  it("is read into the piece's fields, and its entries checked against the field's type", async () => {
    const ok = await book(["people: [char_000001]"]);
    expect(ok.pieces[0]!.fields).toEqual({ people: ["char_000001"] });
    expect(validateBook(ok)).toEqual([]);
    const wrong = await book(["people: [loc_000001, char_00000z]"]);
    expect(validateBook(wrong).map((d) => [d.code, d.pointer])).toEqual([
      ["E_REF_TYPE", "/people/0"],
      ["E_DANGLING_REF", "/people/1"],
    ]);
  });
});

describe("reading a field's value", () => {
  const field = (key: string) => withModules(novel).fields.find((f) => f.key === key)!;

  it("finds the entry IDs in one entry's field and in a list of plain IDs or items", () => {
    expect(entryIds(field("pov"), "char_000001")).toEqual(["char_000001"]);
    expect(entryIds(field("pov"), undefined)).toEqual([]);
    expect(entryIds(field("plotlines"), ["plot_000001", { id: "plot_000002", weight: "minor" }, { weight: "minor" }, 7])).toEqual(["plot_000001", "plot_000002"]);
    expect(entryIds(field("when"), { at: "2024-03-01" })).toEqual([]);
  });

  it("reads what an item carries after its name, defaults included, leaving out what isn't for the card", () => {
    expect(itemText(field("plotlines"), "plot_000001")).toBe(" (major)");
    expect(itemText(field("plotlines"), { id: "plot_000001", weight: "minor", beat: "First crack" })).toBe(" (minor) “First crack”");
    expect(itemText(field("themes"), { id: "theme_000001", strength: 1, note: "Not on the card" })).toBe(" (faint)");
    expect(itemText(field("themes"), "theme_000001")).toBe("");
    expect(itemText(field("pov"), "char_000001")).toBe("");
  });
});
