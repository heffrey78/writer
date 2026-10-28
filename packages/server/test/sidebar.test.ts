import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BibleOperations, OperationError } from "../src/index.ts";
import { bookRepo, gitIn, novelRepo, scratch } from "./fixtures.ts";

/** The writer's arrangement of the sidebar in book.yaml (#63): one commit, the author's comments kept, never in a format 2 novel.yaml. */

const SAMPLE_JOURNAL = fileURLToPath(new URL("../../../examples/sample-journal", import.meta.url));

let fresh: (name: string) => string;
let cleanUp: () => void;
beforeAll(() => ({ fresh, cleanUp } = scratch("sidebar")));
afterAll(() => cleanUp());

const lastCommit = (dir: string) => gitIn(dir, "log", "-1", "--format=%s").trim();

describe("arranging the sidebar", () => {
  it("writes it into book.yaml in one commit, keeping the rest byte for byte, and takes it out again", async () => {
    const dir = bookRepo(fresh("journal"), SAMPLE_JOURNAL);
    const manifest = join(dir, "book.yaml");
    // A comment of the author's, which an edit keeps.
    const before = readFileSync(manifest, "utf8").replace("title: A Year at the Estuary", "title: A Year at the Estuary # working title");
    writeFileSync(manifest, before);
    gitIn(dir, "commit", "-qam", "A comment");
    const bible = new BibleOperations(dir, (fn) => fn());

    await bible.updateSidebar({ groups: { "look-back": ["issues", "notes"] }, hidden: ["story-map"] });
    expect(readFileSync(manifest, "utf8")).toBe(`${before}sidebar:\n  groups:\n    look-back:\n      - issues\n      - notes\n  hidden:\n    - story-map\n`);
    expect(lastCommit(dir)).toBe("Arrange the sidebar");
    expect(gitIn(dir, "status", "--porcelain")).toBe("");

    // A phone's bar beside it (#100).
    await bible.updateSidebar({ groups: { "look-back": ["issues", "notes"] }, hidden: ["story-map"], bar: ["calendar", "index", "relationships"] });
    expect(readFileSync(manifest, "utf8")).toBe(`${before}sidebar:\n  groups:\n    look-back:\n      - issues\n      - notes\n  hidden:\n    - story-map\n  bar:\n    - calendar\n    - index\n    - relationships\n`);

    await bible.updateSidebar(null);
    expect(readFileSync(manifest, "utf8")).toBe(before);
    expect(lastCommit(dir)).toBe("The sidebar as the book's kind has it");
  });

  it("refuses a novel still in novel.yaml, which gh-writer reads: it moves to the new format first", async () => {
    const dir = novelRepo(fresh("novel"));
    const before = readFileSync(join(dir, "novel.yaml"), "utf8");
    const refusal = await new BibleOperations(dir, (fn) => fn()).updateSidebar({ hidden: ["outline"] }).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(OperationError);
    expect((refusal as OperationError).code).toBe("NEEDS_MIGRATION");
    expect(readFileSync(join(dir, "novel.yaml"), "utf8")).toBe(before);
  });

  it("refuses what isn't its groups' pages and the pages hidden, by key", async () => {
    const bible = new BibleOperations(bookRepo(fresh("bad"), SAMPLE_JOURNAL), (fn) => fn());
    for (const sidebar of [{ hidden: "notes" }, { groups: { "look-back": [3] } }, { groups: ["notes"] }, { order: [] }, { hidden: ["Not a key"] }, { bar: "notes" }, "notes"]) {
      await expect(bible.updateSidebar(sidebar as never), JSON.stringify(sidebar)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });
});
