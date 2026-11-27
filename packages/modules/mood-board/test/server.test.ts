import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadBook, validate } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { BibleOperations, hashText } from "@writer/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { gitIn, novelRepo, scratch } from "../../../server/test/fixtures.ts";
import { boardsOf } from "../src/core/index.ts";
import { BoardOperations } from "../src/server/index.ts";

/** Boards made, renamed and deleted through the module's server half (#207), each one commit. */

let fresh: (name: string) => string;
let cleanUp: () => void;
let dir: string;
let boards: BoardOperations;

beforeAll(() => ({ fresh, cleanUp } = scratch("boards")));
afterAll(() => cleanUp());

beforeEach(() => {
  dir = novelRepo(fresh("novel"));
  boards = new BoardOperations(new BibleOperations(dir, (fn) => fn()));
});

const read = (path: string) => readFileSync(join(dir, path), "utf8");
const lastCommit = () => gitIn(dir, "log", "-1", "--format=%s").trim();
const clean = () => expect(gitIn(dir, "status", "--porcelain")).toBe("");

describe("boards", () => {
  it("are made with no cards, a file each named from the title, one commit", async () => {
    const made = await boards.create("The Belfry");
    expect(made.file).toBe("boards/the-belfry.yaml");
    expect(read(made.file)).toBe(`# A mood board. Kept by Writer.\nid: ${made.id}\ntitle: The Belfry\ncards: []\n`);
    expect(lastCommit()).toBe("Boards: add “The Belfry”");
    clean();
    expect((await boards.create("The Belfry")).file).toBe("boards/the-belfry-2.yaml");
    const { diagnostics } = await validate(nodeSource(dir));
    expect(diagnostics).toEqual([]);
    await expect(boards.create("  ")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("are renamed in place, comments kept, the file keeping its name; refused when it changed since it was read", async () => {
    const { id, file } = await boards.create("The Belfry");
    writeFileSync(join(dir, file), read(file).replace("cards: []", "# Mine.\ncards: []"));
    gitIn(dir, "commit", "-qam", "A comment");
    await expect(boards.rename(id, "Belfry", { base: "stale" })).rejects.toMatchObject({ code: "STALE" });
    await boards.rename(id, "The Drowned Belfry", { base: hashText(read(file)) });
    expect(read(file)).toBe(`# A mood board. Kept by Writer.\nid: ${id}\ntitle: The Drowned Belfry\n# Mine.\ncards: []\n`);
    expect(lastCommit()).toBe("Boards: rename “The Belfry” to “The Drowned Belfry”");
    await expect(boards.rename("board_zzzzzz", "x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("are deleted with the pictures alone only they show; a picture another board or a note shows stays", async () => {
    const { id, file } = await boards.create("The Belfry");
    const other = await boards.create("Saltmere");
    mkdirSync(join(dir, "images"), { recursive: true });
    for (const name of ["alone.jpg", "shared.jpg", "in-note.jpg"]) writeFileSync(join(dir, "images", name), "jpeg");
    const note = (await loadBook(nodeSource(dir))).notes[0]!;
    writeFileSync(join(dir, note.file), `${read(note.file)}\n![In a note](/images/in-note.jpg)\n`);
    const cards = (pictures: string[]) => `cards:\n${pictures.map((p, i) => `  - { picture: images/${p}, at: [ ${i * 100}, 0 ], size: [ 90, 90 ] }\n`).join("")}`;
    writeFileSync(join(dir, file), read(file).replace("cards: []\n", cards(["alone.jpg", "shared.jpg", "in-note.jpg"])));
    writeFileSync(join(dir, other.file), read(other.file).replace("cards: []\n", cards(["shared.jpg"])));
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-qm", "Pictures");
    await boards.delete(id);
    expect(existsSync(join(dir, file))).toBe(false);
    expect(["alone.jpg", "shared.jpg", "in-note.jpg"].map((p) => existsSync(join(dir, "images", p)))).toEqual([false, true, true]);
    expect(lastCommit()).toBe("Boards: remove “The Belfry”");
    clean();
    expect(boardsOf(await loadBook(nodeSource(dir))).map((b) => b.title)).toEqual(["Saltmere"]);
  });
});
