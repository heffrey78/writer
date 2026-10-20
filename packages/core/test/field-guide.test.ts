import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { backlinks, compileBook, entriesOf, loadBook, notesOfScene, pieceSections, registerKind, sceneFacts, schemaFor, sectionsAt, validate, vocabulary, withModules, type Book } from "../src/index.ts";
import { nodeSource } from "../src/node.ts";
import { fieldGuide } from "./kinds.ts";

/**
 * A kind that isn't a novel proves the base (#35): a field guide of regions, habitats and families of
 * species, with an atlas of observers and sites and a field of its own, and no modules. Its sample
 * book loads, validates and compiles with nothing in the base written for it.
 */

const SAMPLE = fileURLToPath(new URL("../../../examples/sample-field-guide", import.meta.url));
let book: Book;

beforeAll(async () => {
  registerKind(fieldGuide);
  book = await loadBook(nodeSource(SAMPLE));
});

describe("a field guide", () => {
  it("is read as its kind, from book.yaml, with no modules", () => {
    expect(book.kind.key).toBe("field-guide");
    expect(withModules(fieldGuide)).toBe(fieldGuide);
    expect(book.kind.fields.map((f) => f.key)).toEqual(["seen_at"]);
    expect(book.moduleRecords).toEqual([]);
  });

  it("loads its three levels from its own folders, each section before what it holds", () => {
    expect(book.levels).toEqual(["region", "habitat", "family"]);
    expect(book.sections.map((s) => [s.level, s.title])).toEqual([
      ["region", "The Estuary"],
      ["habitat", "Mudflats"],
      ["family", "Waders"],
      ["habitat", "Reedbeds"],
      ["family", "Warblers"],
    ]);
    expect(sectionsAt(book, "habitat").map((s) => s.title)).toEqual(["Mudflats", "Reedbeds"]);
    expect(pieceSections(book).map((s) => s.childIds)).toEqual([["spc_c0r1ew", "spc_redsh4"], ["spc_sedge9"]]);
    expect(book.pieces.map((p) => [p.title, p.status, p.file])).toEqual([
      ["Curlew", "described", "guide/01-the-estuary/01-mudflats/01-waders/01-curlew.md"],
      ["Redshank", "sketched", "guide/01-the-estuary/01-mudflats/01-waders/02-redshank.md"],
      ["Sedge Warbler", "checked", "guide/01-the-estuary/02-reedbeds/01-warblers/01-sedge-warbler.md"],
    ]);
  });

  it("reads its own field, its atlas, its relationships and its notes", () => {
    expect(entriesOf(book, book.pieces[1]!, "site")).toEqual(["site_n0rth5", "site_s1v1ce"]);
    expect(book.entities.map((e) => [e.type, e.name, e.file])).toEqual([
      ["observer", "Mira Hale", "atlas/observers/mira.md"],
      ["site", "The North Spit", "atlas/sites/north-spit.md"],
      ["site", "The Old Sluice", "atlas/sites/old-sluice.md"],
    ]);
    expect(backlinks(book, "site_s1v1ce").scenes.map((s) => [s.scene.title, s.via])).toEqual([["Redshank", ["seen_at"]], ["Sedge Warbler", ["seen_at", "mention"]]]);
    expect(book.relationships.map((r) => [r.from, r.type, r.to])).toEqual([["obs_m1ra00", "watches", "site_n0rth5"]]);
    expect(notesOfScene(book, "spc_sedge9").map((n) => n.title)).toEqual(["A hide at the sluice?"]);
  });

  it("validates clean: its prefixes, its field's entries, and notes and relationships on its own pieces", async () => {
    expect((await validate(nodeSource(SAMPLE))).diagnostics).toEqual([]);
    expect(schemaFor("family", book.kind)).toMatchObject({ title: "_family.yaml", required: ["id", "species"] });
    expect(Object.keys((schemaFor("scene", book.kind) as { properties: object }).properties)).toEqual(["id", "title", "synopsis", "status", "seen_at", "tags"]);
  });

  it("says its own words, the facts of a piece too", () => {
    // Its people are its observers, by what the type is: Mira is first seen in the first species.
    expect(sceneFacts(book, "spc_c0r1ew")).toEqual(["The book's first species.", "First appearance of Mira Hale."]);
    expect(sceneFacts(book, "spc_sedge9")).toEqual(["The book's last species."]);
    const w = vocabulary(book.kind);
    expect([w.book.one, w.piece.count(3), w.level("family").count(2), w.content.One, w.codex.a, w.entity.many]).toEqual(["field guide", "3 species", "2 families", "Guide", "an atlas", "landmarks"]);
  });

  it("compiles, its families as the book's chapters", async () => {
    const compiled = await compileBook(book, nodeSource(SAMPLE));
    expect(compiled.title).toBe("Birds of the Varn Estuary");
    expect(compiled.chapters.map((c) => c.id)).toEqual(["fam_wader5", "fam_warb1e"]);
    expect(compiled.words).toBeGreaterThan(40);
  });
});
