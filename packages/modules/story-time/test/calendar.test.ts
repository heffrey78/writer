import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer, Library, registerServerModule, sessionCookie } from "@writer/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { diaryRepo, gitIn, novelRepo, scratch } from "../../../server/test/fixtures.ts";
import { storyTimeServer } from "../src/server/index.ts";

/** When Day 1 is, through story time's server half (#30): a route under a book whose kind lists the module, and no other. */

registerServerModule(storyTimeServer);
let fresh: (name: string) => string;
let cleanUp: () => void;
beforeAll(() => ({ fresh, cleanUp } = scratch("calendar")));
afterAll(() => cleanUp());

const read = (dir: string, path: string) => readFileSync(join(dir, path), "utf8");

async function serve(dir: string) {
  const library = await Library.open({ configDir: fresh("config") });
  const book = await library.add(dir);
  const server = await createServer({ library, token: "t", sync: false, commit: false });
  const put = async (body: unknown) => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/novels/${book.id}/story-time/calendar`, {
      method: "PUT",
      headers: { cookie: `${sessionCookie(server.port)}=t`, origin: `http://127.0.0.1:${server.port}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  return { put, close: () => server.close() };
}

describe("the calendar route", () => {
  it("says when Day 1 is in novel.yaml, or that it has no date, one commit each (heffrey78/gh-writer#239)", async () => {
    const dir = novelRepo(fresh("calendar"));
    const { put, close } = await serve(dir);
    try {
      expect((await put({ start: "2026-10-10" })).status).toBe(200);
      expect(read(dir, "novel.yaml")).toMatch(/calendar:\n {2}start: 2026-10-10\n/);
      expect(gitIn(dir, "log", "-1", "--format=%s").trim()).toBe("Set when Day 1 is");
      await put({ start: "2026-07-01" });
      expect(read(dir, "novel.yaml")).toMatch(/calendar:\n {2}start: 2026-07-01\n/);
      for (const bad of [{ start: "10 Oct" }, { start: "2026-13-40" }, { start: 5 }, {}]) expect(await put(bad)).toMatchObject({ status: 400, json: { code: "BAD_REQUEST" } });
      await put({ start: null });
      expect(read(dir, "novel.yaml")).not.toContain("calendar");
      expect(gitIn(dir, "log", "-1", "--format=%s").trim()).toBe("Day 1 has no date");
    } finally {
      await close();
    }
  });

  it("isn't there for a book whose kind has no story time", async () => {
    const dir = diaryRepo(fresh("diary"));
    const { put, close } = await serve(dir);
    try {
      expect(await put({ start: "2026-10-10" })).toMatchObject({ status: 404, json: { code: "NOT_FOUND" } });
      expect(read(dir, "book.yaml")).not.toContain("calendar");
    } finally {
      await close();
    }
  });
});
