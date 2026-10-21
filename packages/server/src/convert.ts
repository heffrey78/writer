import { conversionsOf, knownKind, loadBook, SCHEMA_VERSION, type Conversion } from "@writer/core";
import { snapshots } from "@writer/core/snapshots";
import { filesUnder, readToolBytes, sameBytes, TOOLS_DIR, WORKFLOWS_DIR } from "./files.ts";
import { bookSource, filesPort, gitPort } from "./ports.ts";
import { migrationWrites, overlay } from "./migrate.ts";
import { DEFAULT_TEMPLATE, TEMPLATES, templateOf } from "./new-book.ts";
import { OperationError, transaction, type FileWrite, type OperationResult } from "./operations.ts";

/*
 * Making a book of one kind into another (#39), through its kind's modules' conversions: a novel kept
 * as a journal, made a Journal. One commit: the book moved to the newest format first where it needs
 * it, the conversion's writes, its diagrams redrawn as the new kind draws them (the old kind's
 * snapshots that are no more, removed), and the new kind's tools and workflows in place of the old's.
 */

/** The conversions a book can have, as its commands offer them. */
export async function conversionsFor(root: string): Promise<Conversion[]> {
  return conversionsOf((await loadBook(bookSource(root))).kind);
}

/** Make the book at `root` a book of the kind `to`, in one commit; the notes say what it did that the writer should know. */
export async function convertBook(root: string, to: string, templates = TEMPLATES): Promise<OperationResult & { notes: string[] }> {
  if (!knownKind(to)) throw new OperationError("BAD_REQUEST", `Writer has no kind of book “${to}”.`);
  // On the book as format 3 has it: book.yaml, naming its kind.
  const { migration, writes: moved } = await migrationWrites(root, DEFAULT_TEMPLATE, SCHEMA_VERSION);
  if (migration.status === "refused") throw new OperationError("BAD_REQUEST", migration.reason);
  const before = overlay(bookSource(root), moved);
  const book = await loadBook(before);
  const conversion = conversionsOf(book.kind).find((c) => c.to === to);
  if (!conversion) throw new OperationError("BAD_REQUEST", `${book.kind.label} can't be made a ${knownKind(to)!.label.toLowerCase()}.`);
  const done = await conversion.run(before, book);
  if ("refused" in done) throw new OperationError("BAD_REQUEST", done.refused);

  const writes: FileWrite[] = [...moved.filter((w) => !done.writes.some((d) => d.path === w.path)), ...done.writes];
  // Its diagrams, as the new kind draws them.
  const after = await loadBook(overlay(bookSource(root), writes));
  const drawn = snapshots(after);
  for (const [path, content] of drawn) if ((await overlay(bookSource(root), writes).read(path)) !== content) writes.push({ path, content, ...(path.endsWith(".svg") ? { tool: true as const } : {}) });
  for (const e of await filesPort().list(filesPort().join(root, "diagrams"))) {
    const path = `diagrams/${e.path}`;
    if (e.path.endsWith(".svg") && !drawn.has(path)) writes.push({ path, content: null, tool: true });
  }
  // The new kind's tools and workflows, and none left of the old kind's that it hasn't.
  writes.push(...(await kindFiles(root, templateOf(book.kind.key, templates), templateOf(to, templates))));
  const result = await transaction(root, writes, `${conversion.label.replace(/…$/, "")}${migration.status === "migrate" ? ` (${migration.message})` : ""}`);
  // What kept the old kind's empty folders in git (.gitkeep, which a book's files don't include), gone
  // with them, in the same commit.
  const git = gitPort();
  const left = (await git.listFiles(root, [book.kind.folders.content, book.kind.folders.codex])).filter((f) => f.endsWith("/.gitkeep"));
  if (result.commit && left.length) {
    await git.remove(root, left);
    result.commit = await git.amend(root);
  }
  return { ...result, notes: done.notes };
}

async function kindFiles(root: string, from: string, to: string): Promise<FileWrite[]> {
  const writes: FileWrite[] = [];
  for (const dir of [TOOLS_DIR, WORKFLOWS_DIR]) {
    const files = filesPort();
    const theirs = new Set(await filesUnder(files.join(to, dir)));
    for (const name of theirs) {
      const path = `${dir}/${name}`;
      const bytes = (await files.read(files.join(to, dir, name)))!;
      const current = await readToolBytes(root, path).catch(() => undefined);
      if (!current || !sameBytes(current.bytes, bytes)) writes.push({ path, content: new Uint8Array(bytes), tool: true });
    }
    // What the old kind's template brought that the new one hasn't: an author's own workflows stay.
    for (const name of await filesUnder(files.join(from, dir))) if (!theirs.has(name) && (await readToolBytes(root, `${dir}/${name}`).catch(() => undefined))) writes.push({ path: `${dir}/${name}`, content: null, tool: true });
  }
  return writes;
}
