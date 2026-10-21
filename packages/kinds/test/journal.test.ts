import { fileURLToPath } from "node:url";
import { compileBook, entriesOf, kindByKey, layoutOf, loadBook, memorySource, PLAIN_LAYOUT, reservedPrefixes, schemaFor, validate, validateBook, vocabulary, withModules } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { storyTimeline } from "@writer/module-story-time/core";
import { describe, expect, it } from "vitest";
import { journal } from "../src/index.ts";

/** The Journal kind (#36): years and months of entries, an index of people, places, events and values, in a journal's words. */

const SAMPLE = fileURLToPath(new URL("../../../examples/sample-journal", import.meta.url));

describe("the Journal kind", () => {
  it("is registered with presence, story time and daily writing, and none of the Novel's story-only modules", () => {
    const kind = kindByKey("journal");
    expect(kind).toBe(withModules(journal));
    expect(kind.modules).toEqual(["presence", "story-time", "daily"]);
    expect(kind.fields.map((f) => f.key)).toEqual(["when", "people", "places", "events", "entities", "values"]);
    expect(layoutOf(kind)).toBe(PLAIN_LAYOUT);
  });

  it("says a journal's words", () => {
    const w = vocabulary(kindByKey("journal"));
    expect([w.book.One, w.piece.count(3), w.piece.a, w.level("month").Many, w.codex.One, w.entity.count(2), w.content.one]).toEqual(["Journal", "3 entries", "an entry", "Months", "Index", "2 items", "journal"]);
  });

  it("has a prefix of its own for the book, each level, the entry and each type, and keeps the Novel's as former ones", () => {
    const own = [journal.prefix, ...journal.levels.map((l) => l.prefix), journal.piece.prefix, ...journal.entityTypes.map((t) => t.prefix)];
    expect(new Set(own).size).toBe(own.length);
    const reserved = reservedPrefixes(kindByKey("journal"));
    for (const p of ["nv", "pt", "ch", "sc", "char", "loc", "theme"]) expect(reserved.has(p), p).toBe(true);
  });

  it("reads the sample journal: years, months and dated entries, clean", async () => {
    const r = await validate(nodeSource(SAMPLE));
    expect(r.diagnostics).toEqual([]);
    const book = r.novel;
    expect(book.kind.key).toBe("journal");
    expect(book.sections.map((s) => [s.level, s.title])).toEqual([["year", "2026"], ["month", "September"], ["month", "October"]]);
    expect(book.pieces.map((p) => p.title)).toEqual(["Monday, 28 September", "Wednesday, 30 September", "Thursday, 1 October", "Saturday, 3 October", "Sunday, 4 October"]);
    expect(entriesOf(book, book.pieces[2]!, "person")).toEqual(["per_m1ra00", "per_t0ma50"]);
    // Its entries in the order they happened: the calendar's.
    expect(storyTimeline(book).items.map((i) => (i.kind === "scene" ? i.scene.id : ""))).toEqual(book.pieces.map((p) => p.id));
    expect(schemaFor("month", book.kind)).toMatchObject({ title: "_month.yaml", required: ["id", "title", "entries"] });
  });

  it("compiles plainly: its months headed by their names, its year by its own", async () => {
    const book = await loadBook(nodeSource(SAMPLE));
    const compiled = await compileBook(book, nodeSource(SAMPLE));
    expect(compiled.chapters.map((c) => [c.heading, c.part?.heading])).toEqual([["September", "2026"], ["October", undefined]]);
    expect(compiled.end).toBeUndefined();
  });

  it("keeps the IDs a journal kept as a novel had: the Novel's prefixes are valid, and only where they were", async () => {
    const lines = (...l: string[]) => `${l.join("\n")}\n`;
    const files = (person: string) => ({
      "book.yaml": lines("schema_version: 3", "kind: journal", "id: nv_v072b0", "title: Journal"),
      "entries/_order.yaml": lines("months: [ch_gtzqan]"),
      "entries/01-october-2026/_month.yaml": lines("id: ch_gtzqan", "title: October 2026", "entries: [sc_c3t5s7]"),
      "entries/01-october-2026/01-tuesday.md": lines("---", "id: sc_c3t5s7", "title: Tuesday, 10/20/2026", `people: [${person}]`, "---", `[Alex](#${person}) caught me.`),
      [`index/people/alex.md`]: lines("---", `id: ${person}`, "name: Alex", "---"),
    });
    const converted = await loadBook(memorySource(files("char_7gsd69")));
    expect([...converted.diagnostics, ...validateBook(converted)]).toEqual([]);
    // A former prefix of another type isn't this one's.
    const wrong = await loadBook(memorySource(files("loc_7gsd69")));
    expect(validateBook(wrong).map((d) => d.code)).toEqual(["E_ID_PREFIX"]);
  });
});
