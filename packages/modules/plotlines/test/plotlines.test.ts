import { fileURLToPath } from "node:url";
import { kindByKey, loadBook, sceneFacts, withModules, type BookKind } from "@writer/core";
import { graphAt, laneModes } from "@writer/core/diagrams";
import { nodeSource } from "@writer/core/node";
import { snapshots } from "@writer/core/snapshots";
import { novel as novelKind } from "@writer/kinds";
import { describe, expect, it } from "vitest";

/** Plotlines as a module (#28): the Novel's as before, and a kind without it has none anywhere. */

const sample = fileURLToPath(new URL("../../../../examples/sample-novel/", import.meta.url));
/** The Novel with its point of view, without plotlines. */
const plain: BookKind = { ...novelKind, key: "plain", modules: ["point-of-view"] };

describe("plotlines", () => {
  it("are the Novel's: its type and field where they were, lanes and a thread, a section of the diagrams", async () => {
    const kind = kindByKey("novel");
    expect(kind.entityTypes.map((t) => t.key)).toEqual(["character", "location", "plotline", "theme"]);
    expect(kind.fields.map((f) => f.key)).toEqual(["pov", "locations", "characters", "when", "plotlines", "entities", "themes"]);
    expect(laneModes(kind)).toEqual(["carrier", "location", "plotline"]);
    const book = await loadBook(nodeSource(sample));
    expect(graphAt(book, "sc_0d9wm4", { thread: "plot_gr1efa" }).nodes.map((n) => n.label)).toEqual(["Ada Varn", "Ben Varn", "Tomas Hale"]);
    const files = snapshots(book);
    expect([...files.keys()]).toContain("diagrams/plotlines.svg");
    expect(files.get("diagrams/README.md")).toContain("## Plotlines");
  });

  it("are nowhere in a kind without the module: no type, field, lanes, thread, facts or diagram", async () => {
    const kind = withModules(plain);
    expect(kind.entityTypes.map((t) => t.key)).not.toContain("plotline");
    expect(kind.fields.map((f) => f.key)).not.toContain("plotlines");
    expect(laneModes(kind)).toEqual(["carrier", "location"]);
    expect(kind.fields.some((f) => f.threads)).toBe(false);
    const book = await loadBook(nodeSource(sample), plain);
    expect(book.entities.some((e) => e.type === "plotline")).toBe(false);
    expect(book.pieces.every((p) => !("plotlines" in p.fields))).toBe(true);
    expect(book.pieces.flatMap((p) => sceneFacts(book, p.id)).join(" ")).not.toMatch(/begins here|ends here/);
    const files = snapshots(book);
    expect([...files.keys()]).not.toContain("diagrams/plotlines.svg");
    expect(files.get("diagrams/README.md")).not.toContain("Plotlines");
  });
});
