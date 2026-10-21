import type { GitHubRepo, SceneStatusName } from "@writer/client";
import { api } from "@writer/web/api.ts";

/*
 * The drafting board's routes (#31), under /api/novels/:id/drafting-board: failures to sync are in the
 * status's `error`; setting up throws ApiError.
 */

/** A scene whose status was changed both in its file and on the GitHub board, to different values. */
export interface BoardConflict {
  scene: string;
  title: string;
  file: SceneStatusName;
  board: SceneStatusName;
}

/** What a sync of the board did. */
export interface BoardSummary {
  added: number;
  removed: number;
  updated: number;
  /** Status changes from the board, now in the scene files. */
  fromBoard: { scene: string; title: string; status: SceneStatusName }[];
  /** Board edits to fields the files own, put back. */
  putBack: { scene: string; title: string; fields: string[] }[];
}

export interface BoardStatus {
  repo: GitHubRepo | null;
  project: { number: number; title: string; url: string } | null;
  syncedAt: string | null;
  last: BoardSummary | null;
  conflicts: BoardConflict[];
  error?: { code: string; message: string; resetAt?: string };
  /** The project was deleted on GitHub. */
  gone?: boolean;
}

const MODULE = "drafting-board";

export const board = {
  status: (novelId: string) => api.module<BoardStatus>(novelId, MODULE, "GET", ""),
  /** Make the novel's project on GitHub (or adopt the one it has) and sync it. */
  setUp: (novelId: string) => api.module<BoardStatus>(novelId, MODULE, "POST", ""),
  sync: (novelId: string) => api.module<BoardStatus>(novelId, MODULE, "POST", "sync"),
  /** Settle a status conflict: keep the file's status, or the board's. */
  resolve: (novelId: string, scene: string, keep: "file" | "board") => api.module<BoardStatus>(novelId, MODULE, "POST", `conflicts/${encodeURIComponent(scene)}`, { keep }),
};
