// @vitest-environment jsdom
import type { SyncStatus } from "@writer/client";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { api, keys } from "../src/api.ts";
import { keepSync, newerSync, syncQuery } from "../src/novel/sync-status.ts";

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

  it("an answer asked for before the stream's newer status, and come after it, leaves the stream's (#93)", async () => {
    const queryClient = new QueryClient();
    let answer!: (s: SyncStatus) => void;
    const spy = vi.spyOn(api, "sync").mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const asked = queryClient.fetchQuery(syncQuery(queryClient, "second-ferry"));
    keepSync(queryClient, "second-ferry", status("local", 2, "a"));
    answer(status("syncing", 1, "a"));
    expect((await asked).state).toBe("local");
    expect(queryClient.getQueryData<SyncStatus>(keys.sync("second-ferry"))?.state).toBe("local");
    spy.mockRestore();
  });
});
