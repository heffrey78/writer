import { fileURLToPath } from "node:url";
import { compileBook, kindByKey, layoutOf, loadBook, PLAIN_LAYOUT, type BookKind } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { novel as novelKind } from "@writer/kinds";
import { describe, expect, it } from "vitest";
import { MANUSCRIPT, numberWords } from "../src/core/index.ts";

/** Standard manuscript format as a module (#32): the Novel's layout as before, and a kind without it compiles plainly. */

const sample = fileURLToPath(new URL("../../../../examples/sample-novel/", import.meta.url));
/** The Novel without manuscript format. */
const plain: BookKind = { ...novelKind, key: "plain-compile", modules: ["point-of-view", "plotlines", "presence", "off-page-events", "story-time"] };

describe("manuscript format", () => {
  it("is the Novel's layout: numbered chapters and parts, the submission title page and header, double-spaced, THE END", async () => {
    expect(layoutOf(kindByKey("novel"))).toBe(MANUSCRIPT);
    const book = await compileBook(await loadBook(nodeSource(sample)), nodeSource(sample));
    expect(book.chapters[0]).toMatchObject({ heading: "Chapter One: Arrival", part: { heading: "Part One", title: "Return" } });
    expect(book).toMatchObject({ runningHead: "sample / BRIDGE AT VARN / ", end: "THE END", spacing: 2, titlePage: { contact: ["Writer sample"], wordCount: expect.stringMatching(/^about \d+ words$/) } });
  });

  it("isn't there for a kind without it, which compiles in the plain layout, in its own words", async () => {
    expect(layoutOf(plain)).toBe(PLAIN_LAYOUT);
    // A kind naming a layout none of its modules brings has the plain one too.
    expect(layoutOf({ ...plain, compileLayout: "manuscript" })).toBe(PLAIN_LAYOUT);
    const novel = await loadBook(nodeSource(sample), plain);
    const book = await compileBook(novel, nodeSource(sample));
    expect(book.chapters.map((c) => c.heading).slice(0, 2)).toEqual(["Arrival", "Old Debts"]);
    // A part with a title is headed by it.
    expect(book.chapters[0]!.part?.heading).toBe("Return");
    expect(book).toMatchObject({ runningHead: "", spacing: 1.5, titlePage: { contact: [], wordCount: undefined } });
    expect(book.end).toBeUndefined();
  });

  it("writes chapter numbers in words", () => {
    expect([1, 12, 20, 21, 42, 99, 100, 101, 345].map(numberWords)).toEqual(["One", "Twelve", "Twenty", "Twenty-One", "Forty-Two", "Ninety-Nine", "One Hundred", "One Hundred One", "Three Hundred Forty-Five"]);
  });
});
