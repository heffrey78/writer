// @vitest-environment jsdom
import type { SyncStatus } from "@writer/client";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { keys } from "../src/api.ts";
import { keepSync, newerSync } from "../src/novel/sync-status.ts";

const status = (state: SyncStatus["state"], revision?: number, run?: string): SyncStatus => ({
  state,
  commit: { state: "idle", pendingChanges: 0 } as unknown as SyncStatus["commit"],
  ...(revision !== undefined ? { revision } : {}),
  ...(run !== undefined ? { run } : {}),
});

describe("a book's sync status, kept by the page (#93)", () => {
  it("keeps the newer of two reads, whichever answered last", () => {
    expect(newerSync(status("local", 3, "a"), status("syncing", 1, "a")).state).toBe("local");
    expect(newerSync(status("syncing", 1, "a"), status("local", 3, "a")).state).toBe("local");
    // Read with nothing changed between: the later answer.
    expect(newerSync(status("ahead", 3, "a"), status("synced", 3, "a")).state).toBe("synced");
  });

  it("takes what a server started afresh says, and an older server's status as it comes", () => {
    expect(newerSync(status("local", 40, "a"), status("synced", 2, "b")).state).toBe("synced");
    expect(newerSync(status("local", 40, "a"), status("synced")).state).toBe("synced");
    expect(newerSync(undefined, status("syncing", 1, "a")).state).toBe("syncing");
  });

  it("a stale answer after the event stream's newer one leaves the book's status as the stream said", () => {
    const queryClient = new QueryClient();
    keepSync(queryClient, "night-ferry", status("local", 2, "a"));
    keepSync(queryClient, "night-ferry", status("syncing", 1, "a"));
    expect(queryClient.getQueryData<SyncStatus>(keys.sync("night-ferry"))?.state).toBe("local");
    // Another book's status is its own.
    keepSync(queryClient, "second-ferry", status("syncing", 1, "a"));
    expect(queryClient.getQueryData<SyncStatus>(keys.sync("second-ferry"))?.state).toBe("syncing");
  });
});
