import { editYaml, indexById, picturesShown, slugify, uniqueFileName, uniqueId, type Book } from "@writer/core";
import { body, hashText, operation, OperationError, required, type BibleOperations, type Env, type OperationResult, type ServerModule } from "@writer/server/engine";
import { BOARD, boardFile, boardsOf, type Board } from "../core/index.ts";

/*
 * Mood boards' server half (#207), under /api/novels/:id/mood-board, each change one commit:
 *
 * POST  /boards                { title } → 201 { id, file, commit }: a new board, with no cards
 * PATCH /boards/:board         { title, base? } → { file, commit }: the board renamed (its file keeps its name)
 * POST  /boards/:board/delete  { base? } → { commit }: the board's file removed, with the pictures alone only it showed
 *
 * `base` is the hash of the board's file the change was made from: a different file is 409 STALE.
 * Placing, ordering and taking off cards are saves of the board's file like any other (a card a line).
 */

function find(novel: Book, id: string): Board {
  const board = boardsOf(novel).find((b) => b.id === id);
  if (!board) throw new OperationError("NOT_FOUND", `There's no board ${id}.`);
  return board;
}

export class BoardOperations {
  readonly #bible: BibleOperations;

  constructor(bible: BibleOperations) {
    this.#bible = bible;
  }

  create(title: string | undefined): Promise<OperationResult & { id: string; file: string }> {
    return this.#bible.change(async (novel) => {
      const named = required(title, "title");
      const id = uniqueId(BOARD.prefix, new Set(indexById(novel).keys()));
      const taken = new Set(novel.moduleFiles.filter((f) => f.type === BOARD.key).map((f) => f.file.slice(BOARD.folder.length + 1)));
      const file = `${BOARD.folder}/${uniqueFileName(slugify(named) || "board", ".yaml", taken)}`;
      return { writes: [{ path: file, content: boardFile({ id, title: named, cards: [] }), base: null }], message: `Boards: add “${named}”`, extra: { id, file } };
    });
  }

  rename(id: string, title: string | undefined, { base }: { base?: string } = {}): Promise<OperationResult & { file: string }> {
    return this.#bible.change(async (novel, read) => {
      const board = find(novel, id);
      const named = required(title, "title");
      const text = (await read(board.file)) ?? "";
      if (base !== undefined && hashText(text) !== base) throw new OperationError("STALE", `“${board.title}” changed since it was read.`, { path: board.file });
      return { writes: [{ path: board.file, content: editYaml(text, [{ path: ["title"], value: named }]), base: hashText(text) }], message: `Boards: rename “${board.title}” to “${named}”`, extra: { file: board.file } };
    });
  }

  /** The board's file goes, and so do the pictures alone that nothing else shows (they stay in the book's history). */
  delete(id: string, { base }: { base?: string } = {}): Promise<OperationResult> {
    return this.#bible.change(async (novel, read) => {
      const board = find(novel, id);
      const text = (await read(board.file)) ?? "";
      if (base !== undefined && hashText(text) !== base) throw new OperationError("STALE", `“${board.title}” changed since it was read.`, { path: board.file });
      const kept = picturesShown({ ...novel, moduleFiles: novel.moduleFiles.filter((f) => f.file !== board.file) });
      const alone = [...new Set(board.cards.flatMap((c) => (c.kind === "picture" && !kept.has(c.picture) ? [c.picture] : [])))];
      const pictures = [];
      for (const path of alone) if ((await read(path)) !== undefined) pictures.push({ path, content: null });
      return { writes: [{ path: board.file, content: null, base: hashText(text) }, ...pictures], message: `Boards: remove “${board.title}”`, extra: {} };
    });
  }
}

const base = (v: unknown) => (typeof v === "string" ? { base: v } : {});

export const moodBoardServer: ServerModule = {
  id: "mood-board",
  routes(routes) {
    const boards = (c: { var: Env["Variables"] }) => new BoardOperations(c.var.ws.bible);
    routes.post("/boards", async (c) => {
      const { title } = await body(c);
      return operation(c, () => boards(c).create(typeof title === "string" ? title : undefined), 201);
    });
    routes.patch("/boards/:board", async (c) => {
      const data = await body(c);
      return operation(c, () => boards(c).rename(c.req.param("board"), typeof data["title"] === "string" ? data["title"] : undefined, base(data["base"])));
    });
    routes.post("/boards/:board/delete", async (c) => {
      const data = await body(c);
      return operation(c, () => boards(c).delete(c.req.param("board"), base(data["base"])));
    });
  },
};
