import { passagesOf, type Book, type Passage } from "@writer/core";
import { joinSceneFile } from "@writer/editor";
import type { Workspace } from "../novel/workspace.ts";

/*
 * Link it (#154): a name written without a link, from an entry's Appears in, made a mention in its
 * piece, `[words](#id)`, as the editor writes one. Only those bytes change; the piece's characters or
 * locations gain the entry as they do when it's linked in the text (the workspace's mention rule).
 */

/** Where a passage still is in a piece's Markdown as it reads now: the same place, or found again by its block or its sentence. */
function findAgain(book: Book, passage: Passage, id: string, body: string): Passage | undefined {
  if (body === passage.piece.body) return passage;
  const now = passagesOf({ ...book, pieces: [{ ...passage.piece, body }] }, id).filter((p) => !p.linked);
  const was = passage.block;
  const sentence = (p: Passage) => p.block.text.slice(...p.block.sentence);
  const inSentence = (p: Passage) => p.block.at[0] - p.block.sentence[0];
  return (
    // Its paragraph untouched, others changed around it.
    now.find((p) => p.block.text === was.text && p.block.nth === was.nth && p.block.at[0] === was.at[0]) ??
    // Its paragraph changed, its sentence not.
    now.find((p) => sentence(p) === sentence(passage) && inSentence(p) === inSentence(passage))
  );
}

/** The piece's Markdown with the passage's name made a mention of `id`; undefined if it's linked already or reads differently now. */
export function linkedBody(book: Book, passage: Passage, id: string, body: string): string | undefined {
  if (passage.linked) return undefined;
  const raw = findAgain(book, passage, id, body)?.raw;
  if (!raw) return undefined;
  const words = body.slice(...raw);
  // Plain words only: a mention's text can't hold brackets.
  if (/[[\]\n]/.test(words)) return undefined;
  return `${body.slice(0, raw[0])}[${words}](#${id})${body.slice(raw[1])}`;
}

/**
 * Link a passage's name in its piece through the workspace, as the text is edited: autosaved, refused
 * and raised as a conflict if the file changed underneath. Says how to undo it: the piece as it was,
 * byte for byte. Undefined if the passage can't be found as it was listed.
 */
export async function linkPassage(workspace: Workspace, book: Book, passage: Passage, id: string): Promise<(() => void) | undefined> {
  const path = passage.piece.file;
  await workspace.open([path]);
  const before = workspace.store.getState().files[path];
  const body = workspace.current(path);
  if (!before || body === undefined) return undefined;
  const linked = linkedBody(book, passage, id, body);
  if (linked === undefined) return undefined;
  const was = joinSceneFile({ ...before, body });
  workspace.change(path, linked);
  return () => workspace.replace(path, was);
}
