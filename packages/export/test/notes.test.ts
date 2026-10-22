import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compileBook, loadBook, memorySource, type CompiledBook } from "@writer/core";
import { strFromU8, unzipSync } from "fflate";
import { JSDOM } from "jsdom";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { toDocx, toEpub, toPdf } from "../src/index.ts";

/** Footnotes in every format (#58): Word's own footnotes, the e-book's linked notes, the PDF's notes after each chapter. */

const ROOT = fileURLToPath(new URL("../../../examples/sample-novel/", import.meta.url));
const files: Record<string, string> = Object.fromEntries(
  readdirSync(ROOT, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => [relative(ROOT, join(e.parentPath, e.name)), readFileSync(join(e.parentPath, e.name), "utf8")]),
);
const STATION = "manuscript/01-return/01-arrival/01-the-station.md";
const BRIDGE = "manuscript/01-return/01-arrival/02-the-bridge.md";
const body = (path: string, text: string) => files[path]!.replace(/\n---\n[\s\S]*$/, `\n---\n${text}`);
const DATE = new Date("2026-10-22T12:00:00Z");

async function compiled(overrides: Record<string, string>): Promise<CompiledBook> {
  const source = memorySource({ ...files, ...overrides });
  return compileBook(await loadBook(source), source);
}
const book = await compiled({
  [STATION]: body(STATION, "The clock ran four minutes fast.[^1]\n\nIt always had.[^1]\n\n[^1]: By the station master's *watch*.\n"),
  [BRIDGE]: body(BRIDGE, "Nine piers.[^p]\n\n[^p]: Counted from the town side.\n"),
});
const plain = await compiled({});
const parts = (bytes: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, strFromU8(v)]));
const parse = (text: string) => new new JSDOM("").window.DOMParser().parseFromString(text, "application/xml");

describe("footnotes in a Word file", () => {
  const docx = parts(toDocx(book, { date: DATE }));

  it("are Word's own: referred to from the text, at the foot of the page, with their separators", () => {
    const refs = [...docx["word/document.xml"]!.matchAll(/<w:footnoteReference w:id="(\d+)"\/>/g)].map((m) => m[1]);
    expect(refs).toEqual(["1", "1", "2"]);
    const notes = parse(docx["word/footnotes.xml"]!);
    const footnotes = [...notes.getElementsByTagName("w:footnote")];
    expect(footnotes.map((f) => [f.getAttribute("w:id"), f.getAttribute("w:type")])).toEqual([["-1", "separator"], ["0", "continuationSeparator"], ["1", null], ["2", null]]);
    expect(footnotes[2]!.textContent).toBe(" By the station master's watch.");
    expect(footnotes[2]!.getElementsByTagName("w:footnoteRef")).toHaveLength(1);
    expect(footnotes[2]!.getElementsByTagName("w:i")).toHaveLength(1);
    expect(footnotes[3]!.textContent).toBe(" Counted from the town side.");
  });

  it("are declared in the package, its settings and styles; a book without them has none of it", () => {
    expect(docx["[Content_Types].xml"]).toContain('PartName="/word/footnotes.xml"');
    expect(docx["word/_rels/document.xml.rels"]).toContain('Target="footnotes.xml"');
    expect(docx["word/settings.xml"]).toContain('<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>');
    expect(docx["word/styles.xml"]).toContain('w:styleId="FootnoteText"');
    expect(docx["word/styles.xml"]).toContain('w:styleId="FootnoteReference"');
    for (const [path, xml] of Object.entries(docx)) expect(() => parse(xml), path).not.toThrow();

    const without = parts(toDocx(plain, { date: DATE }));
    expect(Object.keys(without)).not.toContain("word/footnotes.xml");
    expect(Object.values(without).join("")).not.toMatch(/footnote/i);
  });
});

describe("footnotes in an e-book", () => {
  const epub = parts(toEpub(book, { date: DATE }));
  const chapter = epub["OEBPS/chapter-001.xhtml"]!;

  it("are the chapter's notes after its text, each reference linked to its note and the note back", () => {
    const doc = parse(chapter);
    const refs = [...doc.querySelectorAll('a[*|type="noteref"]')].map((a) => [a.getAttribute("href"), a.getAttribute("id"), a.textContent]);
    expect(refs).toEqual([
      ["#note-1", "noteref-1", "1"],
      ["#note-1", null, "1"],
      ["#note-2", "noteref-2", "2"],
    ]);
    const notes = [...doc.querySelectorAll('section[*|type="endnotes"] li')];
    expect(notes.map((n) => [n.getAttribute("id"), n.querySelector("p")!.textContent])).toEqual([
      ["note-1", "By the station master's watch."],
      ["note-2", "Counted from the town side."],
    ]);
    expect(notes.map((n) => n.querySelector('a[role="doc-backlink"]')!.getAttribute("href"))).toEqual(["#noteref-1", "#noteref-2"]);
    // Every ID once.
    const ids = [...doc.querySelectorAll("[id]")].map((e) => e.getAttribute("id"));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("are styled only in a book that has them", () => {
    expect(epub["OEBPS/style.css"]).toContain(".notes");
    expect(parts(toEpub(plain, { date: DATE }))["OEBPS/style.css"]).not.toContain(".notes");
  });
});

describe("footnotes in a PDF", () => {
  it("follow the chapter's text as its notes", async () => {
    const { pdf } = await toPdf(book, { date: DATE });
    const doc = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: false }).promise;
    let text = "";
    for (let i = 1; i <= doc.numPages; i++) text += `${(await (await doc.getPage(i)).getTextContent()).items.map((x) => ("str" in x ? x.str : "")).join("")}\n`;
    const notes = text.indexOf("Notes");
    expect(notes).toBeGreaterThan(text.indexOf("Nine piers."));
    expect(text.slice(notes)).toContain("1. By the station master's watch.");
    expect(text.slice(notes)).toContain("2. Counted from the town side.");
  });
});
