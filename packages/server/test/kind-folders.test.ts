import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadBook } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BibleOperations, hashText, NovelWorkspace } from "../src/index.ts";
import { DIARY_ADA, diaryRepo, gitIn, MONDAY, scratch } from "./fixtures.ts";

/** The server works in a kind's own folders (#22): a diary's pages/ and index/, never manuscript/ or bible/. */

let fresh: (name: string) => string;
let cleanUp: () => void;
beforeAll(() => ({ fresh, cleanUp } = scratch("kind-folders")));
afterAll(() => cleanUp());

/** Enough of a JPEG for the server, which goes by the first bytes. */
const jpeg = (fill = 1) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, fill), Buffer.from([0xff, 0xd9])]);

describe("a diary's index", () => {
  it("takes a new entry and a relationship in its own folder", async () => {
    const dir = diaryRepo(fresh("diary"));
    const bible = new BibleOperations(dir, (fn) => fn());
    const { id, file } = await bible.createEntity("character", { name: "Ben" });
    expect(file).toBe("index/characters/ben.md");
    await bible.createRelationship({ from: "char_000001", to: id, type: "friend" });
    expect(readFileSync(join(dir, "index/relationships.yaml"), "utf8")).toContain(id);
    expect(existsSync(join(dir, "bible"))).toBe(false);
    const book = await loadBook(nodeSource(dir));
    expect(book.entities.map((e) => e.file).sort()).toEqual([DIARY_ADA, "index/characters/ben.md"]);
    expect(book.relationships).toHaveLength(1);
  });
});

describe("a diary's pages", () => {
  it("let a picture go with the last day that names it", async () => {
    const dir = diaryRepo(fresh("diary"));
    const ws = await NovelWorkspace.open(dir, { commit: false, sync: false });
    try {
      const read = () => readFileSync(join(dir, MONDAY), "utf8");
      const { path } = await ws.addPicture("The view", jpeg());
      const named = `${read()}\n![The view](/${path})\n`;
      expect((await ws.write(MONDAY, named, hashText(read()))).ok).toBe(true);
      expect((await ws.write(MONDAY, named.replace(`\n![The view](/${path})\n`, ""), hashText(read()))).ok).toBe(true);
      expect(existsSync(join(dir, path))).toBe(false);
      expect(gitIn(dir, "status", "--porcelain", "--", "bible", "manuscript")).toBe("");
    } finally {
      await ws.close();
    }
  });
});
