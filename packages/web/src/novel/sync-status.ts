import type { SyncStatus } from "@writer/client";
import type { QueryClient } from "@tanstack/react-query";
import { api, keys } from "../api.ts";

/*
 * A book's sync status comes three ways: asked for (GET /sync), from the book's event stream as it
 * changes, and as the answer to Sync now or Put on GitHub. The server reads each over several git
 * calls, so an older read can answer after a newer one; kept as it came, a status from during the
 * first sync ("Syncing…") could stand for good after the one that said the book is local (#93). Each
 * carries how many changes came before it was read: the page keeps the newer.
 */

/** `next`, unless `held` was read later in the same run of the server's workspace. */
export function newerSync(held: SyncStatus | undefined, next: SyncStatus): SyncStatus {
  if (!held || held.run === undefined || held.run !== next.run || held.revision === undefined || next.revision === undefined) return next;
  return held.revision > next.revision ? held : next;
}

/** Keep `status` for the book, unless what's kept is newer. */
export function keepSync(queryClient: QueryClient, novelId: string, status: SyncStatus): void {
  queryClient.setQueryData<SyncStatus>(keys.sync(novelId), (held) => newerSync(held, status));
}

/** The book's sync status, asked for: the query every page shares. */
export function syncQuery(queryClient: QueryClient, novelId: string) {
  return {
    queryKey: keys.sync(novelId),
    queryFn: async () => {
      const next = await api.sync(novelId);
      // What's kept once the answer is in: the event stream's may have come while it was asked.
      return newerSync(queryClient.getQueryData<SyncStatus>(keys.sync(novelId)), next);
    },
  };
}
