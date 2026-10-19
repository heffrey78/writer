import { describe, expect, it } from "vitest";
import { defineModule, kindByKey, loadBook, memorySource, registerKind, registerModule, schemaFor, validateBook, withModules, type BookKind } from "../src/index.ts";
import { diary, lines } from "./kinds.ts";

/** Modules (D14, #26): a module's fields and checks reach a book through the kind that lists it. */

/** A fixture module: who a day was spent with, and a warning for a day spent alone. */
const company = defineModule({
  id: "company",
  label: "Company",
  fields: [{ key: "with", label: "With", type: { kind: "entities", entityType: "character" }, mentionAdds: true }],
  checks: [
    {
      code: "W_ALONE",
      severity: "warning",
      find: (book) => book.pieces.filter((p) => !Array.isArray(p.fields["with"]) || !p.fields["with"].length).map((p) => ({ file: p.file, message: `${p.title} was spent alone` })),
    },
  ],
});
registerModule(company);

const sociable: BookKind = { ...diary, key: "sociable", label: "Sociable diary", modules: ["company"] };

const DAY = (id: string, title: string, ...front: string[]) => lines("---", `id: ${id}`, `title: ${title}`, ...front, "---", "Words.");
const book = (kind: BookKind) =>
  loadBook(
    memorySource({
      "novel.yaml": lines("schema_version: 2", "id: dia_000001", "title: Test"),
      "pages/_order.yaml": lines("months: [mon_000001]"),
      "pages/01-march/_month.yaml": lines("id: mon_000001", "days: [day_000001, day_000002]"),
      "pages/01-march/01-monday.md": DAY("day_000001", "Monday", "people: [char_000001]", "with: [char_000001, loc_000001]"),
      "pages/01-march/02-tuesday.md": DAY("day_000002", "Tuesday"),
      "index/characters/ada.md": lines("---", "id: char_000001", "name: Ada", "---"),
      "index/locations/varn.md": lines("---", "id: loc_000001", "name: Varn", "---"),
    }),
    kind,
  );

describe("a module", () => {
  it("adds its fields after the kind's own, to the pieces' schema and their values", async () => {
    expect(withModules(sociable).fields.map((f) => f.key)).toEqual(["people", "with"]);
    expect(Object.keys((schemaFor("scene", withModules(sociable)) as { properties: object }).properties)).toEqual(["id", "title", "synopsis", "status", "people", "with", "tags"]);
    const b = await book(sociable);
    expect(b.pieces[0]!.fields).toEqual({ people: ["char_000001"], with: ["char_000001", "loc_000001"] });
  });

  it("has its field's entries checked against the field's type, and its own checks run", async () => {
    expect(validateBook(await book(sociable)).map((d) => [d.severity, d.code, d.file, d.pointer ?? d.message])).toEqual([
      ["error", "E_REF_TYPE", "pages/01-march/01-monday.md", "/with/1"],
      ["warning", "W_ALONE", "pages/01-march/02-tuesday.md", "Tuesday was spent alone"],
    ]);
  });

  it("adds nothing to a kind that doesn't list it", async () => {
    expect(withModules(diary)).toBe(diary);
    const b = await book(diary);
    expect(b.pieces[0]!.fields).toEqual({ people: ["char_000001"] });
    expect(validateBook(b).map((d) => d.code)).toEqual([]);
  });

  it("is in a registered kind, which is complete however often it's asked for", () => {
    registerKind(sociable);
    const known = kindByKey("sociable");
    expect(known.fields.map((f) => f.key)).toEqual(["people", "with"]);
    expect(withModules(known)).toBe(known);
    expect(withModules(sociable)).toBe(known);
  });

  it("must be registered before a kind that lists it, and can't declare a field the kind has", () => {
    expect(() => registerKind({ ...diary, key: "lonely", modules: ["nowhere"] })).toThrow("The Diary kind uses the module “nowhere”, which isn't registered");
    registerModule(defineModule({ id: "people-too", label: "People", fields: [{ key: "people", label: "People", type: { kind: "entities", entityType: "character" } }] }));
    expect(() => withModules({ ...diary, modules: ["people-too"] })).toThrow("The module “people-too” declares the field “people”, which the Diary kind or another of its modules already has");
  });
});
