import { editYaml } from "./edit.ts";
import { kindByKey, V2_KIND } from "./kinds.ts";
import { EVENT_FILES_FORMAT, MANIFEST, NOVEL_MANIFEST, readManifest, SCHEMA_VERSION } from "./manifest.ts";
import { modulesOf } from "./modules.ts";
import { parseYaml } from "./parse.ts";
import type { FileSource } from "./source.ts";

/*
 * Moving a book to a newer format. Format 2 changed how a module keeps its files: the off-page-events
 * module gives each event a file of its own (D11), its step of the move. Format 3 moves a novel's
 * novel.yaml to book.yaml, which names the kind of book it is (D15). The result is the files to
 * write, for the caller to commit as one change.
 */

/** A file to write, or to remove (content null). */
export interface MigrationWrite {
  path: string;
  content: string | null;
}

export type Migration =
  | { status: "current" }
  | { status: "refused"; reason: string }
  | { status: "migrate"; from: number; to: number; writes: MigrationWrite[]; message: string };

/**
 * What moving the book in `source` to format `to` (the newest by default) would write, or why it
 * can't be. Each module of the Novel moves its own files to format 2 (D11); format 3 moves novel.yaml to
 * book.yaml, naming the kind of book it is (D15). An event change needs only format 2.
 */
export async function migration(source: FileSource, to = SCHEMA_VERSION): Promise<Migration> {
  if ((await source.read(MANIFEST)) !== undefined) {
    const manifest = await readManifest(source);
    if (manifest!.version > SCHEMA_VERSION) return { status: "refused", reason: `This book is in format v${manifest!.version}, newer than this Writer (v${SCHEMA_VERSION}).` };
    return { status: "current" };
  }
  // Only novels were ever in formats 1 and 2.
  const kind = kindByKey(V2_KIND);
  const novelText = await source.read(NOVEL_MANIFEST);
  if (novelText === undefined) return { status: "refused", reason: `There's no ${MANIFEST} or ${NOVEL_MANIFEST} here.` };
  const novel = parseYaml(novelText, NOVEL_MANIFEST);
  if (novel.diagnostics.length || !isObject(novel.data)) return { status: "refused", reason: `${NOVEL_MANIFEST} can't be read: fix it first (writer validate).` };
  const from = typeof novel.data["schema_version"] === "number" ? novel.data["schema_version"] : 1;
  if (from > EVENT_FILES_FORMAT) return { status: "refused", reason: `${NOVEL_MANIFEST} says format v${from}, which keeps a book's settings in ${MANIFEST}: fix it first (writer validate).` };
  if (from >= to) return { status: "current" };

  const writes: MigrationWrite[] = [];
  const steps: string[] = [];
  let manifest = novelText;
  for (const m of modulesOf(kind).flatMap((module) => module.migrations ?? [])) {
    if (from >= m.format || m.format > to) continue;
    const done = await m.run(source, kind, novel.data);
    if ("refused" in done) return { status: "refused", reason: done.refused };
    writes.push(...done.writes);
    steps.push(m.step);
  }
  manifest = editYaml(manifest, [{ path: ["schema_version"], value: to }]);
  if (to >= SCHEMA_VERSION) {
    // The settings as they were, every byte, in book.yaml, which says what kind of book this is.
    const at = /^schema_version:.*(?:\r?\n|$)/m.exec(manifest);
    manifest = at ? manifest.slice(0, at.index + at[0].length) + `kind: ${V2_KIND}\n` + manifest.slice(at.index + at[0].length) : `kind: ${V2_KIND}\n${manifest}`;
    writes.push({ path: NOVEL_MANIFEST, content: null }, { path: MANIFEST, content: manifest });
    steps.push(`the book's settings in ${MANIFEST}, naming its kind`);
  } else {
    writes.push({ path: NOVEL_MANIFEST, content: manifest });
  }
  return { status: "migrate", from, to, writes, message: `Format v${to}: ${steps.join(", and ")}` };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
