import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { kindByKey, loadBook, validate } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { createServer, Library, registerServerModule, sessionCookie } from "@writer/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gitIn, novelRepo, scratch } from "../../../server/test/fixtures.ts";
import { send } from "../../../server/test/http.ts";
import { entriesIn, entryOn, entryTitle, isDay, placeOf, today } from "../src/core/index.ts";
import { dailyServer } from "../src/server/index.ts";
import { entryHtml, newestFirst } from "../src/web/read.ts";

/** Daily writing (#38): today's entry, made where it goes once, then opened; the Journal's, and no novel's. */

registerServerModule(dailyServer);
const sample = fileURLToPath(new URL("../../../../examples/sample-journal", import.meta.url));
let fresh: (name: string) => string;
let cleanUp: () => void;
beforeAll(() => ({ fresh, cleanUp } = scratch("daily")));
afterAll(() => cleanUp());

describe("a day's entry", () => {
  it("is titled and placed by its date: in its year and month, or its month of the year", async () => {
    expect(entryTitle("2026-10-20")).toBe("Tuesday, 20 October");
    expect([isDay("2026-10-20"), isDay("2026-02-30"), isDay("20 Oct"), isDay(undefined)]).toEqual([true, false, false, false]);
    expect(today(new Date(2026, 9, 20, 23, 30))).toBe("2026-10-20");
    const journal = await loadBook(nodeSource(sample));
    expect(placeOf(journal, "2026-11-02")).toEqual(["2026", "November"]);
    expect(entryOn(journal, "2026-10-01")?.title).toBe("Thursday, 1 October");
    expect(entryOn(journal, "2026-10-02")).toBeUndefined();
    expect([...entriesIn(journal, "2026-10").keys()]).toEqual(["2026-10-01", "2026-10-03", "2026-10-04"]);
    // A journal kept in months alone (a converted one).
    expect(placeOf({ ...journal, levels: ["month"] }, "2026-10-20")).toEqual(["October 2026"]);
  });

  it("is the Journal's module, and needs story time", () => {
    expect(kindByKey("journal").modules).toContain("daily");
    expect(kindByKey("novel").modules).not.toContain("daily");
  });
});

describe("the today route", () => {
  async function serve(dir: string) {
    const library = await Library.open({ configDir: fresh("config"), cloneDir: fresh("books") });
    const book = await library.add(dir);
    const server = await createServer({ library, token: "t", sync: false, commit: false });
    const today = async (day: unknown) => {
      const r = await send(server.port, `/api/novels/${book.id}/daily/today`, { method: "POST", headers: { cookie: `${sessionCookie(server.port)}=t`, origin: server.url, "content-type": "application/json" }, body: JSON.stringify({ day }) });
      return { status: r.status, json: JSON.parse(r.body) as Record<string, unknown> };
    };
    return { library, today, close: () => server.close() };
  }

  it("makes a new journal's first entry with its year and month, in one commit, then opens it", async () => {
    const library = await Library.open({ configDir: fresh("config"), cloneDir: fresh("books") });
    const made = await library.create({ kind: "journal", title: "Days" });
    const { today, close } = await serve(made.path);
    try {
      const first = await today("2026-10-20");
      expect(first).toMatchObject({ status: 200, json: { made: true, file: "entries/01-2026/01-october/01-tuesday-20-october.md" } });
      expect(gitIn(made.path, "log", "-1", "--format=%s").trim()).toBe("Journal: add “2026”, add “October”, add entry “Tuesday, 20 October”");
      expect(readFileSync(join(made.path, String(first.json["file"])), "utf8")).toBe(`---\nid: ${String(first.json["id"])}\ntitle: Tuesday, 20 October\nstatus: draft\nwhen:\n  at: 2026-10-20\n---\n`);
      expect((await validate(nodeSource(made.path))).diagnostics).toEqual([]);
      // Again: the same entry, nothing made.
      const head = gitIn(made.path, "rev-parse", "HEAD");
      expect(await today("2026-10-20")).toMatchObject({ json: { id: first.json["id"], made: false } });
      expect(gitIn(made.path, "rev-parse", "HEAD")).toBe(head);
      // The next day: in the same month.
      expect((await today("2026-10-21")).json).toMatchObject({ made: true, file: "entries/01-2026/01-october/02-wednesday-21-october.md" });
      expect(gitIn(made.path, "log", "-1", "--format=%s").trim()).toBe("Journal: add entry “Wednesday, 21 October”");
      expect(await today("yesterday")).toMatchObject({ status: 400, json: { code: "BAD_REQUEST" } });
    } finally {
      await close();
    }
  });

  it("isn't there for a novel", async () => {
    const { today, close } = await serve(novelRepo(fresh("novel")));
    try {
      expect(await today("2026-10-20")).toMatchObject({ status: 404, json: { code: "NOT_FOUND" } });
    } finally {
      await close();
    }
  });
});

describe("the journal read back", () => {
  it("puts the entries newest first, a day's in the book's order, undated last", async () => {
    const journal = await loadBook(nodeSource(sample));
    const days = newestFirst(journal).map((e) => e.day);
    const dated = days.filter((d) => d !== undefined);
    expect(dated.length).toBeGreaterThan(2);
    expect(dated).toEqual([...dated].sort().reverse());
    expect(days.indexOf(undefined) === -1 || days.slice(days.indexOf(undefined)).every((d) => d === undefined)).toBe(true);
  });

  it("shows an entry's text safely: names linked to their index entries, pictures from the book, notes left out", () => {
    const html = entryHtml('Out with [Mira Hale](#per_ab12cd) to the Spit.<!-- a note to self -->\n\n![The spit](/images/the-spit.jpg)\n\n<script>alert(1)</script>\n', "lib_x");
    expect(html).toContain('<a href="/novels/lib_x/bible/per_ab12cd">Mira Hale</a>');
    expect(html).toContain('<img src="/api/novels/lib_x/images/the-spit.jpg" alt="The spit"');
    expect(html).not.toContain("a note to self");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
