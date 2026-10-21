import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { kindByKey, loadBook, validateBook } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BibleOperations, ManuscriptOperations } from "../src/index.ts";
import { bookRepo, gitIn, novelRepo, scratch } from "./fixtures.ts";

/** A session's prep and its notes from the table (#42): new pieces from the kind's template, a quick note pinned to the session. */

const SAMPLE = fileURLToPath(new URL("../../../examples/sample-campaign", import.meta.url));
const ARC = "arc_be11ab";
const SESSION_2 = "ses_tw0002";
const PREP = "## Strong start\n\n## Scenes\n\n## Secrets and clues\n\n## NPCs\n\n## Locations\n\n## Treasure\n\n## At the table\n";

let fresh: (name: string) => string;
let cleanUp: () => void;
beforeAll(() => ({ fresh, cleanUp } = scratch("campaign")));
afterAll(() => cleanUp());

/** The operations on a book of `kind`, which the workspace would tell them. */
const ops = (dir: string, kind = "campaign") => ({ manuscript: new ManuscriptOperations(dir, (fn) => fn(), () => kindByKey(kind)), bible: new BibleOperations(dir, (fn) => fn()) });
const read = (dir: string, path: string) => readFileSync(join(dir, path), "utf8");

describe("a new session", () => {
  it("starts with the Campaign's prep, then the place for what happened at the table", async () => {
    const dir = bookRepo(fresh("campaign"), SAMPLE);
    const { id } = await ops(dir).manuscript.createScene(ARC, { title: "Session 3" });
    const file = "sessions/01-the-drowned-bell/03-session-3.md";
    expect(read(dir, file)).toBe(`---\nid: ${id}\ntitle: Session 3\nstatus: planned\n---\n${PREP}`);
    expect(gitIn(dir, "log", "-1", "--format=%s").trim()).toBe("Campaign: add session “Session 3”");
    expect(validateBook(await loadBook(nodeSource(dir)))).toEqual([]);
  });

  it("while a novel's new scene starts empty, as it always has", async () => {
    const dir = novelRepo(fresh("novel"));
    const { id } = await ops(dir, "novel").manuscript.createScene("ch_arr1va", { title: "Dawn" });
    const book = await loadBook(nodeSource(dir));
    const scene = book.allPieces.find((p) => p.id === id)!;
    expect(read(dir, scene.file)).toMatch(/^---\n[\s\S]*\n---\n$/);
  });
});

describe("a note from the table", () => {
  it("is made on the session and pinned there in one commit, taking the pin from the note pinned before", async () => {
    const dir = bookRepo(fresh("campaign"), SAMPLE);
    const { bible } = ops(dir);
    const first = await bible.createNote({ title: "At the table: Session 2", scenes: [SESSION_2], pinned: [SESSION_2] });
    expect(read(dir, first.file)).toContain(`scenes:\n  - ${SESSION_2}\npinned:\n  - ${SESSION_2}\n`);
    const second = await bible.createNote({ title: "At the table: Session 2", scenes: [SESSION_2], pinned: [SESSION_2] });
    expect(second.file).not.toBe(first.file);
    expect(gitIn(dir, "log", "-1", "--format=%s").trim()).toBe("Notes: add “At the table: Session 2”");
    expect(gitIn(dir, "show", "--name-status", "--format=", "HEAD").trim().split("\n").sort()).toEqual([`A\t${second.file}`, `M\t${first.file}`].sort());
    expect(read(dir, first.file)).not.toContain("pinned");
    const book = await loadBook(nodeSource(dir));
    expect(book.notes.filter((n) => n.pinned.includes(SESSION_2)).map((n) => n.id)).toEqual([second.id]);
    expect(validateBook(book)).toEqual([]);
  });

  it("is pinned only where it is", async () => {
    const dir = bookRepo(fresh("campaign"), SAMPLE);
    await expect(ops(dir).bible.createNote({ title: "Stray", scenes: [], pinned: [SESSION_2] })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "A note is pinned only in sessions it's on." });
  });
});
