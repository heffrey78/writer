import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadBook, validateBook } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { BibleOperations, createServer, hashText, Library, ManuscriptOperations, registerServerModule, sessionCookie } from "@writer/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asFormatV1, diaryRepo, gitIn, novelRepo, scratch } from "../../../server/test/fixtures.ts";
import { send } from "../../../server/test/http.ts";
import { eventsOf } from "../src/core/index.ts";
import { EventOperations, offPageEventsServer } from "../src/server/index.ts";

/** Off-page events' changes, through the module's server half (#33): each one commit, as before, and no routes for a kind without them. */

registerServerModule(offPageEventsServer);
const ADA = "char_7f3k2q";
const BEN = "char_b3n0vs";
const IDEA = "notes/what-if-ben-never-sold.md";

let fresh: (name: string) => string;
let cleanUp: () => void;
let dir: string;
let bible: BibleOperations;
let events: EventOperations;

beforeAll(() => ({ fresh, cleanUp } = scratch("events")));
afterAll(() => cleanUp());

beforeEach(() => {
  dir = novelRepo(fresh("novel"));
  bible = new BibleOperations(dir, (fn) => fn());
  events = new EventOperations(bible);
});

const read = (path: string) => readFileSync(join(dir, path), "utf8");
const lastCommit = () => gitIn(dir, "log", "-1", "--format=%s").trim();
const changedInLastCommit = () => gitIn(dir, "show", "--name-status", "--format=", "HEAD").trim().split("\n").sort();
const clean = () => expect(gitIn(dir, "status", "--porcelain")).toBe("");
async function valid() {
  const novel = await loadBook(nodeSource(dir));
  expect(validateBook(novel).filter((d) => d.severity === "error")).toEqual([]);
  return novel;
}

describe("events", () => {
  const FLOOD = "bible/events/the-flood-of-09.md";
  const LEAVING = "bible/events/ada-leaves-for-the-polytechnic.md";

  it("adds an event as a file of its own, its note as prose, as one commit", async () => {
    const { id, file } = await events.create({ title: "Ben meets Mirela", when: { day: 2, time: "22:00" }, duration: "PT1H", characters: [BEN, "char_m1re1a"], locations: ["loc_br1dg3"], note: "At the [toll house](#loc_br1dg3)." });
    expect(id).toMatch(/^evt_[0-9a-hjkmnp-tv-z]{6}$/);
    expect(file).toBe("bible/events/ben-meets-mirela.md");
    expect(read(file)).toBe(`---\nid: ${id}\ntitle: Ben meets Mirela\nwhen:\n  day: 2\n  time: "22:00"\nduration: PT1H\ncharacters:\n  - ${BEN}\n  - char_m1re1a\nlocations:\n  - loc_br1dg3\n---\n\nAt the [toll house](#loc_br1dg3).\n`);
    expect(lastCommit()).toBe("Bible: add event “Ben meets Mirela”");
    expect(changedInLastCommit()).toEqual([`A\t${file}`]);
    clean();
    expect(eventsOf(await valid()).find((e) => e.id === id)?.body).toBe("\nAt the [toll house](#loc_br1dg3).\n");
  });

  it("edits an event's fields in its front matter, and its note as the prose, checked against the file it was read from", async () => {
    const before = read(LEAVING);
    await events.update("evt_1eave5", { when: { at: "2012-09-03" }, scene: "sc_5tat1n", note: "By the night train." }, { base: hashText(before) });
    expect(read(LEAVING)).toBe(before.replace("at: 2012-09-01", "at: 2012-09-03").replace(/---\n$/, "scene: sc_5tat1n\n---\n\nBy the night train.\n"));
    expect(lastCommit()).toBe("Bible: edit event “Ada leaves for the polytechnic”");
    await events.update("evt_1eave5", { note: null, scene: null });
    expect(read(LEAVING)).toBe(before.replace("at: 2012-09-01", "at: 2012-09-03"));
    await expect(events.update("evt_1eave5", { duration: "P1D" }, { base: hashText(before) })).rejects.toMatchObject({ code: "STALE", details: { path: LEAVING } });
    clean();
    await valid();
  });

  it("a new title moves the file to match", async () => {
    const before = read(FLOOD);
    const { file } = await events.update("evt_9ab3kd", { title: "The great flood" });
    expect(file).toBe("bible/events/the-great-flood.md");
    expect(existsSync(join(dir, FLOOD))).toBe(false);
    expect(read(file)).toBe(before.replace("title: The flood of '09", "title: The great flood"));
    expect(lastCommit()).toBe("Bible: rename event “The flood of '09” to “The great flood”");
    expect(gitIn(dir, "show", "--no-renames", "--name-status", "--format=", "HEAD").trim().split("\n").sort()).toEqual([`A\t${file}`, `D\t${FLOOD}`]);
    clean();
    await valid();
  });

  it("removes an event; one that prose mentions only once confirmed", async () => {
    await events.delete("evt_1eave5");
    expect(existsSync(join(dir, LEAVING))).toBe(false);
    expect(lastCommit()).toBe("Bible: remove event “Ada leaves for the polytechnic”");

    const scene = "manuscript/01-return/01-arrival/01-the-station.md";
    writeFileSync(join(dir, scene), `${read(scene).trimEnd()}\n\nShe thought of [the flood](#evt_9ab3kd).\n`);
    writeFileSync(join(dir, "bible/characters/ada.md"), `${read("bible/characters/ada.md").trimEnd()}\n\nShe was eleven at [the flood](#evt_9ab3kd).\n`);
    gitIn(dir, "commit", "-qam", "Mentions");
    await expect(events.delete("evt_9ab3kd")).rejects.toMatchObject({
      code: "REFERENCED",
      details: {
        references: [
          { kind: "scene", id: "sc_5tat1n", title: "The Station", via: ["mention"] },
          { kind: "entity", id: ADA, title: "Ada Varn" },
          { kind: "note", id: "note_w1fben", title: "What if Ben never sold the plans?" },
        ],
      },
    });
    expect(existsSync(join(dir, FLOOD))).toBe(true);
    await events.delete("evt_9ab3kd", { confirm: true });
    expect(existsSync(join(dir, FLOOD))).toBe(false);
    clean();
  });

  it("writes an event as a scene at a chapter's end, keeping the event (naming the scene) or removing it, in one commit", async () => {
    const manuscript = new ManuscriptOperations(dir, (fn) => fn());
    const { scene, file } = await events.writeAsScene("evt_p1an5t", { chapter: "ch_01dde6", keep: true }, manuscript);
    expect(file).toMatch(/^manuscript\/01-return\/02-[a-z-]+\/0\d-the-plans-are-stolen\.md$/);
    expect(read(file)).toBe(`---\nid: ${scene}\ntitle: The plans are stolen\nsynopsis: Off page. Ben uses Tomas's key.\nstatus: idea\ncharacters:\n  - char_b3n0vs\nlocations:\n  - loc_w0rk5p\nplotlines:\n  - plot_h315tz\n  - plot_gr1efa\nwhen:\n  day: -5\n---\n`);
    expect(read("bible/events/the-plans-are-stolen.md")).toContain(`\nscene: ${scene}\n---\n`);
    expect(lastCommit()).toBe("Manuscript: write “The plans are stolen” as a scene");
    clean();
    const novel = await valid();
    expect(novel.sections.find((c) => c.id === "ch_01dde6")?.childIds.at(-1)).toBe(scene);

    await events.writeAsScene("evt_1eave5", { chapter: "ch_01dde6", keep: false }, manuscript);
    expect(existsSync(join(dir, LEAVING))).toBe(false);
    expect(lastCommit()).toBe("Manuscript: write “Ada leaves for the polytechnic” as a scene, removing the event");
    clean();
    await valid();
  });

  it("won't remove an event the prose mentions when writing it as a scene", async () => {
    const scene = "manuscript/01-return/01-arrival/01-the-station.md";
    writeFileSync(join(dir, scene), `${read(scene).trimEnd()}\n\nShe thought of [the flood](#evt_9ab3kd).\n`);
    gitIn(dir, "commit", "-qam", "Mention");
    const head = gitIn(dir, "rev-parse", "HEAD");
    await expect(events.writeAsScene("evt_9ab3kd", { chapter: "ch_01dde6", keep: false }, new ManuscriptOperations(dir, (fn) => fn()))).rejects.toMatchObject({ code: "REFERENCED" });
    expect(gitIn(dir, "rev-parse", "HEAD")).toBe(head);
  });

  describe("in a novel in format v1", () => {
    beforeEach(() => {
      asFormatV1(dir);
      gitIn(dir, "add", "-A");
      gitIn(dir, "commit", "-qm", "Format v1");
    });

    it("refuses an event change with NEEDS_MIGRATION, writing nothing", async () => {
      const head = gitIn(dir, "rev-parse", "HEAD");
      await expect(events.create({ title: "Storm" })).rejects.toMatchObject({ code: "NEEDS_MIGRATION", details: { from: 1, to: 2 } });
      await expect(events.update("evt_1eave5", { duration: "P1D" })).rejects.toMatchObject({ code: "NEEDS_MIGRATION" });
      await expect(events.delete("evt_1eave5")).rejects.toMatchObject({ code: "NEEDS_MIGRATION" });
      expect(gitIn(dir, "rev-parse", "HEAD")).toBe(head);
      clean();
    });

    it("with migrate, moves the novel to v2 and makes the change, in one commit", async () => {
      const { file } = await events.update("evt_1eave5", { duration: "P1D", note: "By the night train." }, { migrate: true });
      expect(file).toBe(LEAVING);
      expect(lastCommit()).toBe("Format v2: off-page events as files; Bible: edit event “Ada leaves for the polytechnic”");
      expect(changedInLastCommit()).toEqual([
        `A\t${LEAVING}`,
        `A\t${FLOOD}`,
        "A\tbible/events/the-plans-are-stolen.md",
        "D\tbible/events.yaml",
        "M\tnovel.yaml",
      ].sort());
      expect(read(LEAVING)).toBe("---\nid: evt_1eave5\ntitle: Ada leaves for the polytechnic\nwhen:\n  at: 2012-09-01\ncharacters:\n  - char_7f3k2q\nlocations:\n  - loc_5tat10\nduration: P1D\n---\n\nBy the night train.\n");
      clean();
      const novel = await valid();
      expect(novel.config?.schema_version).toBe(2);
      expect(validateBook(novel)).toEqual([]);
    });

  });

  it("refuses an event without a title, with a bad time or duration, or naming the wrong kind of entry", async () => {
    await expect(events.create({ title: " " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(events.create({ title: "X", when: { day: 2, time: "25:00" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(events.create({ title: "X", when: { at: "yesterday" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(events.create({ title: "X", duration: "an hour" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(events.create({ title: "X", characters: ["loc_br1dg3"] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(events.update("evt_zzzzzz", { title: "Y" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  describe("made of a note (heffrey78/gh-writer#205)", () => {
    it("promotes a note to an off-page event, keeping it (became names the event)", async () => {
      const { id, file } = await events.fromNote("note_w1fben", { keep: true });
      expect(file).toBe("bible/events/what-if-ben-never-sold-the-plans.md");
      expect(read(file)).toBe(`---\nid: ${id}\ntitle: What if Ben never sold the plans?\n---\n\nThen [Ada](#char_7f3k2q) has no reason to come home, and the bridge stands. Unless the debt goes back to [the flood](#evt_9ab3kd).\n`);
      expect(read(IDEA)).toContain(`\nbecame: ${id}\n---\n`);
      expect(lastCommit()).toBe("Notes: promote “What if Ben never sold the plans?” to an off-page event");
      clean();
      await valid();
    });
  });
});

describe("the routes", () => {
  async function serve(repo: string) {
    const library = await Library.open({ configDir: fresh("config") });
    const book = await library.add(repo);
    const server = await createServer({ library, token: "t", sync: false, commit: false });
    const headers = { cookie: `${sessionCookie(server.port)}=t`, origin: server.url, "content-type": "application/json" };
    const call = async (method: string, path: string, body: unknown = {}) => {
      const res = await send(server.port, `/api/novels/${book.id}/off-page-events${path}`, { method, headers, body: JSON.stringify(body) });
      return { status: res.status, json: JSON.parse(res.body) as Record<string, unknown> };
    };
    return { call, close: () => server.close() };
  }

  it("answer each change, and its refusals with their codes", async () => {
    const { call, close } = await serve(dir);
    try {
      const made = await call("POST", "/events", { title: "Storm", characters: [ADA] });
      expect(made).toMatchObject({ status: 201, json: { file: "bible/events/storm.md" } });
      const id = String(made.json["id"]);
      expect((await call("PATCH", `/events/${id}`, { changes: { duration: "PT2H" } })).status).toBe(200);
      expect(read("bible/events/storm.md")).toContain("duration: PT2H\n");
      expect(await call("PATCH", "/events/evt_zzzzzz", { changes: { title: "Y" } })).toMatchObject({ status: 404, json: { code: "NOT_FOUND" } });
      expect(await call("POST", "/events/evt_9ab3kd/delete")).toMatchObject({ status: 409, json: { code: "REFERENCED" } });
      expect(await call("POST", `/events/${id}/scene`, { chapter: "ch_01dde6", keep: false })).toMatchObject({ status: 201, json: { scene: expect.stringMatching(/^sc_/) } });
      expect(existsSync(join(dir, "bible/events/storm.md"))).toBe(false);
      expect(await call("POST", "/notes/note_w1fben", { keep: true })).toMatchObject({ status: 201, json: { file: "bible/events/what-if-ben-never-sold-the-plans.md" } });
      expect((await call("POST", "/events", { title: " " })).status).toBe(400);
    } finally {
      await close();
    }
  });

  it("aren't there for a book whose kind has no off-page events", async () => {
    const diary = diaryRepo(fresh("diary"));
    const { call, close } = await serve(diary);
    try {
      expect(await call("POST", "/events", { title: "Storm" })).toMatchObject({ status: 404, json: { code: "NOT_FOUND" } });
      expect(existsSync(join(diary, "index/events"))).toBe(false);
    } finally {
      await close();
    }
  });
});
