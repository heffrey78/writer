import { carryingField, kindByKey, loadBook, memorySource, validateBook, withModules, type BookKind } from "@writer/core";
import { gridKey, presence } from "@writer/core/diagrams";
import { novel } from "@writer/kinds";
import { describe, expect, it } from "vitest";

/** Point of view as a module (#27): the Novel's as before, and a kind without it has none anywhere. */

const lines = (...l: string[]) => `${l.join("\n")}\n`;
const scene = (id: string, ...front: string[]) => lines("---", `id: ${id}`, `title: ${id}`, ...front, "---", "Words.");
const entry = (id: string, name: string) => lines("---", `id: ${id}`, `name: ${name}`, "---");
const book = (kind: BookKind) =>
  loadBook(
    memorySource({
      "novel.yaml": lines("schema_version: 2", "id: nv_000001", "title: Test"),
      "manuscript/_order.yaml": lines("chapters: [ch_000001]"),
      "manuscript/01-one/_chapter.yaml": lines("id: ch_000001", "scenes: [sc_000001, sc_000002]"),
      "manuscript/01-one/01.md": scene("sc_000001", "pov: char_000001", "characters: [char_000002]", "when: { day: 1 }"),
      "manuscript/01-one/02.md": scene("sc_000002", "characters: [char_000001]", "when: { day: 2 }"),
      "bible/characters/ada.md": entry("char_000001", "Ada"),
      "bible/characters/bo.md": entry("char_000002", "Bo"),
    }),
    kind,
  );

/** The Novel without the module: everything else of it as it is. */
const plain: BookKind = { ...novel, key: "plain", modules: [] };

describe("point of view", () => {
  it("is the Novel's: first on the card, carrying the scene, checked against its characters", async () => {
    const kind = kindByKey("novel");
    expect(kind.fields[0]).toMatchObject({ key: "pov", carries: true });
    expect(carryingField(kind)?.label).toBe("Point of view");
    const b = await book(kind);
    expect(validateBook(b).filter((d) => d.code === "W_POV_NOT_PRESENT").map((d) => d.file)).toEqual(["manuscript/01-one/01.md"]);
    expect(presence(b, "character").marks.get(gridKey("char_000001", "sc_000001"))).toMatchObject({ listed: true, carries: true });
  });

  it("is nowhere in a kind without the module: no field, no check, no carrier, no lanes by it", async () => {
    const kind = withModules(plain);
    expect(kind.fields.map((f) => f.key)).not.toContain("pov");
    expect(carryingField(kind)).toBeUndefined();
    const b = await book(plain);
    expect(b.pieces[0]!.fields).not.toHaveProperty("pov");
    const codes = validateBook(b).map((d) => d.code);
    expect(codes).not.toContain("W_POV_NOT_PRESENT");
    expect(presence(b, "character").marks.get(gridKey("char_000001", "sc_000001"))).toBeUndefined();
  });
});
