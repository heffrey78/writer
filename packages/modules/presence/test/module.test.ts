import { fileURLToPath } from "node:url";
import { kindByKey, loadBook, memorySource, withModules, type BookKind } from "@writer/core";
import { gridKey, presence } from "@writer/core/diagrams";
import { nodeSource } from "@writer/core/node";
import { snapshots } from "@writer/core/snapshots";
import { novel as novelKind } from "@writer/kinds";
import { describe, expect, it } from "vitest";
import { presenceTypes, snapshotTypes } from "../src/core/index.ts";

/** Presence as a module (#29): the Novel's matrices and diagrams as before, any kind's own types, and none in a kind without it. */

const sample = fileURLToPath(new URL("../../../../examples/sample-novel/", import.meta.url));
/** The Novel without presence. */
const plain: BookKind = { ...novelKind, key: "plain", modules: ["point-of-view", "plotlines"] };

/** A kind of its own: days, each with the witnesses who saw it and how surely; no point of view. */
const logbook: BookKind = {
  ...novelKind,
  key: "logbook",
  label: "Logbook",
  plural: "Logbooks",
  prefix: "lg",
  levels: [{ key: "month", label: "Month", plural: "Months", prefix: "mon", list: "months" }],
  piece: { key: "day", label: "Day", plural: "Days", prefix: "day", list: "days" },
  folders: { ...novelKind.folders, content: "pages", codex: "index" },
  entityTypes: [
    { key: "witness", prefix: "wit", folder: "witnesses", label: "Witness", builtin: true },
    { key: "place", prefix: "pl", folder: "places", label: "Place", builtin: true },
  ],
  fields: [
    { key: "witnesses", label: "Witnesses", snapshot: true, type: { kind: "entities", entityType: "witness", item: [{ key: "sure", label: "Sureness", kind: "scale", min: 1, max: 2, labels: { "1": "unsure", "2": "sure" }, options: { "1": "1 (unsure)", "2": "2 (sure)" } }] } },
  ],
  modules: ["presence"],
  fieldOrder: [],
  entityTypeOrder: [],
};

const lines = (...l: string[]) => `${l.join("\n")}\n`;
const DAY = (id: string, title: string, ...front: string[]) => lines("---", `id: ${id}`, `title: ${title}`, ...front, "---", "Words.");
const logbookBook = () =>
  loadBook(
    memorySource({
      "novel.yaml": lines("schema_version: 2", "id: lg_000001", "title: Log"),
      "pages/_order.yaml": lines("months: [mon_000001]"),
      "pages/01-march/_month.yaml": lines("id: mon_000001", "days: [day_000001, day_000002]"),
      "pages/01-march/01-monday.md": DAY("day_000001", "Monday", "witnesses:", "  - id: wit_000001", "    sure: 2"),
      "pages/01-march/02-tuesday.md": DAY("day_000002", "Tuesday", "witnesses: [wit_000002]"),
      "index/witnesses/ada.md": lines("---", "id: wit_000001", "name: Ada", "---"),
      "index/witnesses/ben.md": lines("---", "id: wit_000002", "name: Ben", "---"),
      "index/places/varn.md": lines("---", "id: pl_000001", "name: Varn", "---"),
    }),
    logbook,
  );

describe("presence", () => {
  it("is the Novel's: every type its fields list, and the characters' and themes' diagrams", async () => {
    expect(kindByKey("novel").modules).toContain("presence");
    const book = await loadBook(nodeSource(sample));
    expect(snapshotTypes(book).map((t) => t.key)).toEqual(["character", "theme"]);
    const files = snapshots(book);
    expect([...files.keys()]).toEqual(["diagrams/relationships.svg", "diagrams/plotlines.svg", "diagrams/presence-characters.svg", "diagrams/presence-themes.svg", "diagrams/timeline.svg", "diagrams/README.md"]);
    expect(files.get("diagrams/README.md")).toContain("Filled where the scene lists them (ringed: its point of view; for themes, larger for a stronger one)");
  });

  it("works for a kind's own types: its matrix, its diagram in its words, and no rings without a carrier", async () => {
    const book = await logbookBook();
    // Places are the kind's, but no field lists them.
    expect(presenceTypes(book).map((t) => t.key)).toEqual(["witness"]);
    const m = presence(book, "witness");
    expect(m.rows.map((r) => r.name)).toEqual(["Ada", "Ben"]);
    expect(m.marks.get(gridKey("wit_000001", "day_000001"))).toMatchObject({ listed: true, carries: false, strength: 2, strongest: true });
    expect(m.marks.get(gridKey("wit_000002", "day_000001"))).toBeUndefined();
    const files = snapshots(book);
    expect(files.get("diagrams/presence-witnesses.svg")).toContain("<title>Witnesses by day</title>");
    const readme = files.get("diagrams/README.md")!;
    expect(readme).toContain("## Presence\n\nFilled where the day lists them (for witnesses, larger for a stronger one), dashed where the prose only mentions them. The number by each name is how many days it's in; shaded, an absence of more than three days.\n\n![Witnesses by day](presence-witnesses.svg)\n\n## Timeline");
  });

  it("says what it needs before there's anything to draw", async () => {
    const book = await loadBook(memorySource({ "novel.yaml": lines("schema_version: 2", "id: lg_000001", "title: Log"), "pages/_order.yaml": lines("months: []") }), logbook);
    expect(snapshots(book).get("diagrams/README.md")).toContain("## Presence\n\nNothing to show yet: it needs witnesses, and days.\n");
  });

  it("is nowhere in a kind without the module: no diagrams and no section", async () => {
    expect(withModules(plain).modules).not.toContain("presence");
    const files = snapshots(await loadBook(nodeSource(sample), plain));
    expect([...files.keys()].filter((f) => f.includes("presence"))).toEqual([]);
    expect(files.get("diagrams/README.md")).not.toContain("Presence");
  });
});
