import { fileURLToPath } from "node:url";
import { compileBook, kindByKey, loadBook, type Entity } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { describe, expect, it } from "vitest";
import { bibliographyEntry, shortCitation, sourceDetails, surname } from "../src/core/index.ts";

/** Citations (#59): a source's short form in the notes, its line in the bibliography, and the bibliography a compile ends with. */

const SAMPLE = fileURLToPath(new URL("../../../../examples/sample-nonfiction", import.meta.url));
const source = (fields: Entity["fields"], name = "The Formation of Vegetable Mould", aliases: string[] = []): Entity => ({ id: "src_d4rw1n", type: "source", name, aliases, fields, tags: [], body: "", bodyLine: 0, file: "" });

describe("a source", () => {
  it("has its details from its fields, in any case", () => {
    expect(sourceDetails(source({ Author: "Charles Darwin", YEAR: 1881, publisher: " John Murray " }, "Vegetable Mould", ["VM"]))).toEqual({ title: "Vegetable Mould", shortTitle: "VM", author: "Charles Darwin", year: "1881", publisher: "John Murray" });
  });

  it("is cited in the notes by its author's surname and short title, or its short title alone", () => {
    expect(shortCitation(source({ author: "Charles Darwin" }, "The Formation of Vegetable Mould", ["Vegetable Mould"]))).toBe("Darwin, Vegetable Mould");
    expect(shortCitation(source({ author: "Darwin, Charles" }))).toBe("Darwin, The Formation of Vegetable Mould");
    expect(shortCitation(source({}))).toBe("The Formation of Vegetable Mould");
    expect(surname("Charles Darwin and Alfred Russel Wallace")).toBe("Darwin and Wallace");
  });

  it("has a line in the bibliography: authors inverted, title in italics, imprint, address; what's missing left out", () => {
    expect(bibliographyEntry(source({ author: "Charles Darwin", year: 1881, publisher: "John Murray", place: "London" }))).toEqual([
      { text: "Darwin, Charles. " },
      { text: "The Formation of Vegetable Mould.", em: true },
      { text: " London: John Murray, 1881." },
    ]);
    expect(bibliographyEntry(source({ author: "Ada Varn and Ben Varn & Tomas", url: "https://example.com/x" }, "Bridges?"))).toEqual([
      { text: "Varn, Ada, Ben Varn, and Tomas. " },
      { text: "Bridges?", em: true },
      { text: " https://example.com/x." },
    ]);
    expect(bibliographyEntry(source({ year: 1789 }, "Selborne"))).toEqual([{ text: "Selborne.", em: true }, { text: " 1789." }]);
  });
});

describe("compiling with citations", () => {
  it("reads a source cited by its name or alias as its short form in the notes, and ends with a bibliography", async () => {
    const book = await loadBook(nodeSource(SAMPLE));
    expect(kindByKey("nonfiction").modules).toContain("citations");
    const compiled = await compileBook(book, nodeSource(SAMPLE));
    expect(compiled.chapters[0]!.notes).toEqual([{ number: 1, blocks: [{ kind: "paragraph", runs: [{ text: "Darwin, Vegetable Mould. He gives the figure in metric too: 10,516 kilogrammes." }] }] }]);
    // In the text, a source's mention is its words, as every mention is.
    expect(JSON.stringify(compiled.chapters[1]!.blocks)).not.toContain("Darwin, Vegetable");
    expect(compiled.back.map((m) => m.title)).toEqual(["Bibliography"]);
    expect(compiled.back[0]!.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Darwin, Charles. " }, { text: "The Formation of Vegetable Mould through the Action of Worms.", em: true }, { text: " London: John Murray, 1881." }] },
      { kind: "paragraph", runs: [{ text: "White, Gilbert. " }, { text: "The Natural History of Selborne.", em: true }, { text: " London, 1789." }] },
    ]);
  });

  it("lists only what the compiled chapters draw on", async () => {
    const book = await loadBook(nodeSource(SAMPLE));
    const burial = await compileBook(book, nodeSource(SAMPLE), { from: "ch_b4r1a1", to: "ch_b4r1a1" });
    expect(burial.back[0]!.blocks.map((b) => (b.kind === "paragraph" ? b.runs[0]!.text : ""))).toEqual(["Darwin, Charles. "]);
  });
});
