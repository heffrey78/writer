import { describe, expect, it } from "vitest";
import { chapterTitle, sceneColumns } from "../src/diagrams.ts";
import { compileBook, loadBook, memorySource, pieceSections, schemaFor, sectionById, sectionsAt, validateBook, type Book, type BookKind } from "../src/index.ts";
import { diary, lines, pieceFile, saga } from "./kinds.ts";

/** Levels from the kind (#24): books with one level, and with three, load, validate and compile. */

const load = (kind: BookKind, files: Record<string, string>) => loadBook(memorySource({ "novel.yaml": lines("schema_version: 2", `id: ${kind.prefix}_000001`, "title: Test"), ...files }), kind);
const errors = (book: Book) => [...book.diagnostics, ...validateBook(book)].filter((d) => d.severity === "error");
const codes = (book: Book) => [...book.diagnostics, ...validateBook(book)].map((d) => `${d.code} ${d.message}`);

const A_DIARY = {
  "pages/_order.yaml": lines("months: [mon_000001, mon_000002]"),
  "pages/01-march/_month.yaml": lines("id: mon_000001", "title: March", "days: [day_000001, day_000002]"),
  "pages/01-march/01-the-first.md": pieceFile("day_000001", "The first"),
  "pages/01-march/02-the-second.md": pieceFile("day_000002", "The second"),
  "pages/02-april/_month.yaml": lines("id: mon_000002", "days: [day_000003]"),
  "pages/02-april/01-rain.md": pieceFile("day_000003", "Rain"),
};

describe("a kind with one level (a diary: months of days)", () => {
  it("loads its months and days in reading order, from its own folders and files", async () => {
    const book = await load(diary, A_DIARY);
    expect(errors(book)).toEqual([]);
    expect(book.levels).toEqual(["month"]);
    expect(book.sections.map((s) => [s.level, s.title, s.childIds.length])).toEqual([["month", "March", 2], ["month", undefined, 1]]);
    expect(book.pieces.map((p) => [p.title, p.sectionId, p.position])).toEqual([["The first", "mon_000001", 0], ["The second", "mon_000001", 1], ["Rain", "mon_000002", 2]]);
  });

  it("says what's amiss in its own words", async () => {
    const book = await load(diary, {
      ...A_DIARY,
      "pages/stray.md": pieceFile("day_000009", "Stray"),
      "pages/03-may/notes.txt": "a folder that's no month",
      "pages/01-march/_month.yaml": lines("id: mon_000001", "days: [day_000001]"),
    });
    expect(codes(book)).toEqual(expect.arrayContaining([
      "E_MISPLACED Day files must be inside a month folder",
      "E_MISPLACED Folder has no _month.yaml",
      "E_ORDER_MISSING Day day_000002 is not listed in pages/01-march/_month.yaml",
    ]));
  });

  it("checks its files against schemas made from its levels", async () => {
    expect(schemaFor("month", diary)).toMatchObject({ title: "_month.yaml", required: ["id", "days"] });
    expect(schemaFor("manuscript-order", diary)).toMatchObject({ title: "pages/_order.yaml", properties: { months: {} } });
    const empty = await load(diary, { ...A_DIARY, "pages/_order.yaml": lines("{}") });
    expect(codes(empty)).toEqual(expect.arrayContaining(["E_SCHEMA Must list `months`"]));
    const novelish = await load(diary, { ...A_DIARY, "pages/_order.yaml": lines("chapters: [mon_000001]") });
    expect(codes(novelish)).toEqual(expect.arrayContaining(['W_UNKNOWN_KEY Unknown field "chapters"']));
  });

  it("compiles, its months as the book's chapters", async () => {
    const book = await load(diary, A_DIARY);
    const compiled = await compileBook(book, memorySource(A_DIARY));
    expect(compiled.chapters.map((c) => [c.heading, c.part])).toEqual([["Chapter One: March", undefined], ["Chapter Two", undefined]]);
  });
});

const A_SAGA = {
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

describe("a kind with three levels (a saga: volumes, parts, chapters)", () => {
  it("loads every level, each section before what it holds", async () => {
    const book = await load(saga, A_SAGA);
    expect(errors(book)).toEqual([]);
    expect(book.levels).toEqual(["volume", "part", "chapter"]);
    expect(book.sections.map((s) => `${s.level} ${s.title ?? "-"}`)).toEqual(["volume The North", "part Winter", "chapter Snow", "part Spring", "chapter -"]);
    expect(sectionsAt(book, "part").map((s) => s.parentId)).toEqual(["vol_000001", "vol_000001"]);
    expect(pieceSections(book).map((s) => s.id)).toEqual(["ch_000001", "ch_000002"]);
    expect(book.pieces.map((p) => p.title)).toEqual(["Drifts", "The pass", "Meltwater"]);
  });

  it("may start at an optional level further in: parts, without volumes", async () => {
    const files = Object.fromEntries(
      Object.entries(A_SAGA)
        .filter(([path]) => !path.endsWith("_volume.yaml"))
        .map(([path, text]) => [path.replace("manuscript/01-the-north/", "manuscript/"), text]),
    );
    const book = await load(saga, { ...files, "manuscript/_order.yaml": lines("parts: [pt_000001, pt_000002]") });
    expect(errors(book)).toEqual([]);
    expect(book.levels).toEqual(["part", "chapter"]);
    expect(book.sections.map((s) => s.title ?? "-")).toEqual(["Winter", "Snow", "Spring", "-"]);
  });

  it("can't skip a level in the middle, and says where things are misplaced", async () => {
    const book = await load(saga, {
      ...A_SAGA,
      "manuscript/02-loose/_chapter.yaml": lines("id: ch_000009", "scenes: []"),
      "manuscript/01-the-north/03-stray/_chapter.yaml": lines("id: ch_000008", "scenes: []"),
    });
    expect(codes(book)).toEqual(expect.arrayContaining([
      "E_MISPLACED Chapter folder at the top level of a book organised in volumes",
      "E_MISPLACED Folder inside a volume has no _part.yaml",
    ]));
  });

  it("warns, level by level, where a file's number disagrees with its place", async () => {
    const book = await load(saga, {
      ...A_SAGA,
      "manuscript/01-the-north/_volume.yaml": lines("id: vol_000001", "title: The North", "parts: [pt_000002, pt_000001]"),
    });
    expect(codes(book).filter((c) => c.startsWith("W_FILENAME_ORDER"))).toEqual([
      'W_FILENAME_ORDER Part folder "02-spring" is number 1 in reading order',
      'W_FILENAME_ORDER Part folder "01-winter" is number 2 in reading order',
    ]);
  });

  it("reads the same once it's been through JSON, as the browser has it: sections by ID, not by object", async () => {
    const book = JSON.parse(JSON.stringify(await load(saga, A_SAGA))) as Book;
    expect(sceneColumns(book, book.pieces).chapters.map((c) => [c.title, c.span])).toEqual([["Snow", 2], ["Chapter 2", 1]]);
    expect(sceneColumns(book, book.pieces).parts.map((p) => [p.part.title, p.span])).toEqual([["Winter", 2], ["Spring", 1]]);
    expect(chapterTitle(book, sectionById(book, "ch_000002")!)).toBe("Chapter 2");
  });

  it("has a schema for each level, a title required where the level says", () => {
    expect(schemaFor("volume", saga)).toMatchObject({ required: ["id", "title", "parts"] });
    expect(schemaFor("part", saga)).toMatchObject({ required: ["id", "title", "chapters"] });
    expect(schemaFor("chapter", saga)).toMatchObject({ required: ["id", "scenes"] });
    expect(schemaFor("manuscript-order", saga)).toMatchObject({ description: "Top-level reading order: exactly one of volumes or parts or chapters." });
  });
});
