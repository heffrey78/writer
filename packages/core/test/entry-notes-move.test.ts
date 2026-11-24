import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { frontMatterOf, isNoteAbout, loadBook, memorySource, mentionsOf, migration, noteAbout, notesMentioning, type Migration } from "../src/index.ts";

const EXAMPLES = fileURLToPath(new URL("../../../examples/", import.meta.url));
const NOW = new Date(2026, 10, 23, 21, 4, 5);

/** Every file of a folder, by repository path. */
function filesOf(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (e.isFile() && !e.parentPath.includes(`${root}/.git`)) out[join(e.parentPath, e.name).slice(root.length + 1)] = readFileSync(join(e.parentPath, e.name), "utf8");
  }
  return out;
}

function applied(files: Record<string, string>, m: Migration): Record<string, string> {
  if (m.status !== "migrate") throw new Error(`No migration: ${m.status}`);
  const out = { ...files };
  for (const w of m.writes) {
    if (w.content === null) delete out[w.path];
    else out[w.path] = w.content;
  }
  return out;
}

const BOOK = "schema_version: 3\nkind: novel\nid: nv_4k8h2c\ntitle: Tiny\n";
const ADA = "---\nid: char_7f3k2q\nname: Ada Varn\n# kept as written\nsummary: An engineer.\n---\nLeft Varn at nineteen.\n\n**Voice:** short sentences, with [Ben](#char_b3n0vs).\n";
const BEN = "---\nid: char_b3n0vs\nname: Ben\n---\n";

describe("entries' notes moved into the book's notes (D20, #181)", () => {
  it("is asked for: a format-only migration leaves a book in format 3 as it is", async () => {
    const source = memorySource({ "book.yaml": BOOK, "bible/characters/ada.md": ADA });
    expect(await migration(source)).toEqual({ status: "current" });
    expect(await migration(source, 2, { entryNotes: true })).toEqual({ status: "current" });
  });

  it("empties the entry's file to its front matter, byte for byte, and puts its words in a note that mentions it first", async () => {
    const m = await migration(memorySource({ "book.yaml": BOOK, "bible/characters/ada.md": ADA, "bible/characters/ben.md": BEN }), undefined, { entryNotes: true, now: NOW });
    expect(m).toMatchObject({ status: "migrate", from: 3, to: 3, message: "An entry's notes moved into the book's notes, each in a note that mentions it" });
    if (m.status !== "migrate") return;
    expect(m.writes.map((w) => w.path)).toEqual(["bible/characters/ada.md", "notes/ada-varn.md"]);
    expect(m.writes[0]!.content).toBe(ADA.slice(0, ADA.indexOf("Left")));
    expect(m.writes[1]!.content).toMatch(
      /^---\nid: note_[0-9a-hjkmnp-tv-z]{6}\ntitle: Ada Varn\ncreated: 2026-11-23T21:04:05\n---\n\n\[Ada Varn\]\(#char_7f3k2q\)\n\nLeft Varn at nineteen\.\n\n\*\*Voice:\*\* short sentences, with \[Ben\]\(#char_b3n0vs\)\.\n$/,
    );
  });

  it("leaves the note on the entry's profile, and the mentions it made still found", async () => {
    const files = { "book.yaml": BOOK, "bible/characters/ada.md": ADA, "bible/characters/ben.md": BEN };
    const after = await loadBook(memorySource(applied(files, await migration(memorySource(files), undefined, { entryNotes: true, now: NOW }))));
    expect(after.diagnostics.filter((d) => d.file !== "manuscript/_order.yaml")).toEqual([]);
    expect(after.entities.find((e) => e.id === "char_7f3k2q")!.body).toBe("");
    const note = notesMentioning(after, "char_7f3k2q");
    expect(note.map((n) => n.title)).toEqual(["Ada Varn"]);
    expect(noteAbout(after, "char_7f3k2q")?.id).toBe(note[0]!.id);
    expect(mentionsOf(after, "char_b3n0vs").map((r) => r.kind)).toEqual(["note"]);
  });

  it("keeps CRLF line endings, and a file name no other note has", async () => {
    const crlf = ADA.replace(/\n/g, "\r\n");
    const m = await migration(memorySource({ "book.yaml": BOOK, "bible/characters/ada.md": crlf, "notes/ada-varn.md": "---\nid: note_aaaaaa\ntitle: Ada Varn\n---\nMine.\n" }), undefined, { entryNotes: true, now: NOW });
    if (m.status !== "migrate") throw new Error(m.status);
    expect(m.writes[0]!.content).toBe(frontMatterOf(crlf));
    expect(m.writes[1]!.path).toBe("notes/ada-varn-2.md");
    expect(m.writes[1]!.content).not.toMatch(/[^\r]\n/);
  });

  it("moves a gh-writer novel's notes along with its format, in one migration", async () => {
    const m = await migration(memorySource({ "novel.yaml": "schema_version: 2\nid: nv_4k8h2c\ntitle: Tiny\n", "bible/characters/ada.md": ADA }), undefined, { entryNotes: true, now: NOW });
    expect(m).toMatchObject({ status: "migrate", from: 2, to: 3 });
    if (m.status !== "migrate") return;
    expect(m.message).toBe("Format v3: the book's settings in book.yaml, naming its kind, and an entry's notes moved into the book's notes, each in a note that mentions it");
    expect(m.writes.map((w) => w.path)).toEqual(["novel.yaml", "book.yaml", "bible/characters/ada.md", "notes/ada-varn.md"]);
  });

  it("loses no words from any sample book: every body is in a note about its entry, and nothing else changes", async () => {
    for (const name of readdirSync(EXAMPLES)) {
      const before = filesOf(join(EXAMPLES, name));
      const m = await migration(memorySource(before), undefined, { entryNotes: true, now: NOW });
      if (m.status === "current") continue;
      const [a, b] = await Promise.all([loadBook(memorySource(before)), loadBook(memorySource(applied(before, m)))]);
      expect(b.diagnostics.filter((d) => d.severity === "error"), name).toEqual([]);
      for (const e of a.entities.filter((e) => e.body.trim())) {
        const note = noteAbout(b, e.id);
        expect(note?.body.replace(/\r\n/g, "\n"), `${name}: ${e.name}`).toContain(e.body.replace(/\r\n/g, "\n").trim());
        expect(b.entities.find((x) => x.id === e.id)).toEqual({ ...e, body: "", bodyLine: expect.any(Number) });
      }
      expect(b.notes.length - a.notes.length).toBe(a.entities.filter((e) => e.body.trim()).length);
    }
  });

  it("knows a note about an entry by its first line, a mention of it alone, whatever the entry's name now", () => {
    expect(isNoteAbout({ body: "\n[Ada](#char_7f3k2q)\n\nWords." }, "char_7f3k2q")).toBe(true);
    expect(isNoteAbout({ body: "[Ada](#char_7f3k2q) said so." }, "char_7f3k2q")).toBe(false);
    expect(isNoteAbout({ body: "[Ben](#char_b3n0vs)" }, "char_7f3k2q")).toBe(false);
    expect(isNoteAbout({ body: "" }, "char_7f3k2q")).toBe(false);
  });

  it("makes a note about any name that reads back as about its entry", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 40 }), fc.string({ maxLength: 200 }), async (name, words) => {
        const prose = words.replace(/\r/g, "").trim() || "Words.";
        const entry = `---\nid: char_7f3k2q\nname: ${JSON.stringify(name)}\n---\n${prose}\n`;
        const files = { "book.yaml": BOOK, "bible/characters/x.md": entry };
        const before = await loadBook(memorySource(files));
        if (before.diagnostics.some((d) => d.severity === "error") || !before.entities[0]?.body.trim()) return;
        const after = await loadBook(memorySource(applied(files, await migration(memorySource(files), undefined, { entryNotes: true, now: NOW }))));
        expect(noteAbout(after, "char_7f3k2q")).toBeDefined();
        expect(after.notes[0]!.title).toBe(before.entities[0]!.name);
      }),
      { numRuns: 60 },
    );
  });
});
