import { afterAll, describe, expect, it } from "vitest";
import { Library, Workspaces } from "../src/index.ts";
import { scratch } from "./fixtures.ts";

const { fresh, cleanUp } = scratch("sync-status");
afterAll(() => cleanUp());

describe("a book's sync status", () => {
  // A read under way as the first sync ran answered after the one that said the book was local, and
  // the page kept "Syncing…" for good (#93): each says how many changes came before it was read.
  it("counts the changes before it was read, so an older read can be told from a newer one", async () => {
    const library = await Library.open({ configDir: fresh("config"), cloneDir: fresh("novels") });
    const novel = await library.create({ title: "Night Ferry" });
    const workspaces = new Workspaces(library, { sync: { intervalMs: 0 } });
    const ws = (await workspaces.get(novel.id))!;

    const before = ws.syncStatus();
    const synced = ws.syncer!.sync();
    const during = ws.syncStatus();
    await synced;
    const after = await ws.syncStatus();
    expect(after.state).toBe("local");
    expect((await before).revision).toBeLessThan((await during).revision);
    expect((await during).revision).toBeLessThan(after.revision);
    expect(new Set([(await before).run, (await during).run, after.run]).size).toBe(1);

    // Opened again, it counts afresh, as another run.
    await workspaces.close();
    const again = new Workspaces(library, { sync: { intervalMs: 0 } });
    expect((await (await again.get(novel.id))!.syncStatus()).run).not.toBe(after.run);
    await again.close();
  });
});
