import { describe, expect, it } from "vitest";
import { backlinks, defineModule, kindByKey, loadBook, memorySource, mentionsOf, registerKind, registerModule, reservedPrefixes, schemaFor, validateBook, withModules, type BookKind } from "../src/index.ts";
import { compareNovels } from "../src/compare.ts";
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

/** A fixture module's records (#33): clues, each a file in the index's clues/, naming who it points at. */
const clues = defineModule({
  id: "clues",
  label: "Clues",
  records: [
    {
      key: "clue",
      prefix: "clue",
      folder: "clues",
      noun: { label: "Clue", plural: "Clues" },
      group: "Clues",
      aside: "found",
      fields: () => [{ key: "points", label: "Points at", type: { kind: "entities", entityType: "character" } }],
      pieceLinks: ["found"],
      mentionable: true,
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://github.com/heffrey78/gh-writer/schemas/v1/clue.schema.json",
        type: "object",
        properties: { id: { $ref: "common.schema.json#/$defs/id" }, title: { $ref: "common.schema.json#/$defs/nonEmptyText" }, points: { $ref: "common.schema.json#/$defs/idList" }, found: { $ref: "common.schema.json#/$defs/id" } },
        required: ["id", "title"],
        additionalProperties: false,
      },
    },
  ],
});
registerModule(clues);
const sleuthing: BookKind = { ...diary, key: "sleuthing", label: "Casebook", modules: ["clues"] };

const casebook = (clue: string, kind: BookKind = sleuthing) =>
  loadBook(
    memorySource({
      "novel.yaml": lines("schema_version: 2", "id: dia_000001", "title: Test"),
      "pages/_order.yaml": lines("months: [mon_000001]"),
      "pages/01-march/_month.yaml": lines("id: mon_000001", "days: [day_000001]"),
      "pages/01-march/01-monday.md": DAY("day_000001", "Monday").replace("Words.", "We found [the glove](#clue_000001)."),
      "index/characters/ada.md": lines("---", "id: char_000001", "name: Ada", "---"),
      "index/clues/glove.md": clue,
    }),
    kind,
  );
const GLOVE = lines("---", "id: clue_000001", "title: The glove", "points: [char_000001]", "found: day_000001", "---", "Left on [Ada](#char_000001)'s step.");

describe("a module's records", () => {
  it("are loaded from their folder, mentioned, and named among what refers to an entry", async () => {
    const b = await casebook(GLOVE);
    expect(b.moduleRecords).toEqual([
      { type: "clue", id: "clue_000001", title: "The glove", fields: { points: ["char_000001"], found: "day_000001" }, body: "Left on [Ada](#char_000001)'s step.\n", bodyLine: 7, file: "index/clues/glove.md" },
    ]);
    expect([...b.diagnostics, ...validateBook(b)]).toEqual([]);
    expect(backlinks(b, "char_000001").records.map((r) => r.id)).toEqual(["clue_000001"]);
    expect(mentionsOf(b, "clue_000001").map((m) => m.id)).toEqual(["day_000001"]);
    expect(reservedPrefixes(withModules(sleuthing)).has("clue")).toBe(true);
  });

  it("have their fields, links, prefix and mentions checked as the base's records are", async () => {
    const b = await casebook(lines("---", "id: char_000009", "title: The glove", "points: [mon_000001]", "found: char_000001", "---", "See [no one](#char_zzzzzz)."));
    expect(validateBook(b).map((d) => [d.code, d.file, d.pointer ?? d.line ?? ""])).toEqual([
      ["E_ID_PREFIX", "index/clues/glove.md", ""],
      // The day's mention of the clue: it has another ID now.
      ["E_DANGLING_REF", "pages/01-march/01-monday.md", 5],
      ["E_REF_TYPE", "index/clues/glove.md", "/points/0"],
      ["E_REF_TYPE", "index/clues/glove.md", "/found"],
      ["E_DANGLING_REF", "index/clues/glove.md", 7],
    ]);
  });

  it("are compared by their fields, and keep their folder from the book's own types", async () => {
    const before = await casebook(GLOVE);
    const after = await casebook(GLOVE.replace("points: [char_000001]", "points: []").replace("The glove", "The red glove"));
    expect(compareNovels(before, after).records).toEqual([
      { type: "clue", id: "clue_000001", title: "The red glove", status: "changed", fields: [{ label: "Title", before: "The glove", after: "The red glove" }, { label: "Points at", before: "Ada" }] },
    ]);
    expect(() => withModules({ ...sleuthing, key: "clash", entityTypes: [...sleuthing.entityTypes, { key: "clue", prefix: "cl", folder: "clues", label: "Clue", builtin: true }] })).toThrow(/keeps the record type “clue”/);
  });

  it("are nothing to a kind that doesn't list the module", async () => {
    const b = await casebook(GLOVE, diary);
    expect(b.moduleRecords).toEqual([]);
    expect([...b.diagnostics, ...validateBook(b)].map((d) => d.code).sort()).toEqual(["E_DANGLING_REF", "E_UNKNOWN_FOLDER"]);
  });

  it("may need another module, which a kind that lists them must list too", () => {
    registerModule(defineModule({ id: "deductions", label: "Deductions", needs: ["clues"] }));
    expect(() => withModules({ ...diary, key: "hasty", modules: ["deductions"] })).toThrow("The Diary kind uses the module “deductions”, which needs “clues”: list it too");
    expect(withModules({ ...diary, key: "careful", modules: ["clues", "deductions"] }).modules).toEqual(["clues", "deductions"]);
  });
});
