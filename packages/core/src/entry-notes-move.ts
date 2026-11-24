import { editYaml, slugify, uniqueFileName, uniqueId } from "./edit.ts";
import { RECORD_PREFIXES } from "./ids.ts";
import { loadBook } from "./load.ts";
import { indexById, mentions, type Book, type Entity, type Note } from "./model.ts";
import type { FileSource } from "./source.ts";
import { vocabulary } from "./vocabulary.ts";

/*
 * D20 (#179): an entry has no notes of its own; what's said about it lives in the book's notes that
 * mention it. The move, once: each entry whose file has a body gives it to a new note, titled after
 * the entry, that starts with a mention of it, so the entry's profile lists it under In your notes.
 * The entry's file keeps its front matter byte for byte; the words are moved, never dropped.
 */

/** "entries'", "people's": a plural's possessive. */
export const pluralPossessive = (many: string) => (many.endsWith("s") ? `${many}'` : `${many}'s`);

/** A file to write, as a migration writes it. */
interface Write {
  path: string;
  content: string;
}

/** "2026-10-15T14:03:09": a moment as the writer's clock reads it (a note's `created`). */
export function localDateTime(d: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** A Markdown file's front matter, its closing line's ending included; "" when it has none. */
export function frontMatterOf(text: string): string {
  const m = /^(﻿?---[ \t]*\r?\n[\s\S]*?^---[ \t]*(?:\r?\n|$))/m.exec(text);
  return m && m.index === 0 ? m[1]! : "";
}

/** A mention of the entry, as the editor writes one: `[Ada](#char_7f3k2q)` (a name can't hold `]` there). */
export const mentionOf = (entity: Pick<Entity, "id" | "name">) => `[${entity.name.replace(/[\]\r\n]/g, "")}](#${entity.id})`;

/**
 * Whether a note is one about the entry, as the move and Add to an entry… make them: its prose starts
 * with a line that is only a mention of the entry. It holds when the entry is renamed (the ID stays).
 */
export function isNoteAbout(note: Pick<Note, "body">, id: string): boolean {
  const first = note.body.split(/\r?\n/).find((l) => l.trim());
  if (!first) return false;
  const found = mentions(first);
  return found.length === 1 && found[0]!.id === id && first.trim() === `[${found[0]!.text}](#${id})`;
}

/** The newest note about the entry (isNoteAbout), if it has one. */
export function noteAbout(book: Book, id: string): Note | undefined {
  return book.notes.filter((n) => isNoteAbout(n, id)).sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""))[0];
}

/** A new note's file: its front matter (id, title, created), then the mention of the entry, then `prose` if any. */
export function noteAboutText(entity: Pick<Entity, "id" | "name">, id: string, created: string, prose = "", eol = "\n"): string {
  const front = editYaml("", [
    { path: ["id"], value: id },
    { path: ["title"], value: entity.name },
    { path: ["created"], value: created },
  ]).replace(/\r?\n/g, eol);
  return `---${eol}${front}---${eol}${eol}${mentionOf(entity)}${eol}${prose ? `${eol}${prose}${eol}` : ""}`;
}

/**
 * What moving every entry's body into a note writes (nothing when no entry has one), and the commit's
 * message. `source` is the book as it'll be when the move is made.
 */
export async function entryNotesMove(source: FileSource, now = new Date()): Promise<{ writes: Write[]; moved: number; message: string }> {
  const book = await loadBook(source);
  const folder = book.kind.folders.notes;
  const ids = new Set(indexById(book).keys());
  const files = new Set(book.notes.map((n) => n.file.slice(folder.length + 1)));
  const created = localDateTime(now);
  const writes: Write[] = [];
  for (const entity of book.entities) {
    if (!entity.body.trim()) continue;
    const text = await source.read(entity.file);
    const front = text === undefined ? "" : frontMatterOf(text);
    // An entry's file without front matter isn't loaded as one; nothing to move without it.
    if (!text || !front) continue;
    const body = text.slice(front.length);
    const eol = body.includes("\r\n") ? "\r\n" : "\n";
    const prose = body.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd();
    const id = uniqueId(RECORD_PREFIXES.note, ids);
    ids.add(id);
    const name = uniqueFileName(slugify(entity.name) || entity.id.split("_")[1]!, ".md", files);
    files.add(name);
    writes.push({ path: entity.file, content: front }, { path: `${folder}/${name}`, content: noteAboutText(entity, id, created, prose, eol) });
  }
  const moved = writes.length / 2;
  const w = vocabulary(book.kind);
  const message = `${moved === 1 ? `${w.entity.A}'s` : `${moved} ${pluralPossessive(w.entity.many)}`} notes moved into the book's notes, each in a note that mentions it`;
  return { writes, moved, message };
}
