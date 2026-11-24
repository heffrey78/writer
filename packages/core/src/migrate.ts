import { editYaml } from "./edit.ts";
import { entryNotesMove } from "./entry-notes-move.ts";
import { kindByKey, V2_KIND } from "./kinds.ts";
import { EVENT_FILES_FORMAT, MANIFEST, NOVEL_MANIFEST, readManifest, SCHEMA_VERSION } from "./manifest.ts";
import { modulesOf } from "./modules.ts";
import { parseYaml } from "./parse.ts";
import type { FileSource } from "./source.ts";

/*
 * Moving a book to a newer format. Format 2 changed how a module keeps its files: the off-page-events
 * module gives each event a file of its own (D11), its step of the move. Format 3 moves a novel's
 * novel.yaml to book.yaml, which names the kind of book it is (D15). Asked to (`entryNotes`), a move to
 * the newest format also moves each entry's own notes into the book's notes (D20): no format number
 * says whether a book has any, so a book in the newest one is moved too when an entry still has some.
 * The result is the files to write, for the caller to commit as one change.
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

export interface MigrationOptions {
  /** Move entries' own notes into the book's notes too (D20): with `to` the book's own format, only them. */
  entryNotes?: boolean;
  /** The moment the moved notes are dated (now by default). */
  now?: Date;
}

/**
 * What moving the book in `source` to format `to` (the newest by default) would write, or why it
 * can't be. Each module of the Novel moves its own files to format 2 (D11); format 3 moves novel.yaml to
 * book.yaml, naming the kind of book it is (D15). An event change needs only format 2. With
 * `entryNotes`, entries' notes move into the book's notes as well (D20); a book in the newest format
 * whose entries have none is current.
 */
export async function migration(source: FileSource, to = SCHEMA_VERSION, { entryNotes = false, now }: MigrationOptions = {}): Promise<Migration> {
  /** Entries' notes alone, the book's format as it is. */
  const notesOnly = async (format: number): Promise<Migration> => {
    const move = entryNotes ? await entryNotesMove(source, now) : undefined;
    if (!move?.moved) return { status: "current" };
    return { status: "migrate", from: format, to: format, writes: move.writes, message: move.message };
  };
  if ((await source.read(MANIFEST)) !== undefined) {
    const manifest = await readManifest(source);
    if (manifest!.version > SCHEMA_VERSION) return { status: "refused", reason: `This book is in format v${manifest!.version}, newer than this Writer (v${SCHEMA_VERSION}).` };
    return notesOnly(manifest!.version);
  }
  // Only novels were ever in formats 1 and 2.
  const kind = kindByKey(V2_KIND);
  const novelText = await source.read(NOVEL_MANIFEST);
  if (novelText === undefined) return { status: "refused", reason: `There's no ${MANIFEST} or ${NOVEL_MANIFEST} here.` };
  const novel = parseYaml(novelText, NOVEL_MANIFEST);
  if (novel.diagnostics.length || !isObject(novel.data)) return { status: "refused", reason: `${NOVEL_MANIFEST} can't be read: fix it first (writer validate).` };
  const from = typeof novel.data["schema_version"] === "number" ? novel.data["schema_version"] : 1;
  if (from > EVENT_FILES_FORMAT) return { status: "refused", reason: `${NOVEL_MANIFEST} says format v${from}, which keeps a book's settings in ${MANIFEST}: fix it first (writer validate).` };
  // Already as far as asked: a gh-writer novel keeps its format, its entries' notes moved if asked.
  if (from >= to) return notesOnly(from);

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
  if (entryNotes) {
    const move = await entryNotesMove(overlay(source, writes), now);
    writes.push(...move.writes);
    if (move.moved) steps.push(move.message.charAt(0).toLowerCase() + move.message.slice(1));
  }
  return { status: "migrate", from, to, writes, message: `Format v${to}: ${steps.join(", and ")}` };
}

/** `source` as it will be once `writes` are made (a removed file reads as nothing; listings unchanged but for added files). */
function overlay(source: FileSource, writes: readonly MigrationWrite[]): FileSource {
  const changed = new Map(writes.map((w) => [w.path, w.content]));
  return {
    async list(dir) {
      const prefix = dir ? `${dir}/` : "";
      const entries = new Map((await source.list(dir)).map((e) => [e.name, e.dir]));
      for (const [path, content] of changed) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash >= 0) entries.set(rest.slice(0, slash), true);
        else if (content === null) entries.delete(rest);
        else entries.set(rest, false);
      }
      return [...entries].map(([name, isDir]) => ({ name, dir: isDir })).sort((a, b) => a.name.localeCompare(b.name));
    },
    async read(path) {
      return changed.has(path) ? (changed.get(path) ?? undefined) : source.read(path);
    },
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
