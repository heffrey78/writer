import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { loadBook, memorySource, type BookKind } from "@writer/core";
import { novel } from "@writer/kinds";
import { filterParams, filtersOf, placed, visibleScenes, visibleStep } from "../src/novel/corkboard-order.ts";

describe("reordering a filtered corkboard", () => {
  it("swaps a card with its visible neighbour, and leaves every hidden card where it was", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 40 }), { minLength: 2, maxLength: 20 }), fc.array(fc.boolean(), { minLength: 20, maxLength: 20 }), fc.nat(), fc.boolean(), (ids, show, pick, left) => {
        const book = ids.map(String);
        const visible = book.filter((_, i) => show[i]);
        if (visible.length < 2) return;
        const id = visible[pick % visible.length]!;
        const step = visibleStep(visible, id, left ? -1 : 1);
        const i = visible.indexOf(id);
        if (!step) return void expect(left ? i === 0 : i === visible.length - 1).toBe(true);
        const after = placed(book, id, step.target, step.after);
        // On the board: the card and its neighbour swapped.
        const expected = [...visible];
        const j = i + (left ? -1 : 1);
        [expected[i], expected[j]] = [expected[j]!, expected[i]!];
        expect(after.filter((x) => visible.includes(x))).toEqual(expected);
        // In the book: every other scene keeps its order, and the card sits right beside its neighbour.
        expect(after.filter((x) => x !== id)).toEqual(book.filter((x) => x !== id));
        expect(Math.abs(after.indexOf(id) - after.indexOf(step.target))).toBe(1);
      }),
    );
  });

  it("places a dropped card immediately before the card it's dropped on", () => {
    expect(placed(["a", "b", "c", "d", "e"], "e", "b", false)).toEqual(["a", "e", "b", "c", "d"]);
    expect(placed(["a", "b", "c", "d", "e"], "a", "d", true)).toEqual(["b", "c", "d", "a", "e"]);
  });
});

describe("the cards' filters, from the kind's fields (#25)", () => {
  const lines = (...l: string[]) => `${l.join("\n")}\n`;
  const scene = (id: string, ...front: string[]) => lines("---", `id: ${id}`, `title: ${id}`, ...front, "---", "Words.");
  const entry = (id: string, name: string) => lines("---", `id: ${id}`, `name: ${name}`, "---");
  const book = (kind: BookKind, scenes: string[]) =>
    loadBook(
      memorySource({
        "novel.yaml": lines("schema_version: 2", "id: nv_000001", "title: Test"),
        [`${kind.folders.content}/_order.yaml`]: lines("chapters: [ch_000001]"),
        [`${kind.folders.content}/01-one/_chapter.yaml`]: lines("id: ch_000001", `scenes: [${scenes.map((_, i) => `sc_00000${i + 1}`).join(", ")}]`),
        ...Object.fromEntries(scenes.map((s, i) => [`${kind.folders.content}/01-one/0${i + 1}.md`, s])),
        "bible/characters/ada.md": entry("char_000001", "Ada"),
        "bible/characters/bo.md": entry("char_000002", "Bo"),
        "bible/plotlines/heist.md": entry("plot_000001", "Heist"),
      }),
      kind,
    );

  it("are a novel's point of view, characters and plotlines; a character matches in the list or the point of view", async () => {
    const b = await book(novel, [
      scene("sc_000001", "pov: char_000001"),
      scene("sc_000002", "characters: [char_000001]", "plotlines: [{ id: plot_000001, weight: minor }]"),
      scene("sc_000003", "pov: char_000002", "status: drafted"),
    ]);
    expect(filtersOf(b).map((d) => [d.param, d.label])).toEqual([
      ["pov", "Point of view"],
      ["character", "Character"],
      ["plotline", "Plotline"],
    ]);
    expect(filterParams(b)).toEqual(["pov", "character", "plotline", "status"]);
    const ids = (f: Record<string, string>) => visibleScenes(b, f).map((s) => s.id);
    expect(ids({ pov: "char_000001" })).toEqual(["sc_000001"]);
    expect(ids({ character: "char_000001" })).toEqual(["sc_000001", "sc_000002"]);
    expect(ids({ plotline: "plot_000001" })).toEqual(["sc_000002"]);
    expect(ids({ character: "char_000002", status: "drafted" })).toEqual(["sc_000003"]);
    expect(ids({ character: "char_000001", status: "drafted" })).toEqual([]);
  });

  it("are whatever fields another kind marks, and none of the novel's", async () => {
    const kind: BookKind = {
      ...novel,
      key: "diary",
      fields: [{ key: "people", label: "People", type: { kind: "entities", entityType: "character" }, outline: { filter: true } }],
    };
    const b = await book(kind, [scene("sc_000001", "people: [char_000002]"), scene("sc_000002", "pov: char_000002")]);
    expect(filterParams(b)).toEqual(["character", "status"]);
    expect(visibleScenes(b, { character: "char_000002" }).map((s) => s.id)).toEqual(["sc_000001"]);
  });
});
