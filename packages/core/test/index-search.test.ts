import fc from "fast-check";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { journal, novel as novelKind } from "@writer/kinds";
import { defaultEntrySort, entryPresences, filterEntries, loadBook, matchEntry, piecesInSection, piecesMatching, searchable, searchEntries, sortEntries, type Entity } from "../src/index.ts";
import { nodeSource } from "../src/node.ts";

const novel = await loadBook(nodeSource(fileURLToPath(new URL("../../../examples/sample-novel/", import.meta.url))));
const presences = entryPresences(novel);
const names = (es: { name: string }[]) => es.map((e) => e.name);
const found = (query: string) => searchEntries(novel, query).map((m) => [m.entity.name, m.where] as const);

describe("searchEntries", () => {
  it("finds an entry by anything it says, saying where", () => {
    expect(found("grey")).toEqual([["Ada Varn", "field"]]);
    expect(found("protagonist")).toEqual([["Ada Varn", "tag"]]);
    expect(found("M. K.")).toEqual([["Mirela Kost", "alias"]]);
    expect(found("iron")).toEqual([["The Varn Bridge", "summary"]]);
    expect(found("toll")).toEqual([["Ben Varn", "field"]]);
    // An entry's notes are the book's notes about it (D20): not searched as the entry.
    expect(matchEntry({ ...entity("Ada"), body: "Sentimental about iron." }, "iron")).toBeUndefined();
  });

  it("ignores case and accents", () => {
    for (const q of ["Mirela", "mirela", "MIRÉLA", "Mirèla"]) expect(found(q)[0]).toEqual(["Mirela Kost", "name"]);
  });

  it("finds a name typed in capitals that are longer than its letters, and a final sigma", () => {
    // Found by the property below: "ᾀ" in capitals is "ἈΙ".
    const greek = entity("A", ["ᾀ"]);
    expect(matchEntry(greek, "ἈΙ")).toMatchObject({ where: "alias" });
    expect(matchEntry(entity("Straße"), "STRASSE")).toMatchObject({ where: "name" });
    expect(matchEntry(entity("Οδός"), "ΟΔΟΣ")).toMatchObject({ where: "name" });
    const { text, at } = matchEntry({ ...entity("Zz"), summary: "Lives on Hauptstraße by the river." }, "strasse")!;
    expect(text!.slice(...at!)).toBe("straße");
  });

  it("needs every word somewhere in the entry, and says the best part holding the first", () => {
    expect(found("bridge engineer").map(([n]) => n)).toContain("Ada Varn");
    expect(found("engineer grey")).toEqual([["Ada Varn", "summary"]]);
    expect(found("grey toll")).toEqual([]);
  });

  it("shows a field as its name and value, and a few words of long text around the match", () => {
    const [eyes] = searchEntries(novel, "grey");
    expect(eyes).toMatchObject({ text: "eyes: grey", at: [6, 10] });
    const long = { ...entity("Ada"), summary: "Left Varn at nineteen for the polytechnic and never quite came back; precise, unsentimental out loud, and sentimental about iron, as her father was before her." };
    const iron = matchEntry(long, "iron")!;
    expect(iron.text!.slice(...iron.at!)).toBe("iron");
    expect(iron.text).toMatch(/^…/);
    expect(iron.text!.split(/\s+/).length).toBeLessThanOrEqual(19);
  });

  it("matches every entry for an empty search", () => {
    expect(searchEntries(novel, "   ")).toHaveLength(novel.entities.length);
  });

  const entity = (name: string, aliases: string[] = []): Entity => ({ id: "char_x", type: "character", name, aliases, fields: {}, tags: [], body: "", bodyLine: 1, file: "x.md" });
  const word = fc.stringMatching(/^[\p{L}][\p{L}' -]{0,15}$/u).filter((s) => s.trim().length > 0);

  it("always finds an entry by its own name and each other name, in any case", () => {
    fc.assert(
      fc.property(word, fc.array(word, { maxLength: 3 }), fc.boolean(), (name, aliases, upper) => {
        const e = entity(name, aliases);
        for (const n of [name, ...aliases]) expect(matchEntry(e, upper ? n.toUpperCase() : n.toLowerCase())).toBeDefined();
      }),
    );
  });

  it("marks exactly the matched words in what it shows, accents and all", () => {
    fc.assert(
      fc.property(word, fc.string({ maxLength: 40 }), fc.string({ maxLength: 40 }), (term, before, after) => {
        const summary = `${before} ${term} ${after}`;
        const e = { ...entity("Zz"), summary };
        const m = matchEntry(e, term.trim().split(/\s+/)[0]!);
        expect(m).toBeDefined();
        if (m!.where === "summary") expect(searchable(m!.text!.slice(...m!.at!))).toBe(searchable(term.trim().split(/\s+/)[0]!));
      }),
    );
  });
});

describe("filterEntries", () => {
  const all = novel.entities;

  it("narrows by type, tag and a field's value", () => {
    expect(names(filterEntries(novel, all, { types: ["character"], tags: ["POV"] }, presences)).sort()).toEqual(["Ada Varn", "Ben Varn"]);
    expect(names(filterEntries(novel, all, { field: { key: "occupation", value: "toll keeper " } }, presences))).toEqual(["Ben Varn"]);
  });

  it("narrows to the entries in a section's pieces, at any depth", () => {
    const part = "pt_5a1e00";
    const ids = new Set(piecesInSection(novel, part).map((p) => p.id));
    expect(ids.size).toBeGreaterThan(0);
    const expected = all.filter((e) => presences.get(e.id)?.scenes.some((s) => s.mark !== "absent" && ids.has(s.scene.id)));
    expect(filterEntries(novel, all, { in: part }, presences)).toEqual(expected);
    // A part holds its chapters' pieces.
    const chapters = novel.sections.filter((s) => s.parentId === part).flatMap((c) => piecesInSection(novel, c.id).map((p) => p.id));
    expect([...ids].sort()).toEqual(chapters.sort());
  });

  it("narrows to the entries a piece's field names, such as a point of view", () => {
    expect(names(filterEntries(novel, all, { role: "pov" }, presences))).toEqual(["Ada Varn", "Ben Varn"]);
    const inDebts = filterEntries(novel, all, { role: "pov", in: "ch_01dde6" }, presences);
    for (const e of inDebts) expect(piecesInSection(novel, "ch_01dde6").some((p) => p.fields.pov === e.id)).toBe(true);
  });

  it("finds the entries not in the book yet", () => {
    const unused: Entity = { id: "char_n0ne00", type: "character", name: "Nobody", aliases: [], fields: {}, tags: [], body: "", bodyLine: 1, file: "bible/characters/nobody.md" };
    const book = { ...novel, entities: [...novel.entities, unused] };
    const withIt = entryPresences(book);
    expect(names(filterEntries(book, book.entities, { absent: true }, withIt))).toEqual(["Nobody"]);
    expect(filterEntries(novel, all, { absent: true }, presences)).toEqual([]);
  });
});

describe("sortEntries", () => {
  const characters = novel.entities.filter((e) => e.type === "character");

  it("sorts by name, by most pieces, and by first and last appearance", () => {
    expect(names(sortEntries(novel, characters, "name", presences))).toEqual(["Ada Varn", "Ben Varn", "Mirela Kost", "Tomas Hale"]);
    const most = sortEntries(novel, characters, "most", presences).map((e) => presences.get(e.id)!.count);
    expect(most).toEqual([...most].sort((a, b) => b - a));
    const position = (id: string | undefined) => novel.pieces.findIndex((p) => p.id === id);
    const firsts = sortEntries(novel, novel.entities, "first", presences).map((e) => position(presences.get(e.id)?.first?.id));
    expect(firsts).toEqual([...firsts].sort((a, b) => a - b));
    const lasts = sortEntries(novel, novel.entities, "last", presences).map((e) => position(presences.get(e.id)?.last?.id));
    expect(lasts).toEqual([...lasts].sort((a, b) => b - a));
  });

  it("puts entries not in the book yet last, whichever end it sorts by", () => {
    const unused: Entity = { id: "char_n0ne00", type: "character", name: "Aaron", aliases: [], fields: {}, tags: [], body: "", bodyLine: 1, file: "bible/characters/aaron.md" };
    const book = { ...novel, entities: [...novel.entities, unused] };
    const p = entryPresences(book);
    for (const sort of ["first", "last"] as const) expect(sortEntries(book, book.entities, sort, p).at(-1)!.name).toBe("Aaron");
  });

  it("sorts a journal's people by when they were last written about until the writer picks a sort", () => {
    expect(defaultEntrySort(journal)).toBe("last");
    expect(defaultEntrySort(novelKind)).toBe("first");
  });
});

describe("piecesMatching", () => {
  it("finds the pieces whose words have every word of a search, ignoring case, accents and Markdown", () => {
    expect(piecesMatching(novel, "STITCHES wound").map((p) => p.title)).toEqual(["The Station"]);
    // A mention's words count, its target doesn't.
    expect(piecesMatching(novel, "char_7f3k2q")).toEqual([]);
    expect(piecesMatching(novel, "  ")).toEqual([]);
  });
});
