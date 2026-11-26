import type { OperationResult } from "@writer/client";
import { api } from "@writer/web/api.ts";

/*
 * Mood boards' routes (#207), under /api/novels/:id/mood-board: a new board, renamed or deleted, each one
 * commit. Placing, ordering and taking off cards are saves of the board's file (changeBoard).
 */

const MODULE = "mood-board";
const at = (id: string) => `boards/${encodeURIComponent(id)}`;

export const boards = {
  create: (novelId: string, title: string) => api.module<OperationResult & { id: string; file: string }>(novelId, MODULE, "POST", "boards", { title }),
  rename: (novelId: string, id: string, title: string) => api.module<OperationResult & { file: string }>(novelId, MODULE, "PATCH", at(id), { title }),
  delete: (novelId: string, id: string) => api.module<OperationResult>(novelId, MODULE, "POST", `${at(id)}/delete`, {}),
};

/**
 * Change a board's file with `edit`, made on the file as it is on disk: if it changed meanwhile (on
 * another device, after a sync), the edit is made again on what's there now, so moving two different
 * cards on two devices keeps both. Returns the file as written.
 */
export async function changeBoard(novelId: string, file: string, edit: (text: string) => string): Promise<string> {
  for (let tries = 0; tries < 4; tries++) {
    const current = await api.readFile(novelId, file);
    const next = edit(current.content);
    if (next === current.content) return next;
    const written = await api.writeFile(novelId, file, next, current.hash);
    if (written.ok) return next;
  }
  throw new Error("The board kept changing as it was saved: try again.");
}
