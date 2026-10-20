import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EVENT_FILES_FORMAT, loadBook, memorySource, migration, type Migration } from "../src/index.ts";

const SAMPLE = fileURLToPath(new URL("../../../examples/sample-novel", import.meta.url));

/** Every file of a folder, by repository path. */
function filesOf(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (e.isFile()) out[join(e.parentPath, e.name).slice(root.length + 1)] = readFileSync(join(e.parentPath, e.name), "utf8");
  }
  return out;
}

/** The files after a migration's writes. */
function applied(files: Record<string, string>, m: Migration): Record<string, string> {
  if (m.status !== "migrate") throw new Error(`No migration: ${m.status}`);
  const out = { ...files };
  for (const w of m.writes) {
    if (w.content === null) delete out[w.path];
    else out[w.path] = w.content;
  }
  return out;
}

const V1 = "schema_version: 1\nid: nv_4k8h2c\ntitle: Tiny\n";

describe("migration to format v2 (D11)", () => {
  // What the Novel's modules do of it (off-page events as files) is theirs, and tested with them.
  it("sets the version, and moves nothing of a novel without modules' files to move", async () => {
    const m = await migration(memorySource({ "novel.yaml": V1 }), EVENT_FILES_FORMAT);
    expect(m.status === "migrate" && m.writes).toEqual([{ path: "novel.yaml", content: "schema_version: 2\nid: nv_4k8h2c\ntitle: Tiny\n" }]);
  });

  it("has nothing to do for a novel in format v2", async () => {
    expect(await migration(memorySource({ "novel.yaml": V1.replace("1", "2") }), EVENT_FILES_FORMAT)).toEqual({ status: "current" });
  });

  it("refuses a newer format, and a book with no manifest", async () => {
    const reason = async (files: Record<string, string>) => {
      const m = await migration(memorySource(files), EVENT_FILES_FORMAT);
      return m.status === "refused" ? m.reason : m.status;
    };
    expect(await reason({ "novel.yaml": V1.replace("1", "3") })).toMatch(/says format v3, which keeps a book's settings in book.yaml/);
    expect(await reason({ "book.yaml": "schema_version: 4\nkind: novel\nid: nv_4k8h2c\ntitle: Tiny\n" })).toMatch(/format v4, newer than this Writer/);
    expect(await reason({})).toMatch(/no book.yaml or novel.yaml/);
  });
});

describe("migration to format v3 (D15)", () => {
  const V2 = "# The book's settings.\nschema_version: 2\nid: nv_4k8h2c # never changes\ntitle: Tiny\n";

  it("moves novel.yaml to book.yaml, naming the kind after the version, keeping every other byte", async () => {
    const m = await migration(memorySource({ "novel.yaml": V2 }));
    expect(m).toMatchObject({ status: "migrate", from: 2, to: 3, message: "Format v3: the book's settings in book.yaml, naming its kind" });
    expect(m.status === "migrate" && m.writes).toEqual([
      { path: "novel.yaml", content: null },
      { path: "book.yaml", content: "# The book's settings.\nschema_version: 3\nkind: novel\nid: nv_4k8h2c # never changes\ntitle: Tiny\n" },
    ]);
  });

  it("gives the sample, moved, the same model as before, now with book.yaml as its manifest", async () => {
    const before = filesOf(SAMPLE);
    const after = applied(before, await migration(memorySource(before)));
    const [a, b] = await Promise.all([loadBook(memorySource(before)), loadBook(memorySource(after))]);
    expect(b.diagnostics).toEqual([]);
    expect([a.manifest, b.manifest]).toEqual(["novel.yaml", "book.yaml"]);
    const { manifest: _a, config: ca, ...restA } = a;
    const { manifest: _b, config: cb, ...restB } = b;
    expect(restB).toEqual(restA);
    expect(cb).toEqual({ ...ca, schema_version: 3, kind: "novel" });
  });

  it("has nothing to do for a book in format v3", async () => {
    expect(await migration(memorySource({ "book.yaml": "schema_version: 3\nkind: novel\nid: nv_4k8h2c\ntitle: Tiny\n" }))).toEqual({ status: "current" });
  });
});
