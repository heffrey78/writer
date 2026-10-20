import type { DeleteResult, OperationResult, Reference } from "@writer/client";
import { api } from "@writer/web/api.ts";
import type { EventFields } from "../core/index.ts";

/*
 * Off-page events' routes (#33), under /api/novels/:id/off-page-events: each change one commit. A novel
 * in format v1 is refused (NEEDS_MIGRATION) unless `migrate`, which moves it to v2 in the same commit.
 */

export type { EventFields };

/** How an event change goes: `base`, the hash of the event's file it was made from; `migrate`, to move a novel in format v1 to v2 first. */
export interface EventChangeOptions {
  base?: string;
  migrate?: boolean;
}

const MODULE = "off-page-events";
const at = (id: string) => `events/${encodeURIComponent(id)}`;

export const events = {
  create: (novelId: string, fields: EventFields & { title: string }, { migrate }: EventChangeOptions = {}) =>
    api.module<OperationResult & { id: string; file: string }>(novelId, MODULE, "POST", "events", { ...fields, ...(migrate ? { migrate } : {}) }),
  update: (novelId: string, id: string, changes: EventFields, options: EventChangeOptions = {}) => api.module<OperationResult & { file: string }>(novelId, MODULE, "PATCH", at(id), { changes, ...options }),
  /** Refused (not thrown) when prose mentions it: the mentions come back; pass confirm to delete anyway. */
  delete: async (novelId: string, id: string, { confirm = false, ...options }: EventChangeOptions & { confirm?: boolean } = {}): Promise<DeleteResult> => {
    const data = await api.module<OperationResult & { code?: string; references?: Reference[] }>(novelId, MODULE, "POST", `${at(id)}/delete`, { confirm, ...options }, { passing: "REFERENCED" });
    return data.code === "REFERENCED" ? { ok: false, references: data.references ?? [] } : { ok: true, ...data };
  },
  /**
   * Write an event as a scene at the end of `chapter`: its details filled in, its note the synopsis. The
   * event is kept (naming the scene) or removed; removing one that prose mentions is refused (REFERENCED).
   */
  writeAsScene: (novelId: string, id: string, { chapter, keep, migrate }: { chapter: string; keep: boolean; migrate?: boolean }) =>
    api.module<OperationResult & { scene: string; file: string }>(novelId, MODULE, "POST", `${at(id)}/scene`, { chapter, keep, ...(migrate ? { migrate } : {}) }),
  /** A note made into an event: its title, and its prose the event's note; the note kept (naming it) or removed. */
  fromNote: (novelId: string, note: string, { keep, migrate }: { keep: boolean; migrate?: boolean }) =>
    api.module<OperationResult & { id: string; file: string }>(novelId, MODULE, "POST", `notes/${encodeURIComponent(note)}`, { keep, ...(migrate ? { migrate } : {}) }),
};
