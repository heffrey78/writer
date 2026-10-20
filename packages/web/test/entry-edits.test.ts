import { editFrontMatter, readFrontMatter } from "@writer/core";
import { describe, expect, it } from "vitest";
import { entryEdits, type EntryChange, type SceneList } from "../src/novel/entry-edits.ts";


describe("entry edits, for every scene list", () => {
  const SCENE = "---\nid: sc_aaaaaa\ntitle: A\npov: char_aaaaaa\ncharacters: [char_aaaaaa, char_bbbbbb]\nlocations: [loc_aaaaaa]\nthemes:\n  - id: theme_aaaaaa\n    strength: 3\n  - theme_bbbbbb\n---\nProse.\n";
  const run = (list: SceneList, id: string, change: EntryChange) => editFrontMatter(SCENE, entryEdits(readFrontMatter(SCENE)!, list, id, change));

  it("adds to and removes from a flow list on its own line, keeping its style", () => {
    expect(run("characters", "char_cccccc", { add: true })).toBe(SCENE.replace("characters: [char_aaaaaa, char_bbbbbb]", "characters: [char_aaaaaa, char_bbbbbb, char_cccccc]"));
    expect(run("characters", "char_bbbbbb", { remove: true })).toBe(SCENE.replace("characters: [char_aaaaaa, char_bbbbbb]", "characters: [char_aaaaaa]"));
    expect(run("locations", "loc_aaaaaa", { remove: true })).toBe(SCENE.replace("locations: [loc_aaaaaa]", "locations: []"));
    expect(run("characters", "char_aaaaaa", { add: true })).toBe(SCENE);
  });

  it("sets and clears a theme's strength, on a map or a bare ID", () => {
    expect(run("themes", "theme_aaaaaa", { field: "strength", value: 1 })).toBe(SCENE.replace("    strength: 3", "    strength: 1"));
    expect(run("themes", "theme_aaaaaa", { field: "strength", value: undefined })).toBe(SCENE.replace("\n    strength: 3", ""));
    expect(run("themes", "theme_bbbbbb", { field: "strength", value: 2 })).toBe(SCENE.replace("  - theme_bbbbbb", "  - id: theme_bbbbbb\n    strength: 2"));
  });
});
