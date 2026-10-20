import { fileURLToPath } from "node:url";
import { loadBook } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { describe, expect, it } from "vitest";
import { plotlineProfile } from "../src/core/index.ts";

const novel = await loadBook(nodeSource(fileURLToPath(new URL("../../../../examples/sample-novel/", import.meta.url))));
const tally = (t: { name: string; scenes: number }[]) => t.map((v) => `${v.name}: ${v.scenes}`);

describe("a plotline's profile", () => {
  it("a plotline: its beats in order, the beats not yet written, the scenes it skips, who and where", () => {
    const sale = plotlineProfile(novel, "plot_h315tz");
    expect(sale.beats.map((b) => [b.scene.title, b.weight, b.beat ?? null])).toEqual([
      ["The Station", "minor", "First sign of the sale"],
      ["Walking the Span", "major", null],
      ["Tomas's Workshop", "major", null],
      ["The Betrayal", "major", "The plans have been sold"],
      ["Mirela's Offer", "major", null],
      ["The Last Rivet", "major", "The sale stalls"],
    ]);
    expect(sale.skips.map((s) => s.title)).toEqual(["Ben's Ledger", "The Flood"]);
    expect(tally(sale.who)).toEqual(["Ada Varn: 6", "Ben Varn: 3", "Tomas Hale: 2", "Mirela Kost: 1"]);
    expect(tally(sale.where)).toEqual(["The Varn Bridge: 3", "Tomas's Workshop: 2", "Varn Station: 1"]);
    expect(sale.quiet).toEqual([]);
    // Each beat knows its place in the scene's list, to write it there.
    expect(plotlineProfile(novel, "plot_gr1efa").beats.find((b) => b.scene.title === "Walking the Span")?.index).toBe(1);
  });

  it("a plotline that goes quiet, and one in no scene", async () => {
    const { memorySource } = await import("@writer/core");
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join, relative } = await import("node:path");
    const root = fileURLToPath(new URL("../../../../examples/sample-novel/", import.meta.url));
    const files: Record<string, string> = Object.fromEntries(
      readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => [relative(root, join(e.parentPath, e.name)), readFileSync(join(e.parentPath, e.name), "utf8")]),
    );
    // The Sale only at the station and the last rivet: quiet for the six between.
    for (const [path, text] of Object.entries(files)) {
      if (!path.startsWith("manuscript/") || /01-the-station|02-the-last-rivet/.test(path)) continue;
      files[path] = text.replace(/^  - plot_h315tz\n/m, "").replace(/^  - id: plot_h315tz\n(    .*\n)*/m, "");
    }
    const book = await loadBook(memorySource(files));
    const sale = plotlineProfile(book, "plot_h315tz");
    expect(sale.beats.map((b) => b.scene.title)).toEqual(["The Station", "The Last Rivet"]);
    expect(sale.quiet).toMatchObject([{ scenes: 6, open: false }]);
    expect(plotlineProfile(book, "plot_nope00")).toMatchObject({ beats: [], skips: [], who: [], where: [], quiet: [] });
  });
});
