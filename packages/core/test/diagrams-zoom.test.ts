import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { zoomed } from "../src/diagrams.ts";
import { loadBook } from "../src/index.ts";
import { nodeSource } from "../src/node.ts";

const novel = await loadBook(nodeSource(fileURLToPath(new URL("../../../examples/sample-novel/", import.meta.url))));

describe("zoom", () => {
  it("zooms to a part or a chapter", () => {
    expect(zoomed(novel, novel.pieces, "pt_5a1e00").map((s) => s.title)).toEqual(["The Betrayal", "The Flood", "Mirela's Offer", "The Last Rivet"]);
    expect(zoomed(novel, novel.pieces, "ch_arr1va").map((s) => s.title)).toEqual(["The Station", "Walking the Span"]);
    expect(zoomed(novel, novel.pieces, undefined)).toHaveLength(8);
    expect(zoomed(novel, novel.pieces, "ch_gone00")).toHaveLength(8);
  });
});
