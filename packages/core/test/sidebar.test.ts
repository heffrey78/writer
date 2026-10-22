import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { arrangeSidebar, kindByKey, memorySource, validate } from "../src/index.ts";

/** A writer's arrangement of the sidebar over the kind's (#63), and what the validator says of one. */

const journal = () => kindByKey("journal");
const pages = (a: ReturnType<typeof arrangeSidebar>) => a.groups.map((g) => [g.key, g.pages]);

describe("arranging the sidebar", () => {
  it("is the kind's without an arrangement, with what the kind leaves out hidden", () => {
    const a = arrangeSidebar(journal());
    expect(pages(a)).toEqual([
      ["look-back", ["calendar", "read", "notes", "issues"]],
      ["people-and-places", ["index", "relationships", "story-map", "progress"]],
    ]);
    expect(a.hidden).toEqual(["outline", "compare"]);
  });

  it("puts the writer's pages first in their order, the kind's others after, and leaves out the hidden", () => {
    const a = arrangeSidebar(journal(), { groups: { "look-back": ["issues", "notes", "outline"] }, hidden: ["story-map", "read"] });
    expect(pages(a)).toEqual([
      ["look-back", ["issues", "notes", "outline", "calendar"]],
      ["people-and-places", ["index", "relationships", "progress"]],
    ]);
    expect(a.hidden).toEqual(["read", "story-map", "compare"]);
  });

  it("moves a page to the group the writer names it in, and ignores a group the kind doesn't have", () => {
    const a = arrangeSidebar(journal(), { groups: { "people-and-places": ["calendar", "index"], elsewhere: ["notes"] } });
    expect(pages(a)).toEqual([
      ["look-back", ["read", "notes", "issues"]],
      ["people-and-places", ["calendar", "index", "relationships", "story-map", "progress"]],
    ]);
  });

  it("shows a page named twice once, in the first of the kind's groups that names it", () => {
    const a = arrangeSidebar(journal(), { groups: { "people-and-places": ["notes"], "look-back": ["notes"] } });
    expect(pages(a)).toEqual([
      ["look-back", ["notes", "calendar", "read", "issues"]],
      ["people-and-places", ["index", "relationships", "story-map", "progress"]],
    ]);
  });

  it("ignores what isn't a list of keys, as a book with schema errors has it", () => {
    expect(pages(arrangeSidebar(journal(), { groups: { "look-back": "notes" }, hidden: "read" } as never))).toEqual(pages(arrangeSidebar(journal())));
  });

  it("keeps a page the writer hides hidden even where they also place it", () => {
    expect(pages(arrangeSidebar(journal(), { groups: { "look-back": ["notes"] }, hidden: ["notes"] }))[0]).toEqual(["look-back", ["calendar", "read", "issues"]]);
  });
});

const SAMPLE = fileURLToPath(new URL("../../../examples/sample-journal", import.meta.url));
const files = (dir: string): Record<string, string> =>
  Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const path = join(e.parentPath, e.name);
        return [path.slice(dir.length + 1), readFileSync(path, "utf8")];
      }),
  );

describe("validating the sidebar's arrangement", () => {
  const withSidebar = async (yaml: string) => {
    const book = files(SAMPLE);
    return (await validate(memorySource({ ...book, "book.yaml": `${book["book.yaml"]}${yaml}` }))).diagnostics;
  };

  it("accepts one of the kind's groups and pages", async () => {
    expect(await withSidebar("sidebar:\n  groups:\n    look-back: [issues, notes]\n  hidden: [story-map]\n")).toEqual([]);
  });

  it("warns of a group or a page the kind doesn't have", async () => {
    const ds = await withSidebar("sidebar:\n  groups:\n    plan: [notes, swimlanes]\n  hidden: [board]\n");
    expect(ds.map((d) => [d.code, d.pointer, d.message])).toEqual([
      ["W_SIDEBAR_UNKNOWN", "/sidebar/groups/plan", "The sidebar names a group “plan”, which a journal doesn't have"],
      ["W_SIDEBAR_UNKNOWN", "/sidebar/groups/plan/1", "The sidebar names a page “swimlanes”, which a journal doesn't have"],
      ["W_SIDEBAR_UNKNOWN", "/sidebar/hidden/0", "The sidebar names a page “board”, which a journal doesn't have"],
    ]);
  });

  it("is a schema error when it isn't lists of keys", async () => {
    expect((await withSidebar("sidebar:\n  hidden: notes\n")).map((d) => d.code)).toContain("E_SCHEMA");
  });
});
