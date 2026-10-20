import { fileURLToPath } from "node:url";
import { itemsOf, loadBook, mentions } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { describe, expect, it } from "vitest";
import { gaps, gridKey, presence } from "@writer/core/diagrams";
import { listFieldOf, presenceTypes, sortRows, totals } from "../src/core/index.ts";

const novel = await loadBook(nodeSource(fileURLToPath(new URL("../../../../examples/sample-novel/", import.meta.url))));

describe("presence", () => {
  it("matches the scenes' metadata exactly, for every type the kind's fields list", () => {
    expect(presenceTypes(novel).map((t) => t.key)).toEqual(["character", "location", "plotline", "theme", "artifact"]);
    for (const [type, field] of [["character", "characters"], ["location", "locations"], ["theme", "themes"], ["plotline", "plotlines"], ["artifact", "entities"]] as const) {
      expect(listFieldOf(novel, type)?.key).toBe(field);
      const m = presence(novel, type);
      for (const scene of novel.pieces) {
        const listed = new Set<string>(
          field === "characters" ? [...(typeof scene.fields["pov"] === "string" ? [scene.fields["pov"]] : []), ...scene.characters] : field === "locations" || field === "entities" ? scene[field] : field === "themes" ? scene.themes.map((x) => x.id) : itemsOf(scene.fields["plotlines"]).map((x: unknown) => (typeof x === "string" ? x : (x as { id: string }).id)),
        );
        for (const row of m.rows) expect(m.marks.get(gridKey(row.id, scene.id))?.listed ?? false, `${type} ${row.name} in ${scene.title}`).toBe(listed.has(row.id));
      }
    }
  });

  it("marks the point of view, theme strengths, and entries only mentioned", () => {
    const characters = presence(novel, "character");
    expect(characters.marks.get(gridKey("char_7f3k2q", "sc_0d9wm4"))).toMatchObject({ listed: true, carries: true, mentioned: true });
    expect(characters.marks.get(gridKey("char_b3n0vs", "sc_0d9wm4"))).toMatchObject({ listed: true, carries: false });
    const themes = presence(novel, "theme");
    expect(themes.marks.get(gridKey("theme_trvst5", "sc_0d9wm4"))).toMatchObject({ listed: true, strength: 3 });
    // Custom types are listed in a scene's entities, or present where mentioned.
    const artifacts = presence(novel, "artifact");
    expect(artifacts.marks.size).toBeGreaterThan(0);
    for (const [key, mark] of artifacts.marks) {
      const [entry, id] = key.split("|") as [string, string];
      const scene = novel.pieces.find((s) => s.id === id)!;
      expect(mark).toMatchObject({ listed: scene.entities.includes(entry), mentioned: mentions(scene.body).some((x) => x.id === entry) });
    }
    expect(artifacts.marks.get(gridKey("art_p1an5x", "sc_0d9wm4"))).toMatchObject({ listed: true });
  });

  it("counts and sorts rows by first appearance, total, or name", () => {
    const m = presence(novel, "character");
    expect(sortRows(m, "name").map((r) => r.name)).toEqual(["Ada Varn", "Ben Varn", "Mirela Kost", "Tomas Hale"]);
    expect(sortRows(m, "total")[0]!.name).toBe("Ada Varn");
    expect(totals(m).get("char_7f3k2q")).toBe(8);
    expect(sortRows(m, "first")[0]!.name).toBe("Ada Varn");
  });
});

describe("absences", () => {
  it("finds who is away between appearances, and who never comes back", () => {
    const m = presence(novel, "character");
    const away = gaps({ lanes: m.rows, scenes: m.scenes, marks: m.marks, words: m.words }, { scenes: 0 });
    const of = (id: string) => away.filter((g) => g.lane === id).map((g) => [g.from, g.to, g.scenes, g.open]);
    // Mirela: only in Mirela's Offer, then The Last Rivet without her.
    expect(of("char_m1re1a")).toEqual([["sc_r1vet8", "sc_r1vet8", 1, true]]);
    // Tomas: the workshop, the flood, the last rivet.
    expect(of("char_t0ma5h")).toEqual([
      ["sc_1edger", "sc_0d9wm4", 2, false],
      ["sc_0ffer5", "sc_0ffer5", 1, false],
    ]);
    // Over one scene: Ben (The Workshop and Ben's Ledger) and Tomas (Ben's Ledger and The Betrayal).
    expect(gaps({ lanes: m.rows, scenes: m.scenes, marks: m.marks, words: m.words }, { scenes: 1 }).map((g) => g.lane)).toEqual(["char_b3n0vs", "char_t0ma5h"]);
  });
});
