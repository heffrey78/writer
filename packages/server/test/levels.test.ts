import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadBook, validateBook, type Book, type BookKind } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ManuscriptOperations } from "../src/index.ts";
import { diary, lines, pieceFile, saga } from "../../core/test/kinds.ts";
import { gitIn, scratch } from "./fixtures.ts";

/** Manuscript operations over a kind's levels (#24): a saga's three, a diary's one. */

let fresh: (name: string) => string;
let cleanUp: () => void;
beforeAll(() => ({ fresh, cleanUp } = scratch("levels")));
afterAll(() => cleanUp());

/** A book of `kind` in a new git repository, from its files. */
function repo(kind: BookKind, files: Record<string, string>): { dir: string; ops: ManuscriptOperations; load: () => Promise<Book>; read: (path: string) => string; last: () => string } {
  const dir = fresh(kind.key);
  const all = { "novel.yaml": lines("schema_version: 2", `id: ${kind.prefix}_000001`, "title: Test"), ...files };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  gitIn(dir, "init", "-q");
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-qm", "Start");
  const load = async () => {
    const book = await loadBook(nodeSource(dir), kind);
    expect([...book.diagnostics, ...validateBook(book)]).toEqual([]);
    return book;
  };
  return { dir, ops: new ManuscriptOperations(dir, (fn) => fn(), () => kind), load, read: (path) => readFileSync(join(dir, path), "utf8"), last: () => gitIn(dir, "log", "-1", "--format=%s").trim() };
}

const SAGA = {
  "manuscript/_order.yaml": lines("volumes: [vol_000001]"),
  "manuscript/01-the-north/_volume.yaml": lines("id: vol_000001", "title: The North", "parts: [pt_000001, pt_000002]"),
  "manuscript/01-the-north/01-winter/_part.yaml": lines("id: pt_000001", "title: Winter", "chapters: [ch_000001]"),
  "manuscript/01-the-north/01-winter/01-snow/_chapter.yaml": lines("id: ch_000001", "title: Snow", "scenes: [sc_000001, sc_000002]"),
  "manuscript/01-the-north/01-winter/01-snow/01-drifts.md": pieceFile("sc_000001", "Drifts"),
  "manuscript/01-the-north/01-winter/01-snow/02-the-pass.md": pieceFile("sc_000002", "The pass"),
  "manuscript/01-the-north/02-spring/_part.yaml": lines("id: pt_000002", "title: Spring", "chapters: [ch_000002]"),
  "manuscript/01-the-north/02-spring/01-thaw/_chapter.yaml": lines("id: ch_000002", "scenes: [sc_000003]"),
  "manuscript/01-the-north/02-spring/01-thaw/01-meltwater.md": pieceFile("sc_000003", "Meltwater"),
};

describe("a saga: volumes, parts and chapters", () => {
  it("adds a section at every level, each where its level goes", async () => {
    const { ops, load, read, last, dir } = repo(saga, SAGA);
    const volume = (await ops.createSection("volume", null, { title: "The South" })).id;
    expect(last()).toBe("Manuscript: add volume “The South”");
    const part = (await ops.createSection("part", volume, { title: "Summer" })).id;
    expect(read("manuscript/02-the-south/_volume.yaml")).toBe(`id: ${volume}\ntitle: The South\nparts:\n  - ${part}\n`);
    expect(read("manuscript/02-the-south/01-summer/_part.yaml")).toBe(`id: ${part}\ntitle: Summer\nchapters: []\n`);
    const chapter = (await ops.createSection("chapter", part, {})).id;
    expect(existsSync(join(dir, "manuscript/02-the-south/01-summer/01-chapter/_chapter.yaml"))).toBe(true);
    expect(last()).toBe("Manuscript: add chapter");
    await ops.createScene(chapter, { title: "Heat" });
    const book = await load();
    expect(book.sections.map((s) => s.title ?? "-")).toEqual(["The North", "Winter", "Snow", "Spring", "-", "The South", "Summer", "-"]);
    expect(book.pieces.map((p) => p.title)).toEqual(["Drifts", "The pass", "Meltwater", "Heat"]);
  });

  it("puts a section only where its level belongs", async () => {
    const { ops } = repo(saga, SAGA);
    await expect(ops.createSection("chapter", null, {})).rejects.toThrow("In a book organised in volumes, a chapter belongs to a part.");
    await expect(ops.createSection("chapter", "vol_000001", {})).rejects.toThrow("No part “vol_000001”.");
    await expect(ops.createSection("part", "vol_000001", {})).rejects.toThrow("A title is required.");
    await expect(ops.createSection("epilogue", null, {})).rejects.toThrow("A saga has no level “epilogue”.");
  });

  it("moves a chapter to a part, and a part to another volume, renumbering both sides", async () => {
    const { ops, load, read } = repo(saga, SAGA);
    await ops.move("ch_000002", { to: "pt_000001", index: 0 });
    let book = await load();
    expect(book.sections.map((s) => s.title ?? "-")).toEqual(["The North", "Winter", "-", "Snow", "Spring"]);
    expect(read("manuscript/01-the-north/01-winter/_part.yaml")).toBe("id: pt_000001\ntitle: Winter\nchapters: [ch_000002, ch_000001]\n");
    expect(book.allSections.find((s) => s.id === "ch_000002")!.dir).toBe("manuscript/01-the-north/01-winter/01-thaw");

    const south = (await ops.createSection("volume", null, { title: "The South" })).id;
    await ops.move("pt_000002", { to: south, index: 0 });
    book = await load();
    expect(book.allSections.find((s) => s.id === "pt_000002")!.dir).toBe("manuscript/02-the-south/01-spring");
    expect(book.sections.find((s) => s.id === south)!.childIds).toEqual(["pt_000002"]);
  });

  it("deletes a volume with all it holds, and brings it back", async () => {
    const { ops, load, last } = repo(saga, SAGA);
    const { commit } = await ops.delete("vol_000001");
    expect(last()).toBe("Manuscript: delete volume “The North”");
    expect((await load()).allPieces).toEqual([]);
    const deleted = await ops.recentlyDeleted();
    expect(deleted.map((d) => [d.kind, d.title])).toEqual([["volume", "The North"]]);
    await ops.restore(commit!, "vol_000001");
    expect((await load()).pieces.map((p) => p.title)).toEqual(["Drifts", "The pass", "Meltwater"]);
  });
});

const DIARY = {
  "pages/_order.yaml": lines("months: [mon_000001, mon_000002]"),
  "pages/1-march/_month.yaml": lines("id: mon_000001", "title: March", "days: [day_000001, day_000002]"),
  "pages/1-march/1-the-first.md": pieceFile("day_000001", "The first"),
  "pages/1-march/2-the-second.md": pieceFile("day_000002", "The second"),
  "pages/2-april/_month.yaml": lines("id: mon_000002", "title: April", "days: [day_000003]"),
  "pages/2-april/1-rain.md": pieceFile("day_000003", "Rain"),
};

describe("a diary: months of days", () => {
  it("adds a month at the top and a day in it, moves a day between months, and renames one", async () => {
    const { ops, load, last } = repo(diary, DIARY);
    const may = (await ops.createSection("month", null, { title: "May" })).id;
    await ops.createScene(may, { title: "Blossom" });
    expect(last()).toBe("Pages: add day “Blossom”");
    await ops.move("day_000002", { to: "mon_000002", index: 1 });
    await ops.rename("mon_000001", "Early spring");
    const book = await load();
    expect(book.sections.map((s) => [s.title, s.childIds.length])).toEqual([["Early spring", 1], ["April", 2], ["May", 1]]);
    expect(book.allSections.find((s) => s.id === "mon_000001")!.dir).toBe("pages/01-early-spring");
    expect(book.pieces.map((p) => p.title)).toEqual(["The first", "Rain", "The second", "Blossom"]);
  });

  it("deletes a day and brings it back", async () => {
    const { ops, load } = repo(diary, DIARY);
    const { commit } = await ops.delete("day_000003");
    expect((await ops.recentlyDeleted()).map((d) => [d.kind, d.title])).toEqual([["day", "Rain"]]);
    await ops.restore(commit!, "day_000003");
    expect((await load()).pieces.map((p) => p.title)).toEqual(["The first", "The second", "Rain"]);
  });
});
