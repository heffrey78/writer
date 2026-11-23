import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { editFrontMatter, loadBook, mergeReach, readFrontMatter, swapEdits, swapMentions, swapped } from "../src/index.ts";
import { nodeSource } from "../src/node.ts";

const novel = await loadBook(nodeSource(fileURLToPath(new URL("../../../examples/sample-novel/", import.meta.url))));
const [BEN, BENJ] = ["char_b3n0vs", "char_b3nj4m"];

describe("merging entries (#173)", () => {
  it("swaps the other for the one kept, leaving a list with one of each", () => {
    expect(swapped([BEN, BENJ, "x"], BENJ, BEN)).toEqual([BEN, "x"]);
    expect(swapped([{ id: BENJ, strength: 2 }, { id: BEN, strength: 3 }], BENJ, BEN)).toEqual([{ id: BEN, strength: 2 }]);
    expect(swapped({ a: BENJ, b: [BENJ], c: 3 }, BENJ, BEN)).toEqual({ a: BEN, b: [BEN], c: 3 });
  });

  it("edits only where the other is named, so the rest of the front matter is left as written", () => {
    const text = `---\nid: sc_aaaaaa\n# who's there\ncharacters: [${BEN}, ${BENJ}]\npov: ${BENJ}\nthemes:\n  - id: theme_aaaaaa\n    strength: 3\n---\nThen [Benjamin](#${BENJ}) and [Ben](#${BEN}).\n`;
    const edits = swapEdits(readFrontMatter(text), BENJ, BEN);
    expect(edits.map((e) => e.path)).toEqual([["characters"], ["pov"]]);
    const front = editFrontMatter(text, edits);
    expect(front).toContain(`# who's there\ncharacters: [${BEN}]\npov: ${BEN}\nthemes:\n  - id: theme_aaaaaa\n    strength: 3\n`);
    expect(swapMentions(front, BENJ, BEN)).toContain(`Then [Benjamin](#${BEN}) and [Ben](#${BEN}).`);
  });

  it("says what a merge reaches: pieces, entries' fields, relationships, notes", () => {
    const ada = novel.entities.find((e) => e.name === "Ada Varn")!;
    const ben = novel.entities.find((e) => e.id === BEN)!;
    const reach = mergeReach(novel, ada, ben);
    expect(reach.pieces).toBeGreaterThan(0);
    expect(reach.relationships).toBe(novel.relationships.filter((r) => r.from === BEN || r.to === BEN).length);
  });
});
