import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadBook, locationProfile, themeProfile } from "../src/index.ts";
import { nodeSource } from "../src/node.ts";

const novel = await loadBook(nodeSource(fileURLToPath(new URL("../../../examples/sample-novel/", import.meta.url))));
const tally = (t: { name: string; scenes: number }[]) => t.map((v) => `${v.name}: ${v.scenes}`);

describe("profiles by type", () => {
  it("a location: who comes there, its scenes and the story time they span", () => {
    const bridge = locationProfile(novel, "loc_br1dg3");
    expect(tally(bridge.visitors)).toEqual(["Ada Varn: 4", "Ben Varn: 4", "Tomas Hale: 2"]);
    expect(bridge.scenes.map((s) => s.title)).toEqual(["Walking the Span", "The Betrayal", "The Flood", "The Last Rivet"]);
    // The flashback's date to the last scene, through the calendar.
    expect(bridge.span).toEqual({ from: "2 Nov 2009, 23:00", to: "Day 5, 06:00 (5 Mar 2024)" });
    expect(locationProfile(novel, "loc_5tat10").span).toEqual({ from: "Day 1, 09:10 (1 Mar 2024)", to: "Day 1, 09:10 (1 Mar 2024)" });
  });

  it("a theme: its strength in each scene", () => {
    expect(themeProfile(novel, "theme_1nher1").strengths.map((s) => s.strength).join("")).toBe("10202203");
    expect(themeProfile(novel, "theme_trvst5").strengths.map((s) => s.strength).join("")).toBe("02033022");
  });
});
