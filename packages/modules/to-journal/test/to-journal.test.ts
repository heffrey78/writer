import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { conversionsOf, kindByKey, loadBook, memorySource, mentions, validate } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { convertBook, createServer, Library, sessionCookie } from "@writer/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scratch } from "../../../server/test/fixtures.ts";
import { send } from "../../../server/test/http.ts";
import { titleDate, toJournal } from "../src/core/index.ts";
import { JOURNAL_AS_NOVEL, journalAsNovel } from "./fixture.ts";

/** A journal kept as a novel, made a Journal (#39): every ID, mention and word kept, in one commit; what it can't carry, refused. */

let fresh: (name: string) => string;
let cleanUp: () => void;
beforeAll(() => ({ fresh, cleanUp } = scratch("to-journal")));
afterAll(() => cleanUp());

const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
const body = (text: string) => text.replace(/^---\n[\s\S]*?\n---\n/, "");

describe("dates in titles", () => {
  it("read a gh-writer journal's titles, and others a writer might use", () => {
    expect(["Tuesday, 10/20/2026", "Thursday, 10/08/2026", "2026-10-20", "Tuesday 20 October 2026", "October 20, 2026", "Monday, 2/30/2026", "A good day"].map(titleDate)).toEqual([
      "2026-10-20",
      "2026-10-08",
      "2026-10-20",
      "2026-10-20",
      "2026-10-20",
      undefined,
      undefined,
    ]);
  });
});

describe("making a journal of a journal kept as a novel", () => {
  it("is offered to a novel, and to nothing else", () => {
    expect(conversionsOf(kindByKey("novel")).map((c) => [c.to, c.label])).toEqual([["journal", "Make this book a journal…"]]);
    expect(conversionsOf(kindByKey("journal"))).toEqual([]);
  });

  it("moves it to the journal's folders and words, dates every entry, and keeps every ID, mention, relationship and word, in one commit", async () => {
    const dir = journalAsNovel(fresh("journal"));
    const before = await loadBook(nodeSource(dir));
    const { commit, notes } = await convertBook(dir, "journal");
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    expect(git(dir, "log", "-1", "--format=%s").trim()).toBe("Make this book a journal");
    expect(git(dir, "status", "--porcelain")).toBe("");
    expect(notes).toEqual(["“Tuesday, 10/20/2026” dated 2026-10-20 from its title."]);

    const r = await validate(nodeSource(dir));
    expect(r.diagnostics).toEqual([]);
    const after = r.novel;
    expect(after.kind.key).toBe("journal");
    // Every record kept, by ID.
    const ids = (b: typeof after) => [b.config?.id, ...b.allSections.map((s) => s.id), ...b.allPieces.map((p) => p.id), ...b.entities.map((e) => e.id), ...b.relationships.map((x) => x.id), ...b.notes.map((n) => n.id)].sort();
    expect(ids(after)).toEqual(ids(before));
    expect(after.entities.map((e) => [e.id, e.type]).sort()).toEqual([["char_a1exab", "person"], ["char_meab00", "person"], ["loc_tr0yab", "place"], ["theme_10veab", "value"]]);
    // Each entry's words byte for byte, its mentions with them; its lists as the journal's fields, its status the journal's.
    for (const p of after.pieces) {
      const was = before.pieces.find((q) => q.id === p.id)!;
      expect(p.body, p.title).toBe(was.body);
      expect(mentions(p.body)).toEqual(mentions(was.body));
    }
    expect(after.pieces.map((p) => [p.title, p.status, p.fields["when"], p.fields["people"]])).toEqual([
      ["Thursday, 10/08/2026", "draft", { at: "2026-10-08" }, ["char_a1exab"]],
      ["Tuesday, 10/20/2026", "draft", { at: "2026-10-20" }, ["char_a1exab"]],
    ]);
    expect(after.pieces[1]!.fields).toMatchObject({ places: ["loc_tr0yab"], values: [{ id: "theme_10veab", strength: 3 }] });
    expect(after.sections.map((s) => [s.level, s.title])).toEqual([["month", "October 2026"]]);
    expect(after.notes[0]).toMatchObject({ scenes: ["sc_1020ab"] });
    // The book.yaml: its kind, its relationships' types the journal's, the one for plotlines (unused) gone.
    const manifest = readFileSync(join(dir, "book.yaml"), "utf8");
    expect(manifest).toMatch(/^kind: journal$/m);
    expect(manifest).toContain("from_types: [person]");
    expect(manifest).not.toContain("explores");
    // Nothing left of the novel's folders, and the journal's tools in the novel's.
    for (const gone of ["manuscript", "bible", ".github/gh-writer/init.mjs"]) expect(existsSync(join(dir, gone)), gone).toBe(false);
    expect(readFileSync(join(dir, "diagrams/README.md"), "utf8")).toContain("presence-people.svg");
    expect(body(readFileSync(join(dir, "entries/01-october-2026/02-tuesday-10-20-2026.md"), "utf8"))).toBe(body(JOURNAL_AS_NOVEL["manuscript/01-october-2026/02-tuesday-10-20-2026.md"]!));
  });

  it("refuses what a journal has no place for, saying so, and writes nothing", async () => {
    const refusal = async (files: Record<string, string>) => {
      const book = await loadBook(memorySource(files));
      const done = await toJournal.run(memorySource(files), book);
      return "refused" in done ? done.refused : "converted";
    };
    const scene = "manuscript/01-october-2026/01-thursday-10-08-2026.md";
    expect(await refusal({ ...JOURNAL_AS_NOVEL, [scene]: JOURNAL_AS_NOVEL[scene]!.replace("status: drafted", "status: drafted\npov: char_a1exab") })).toMatch(/point of view/);
    expect(await refusal({ ...JOURNAL_AS_NOVEL, "bible/events/flood.md": "---\nid: evt_f100d0\ntitle: Flood\n---\n" })).toMatch(/off-page events/);
    expect(await refusal({ ...JOURNAL_AS_NOVEL, "bible/plotlines/work.md": "---\nid: plot_w0rkab\nname: Work\n---\n" })).toMatch(/plotlines/);
    expect(await refusal({ ...JOURNAL_AS_NOVEL, "manuscript/01-october-2026/_chapter.yaml": "id: ch_0ctb26\nscenes: [sc_0810ab, sc_1020ab]\n" })).toMatch(/months and years have titles/);

    const dir = journalAsNovel(fresh("pov"), { ...JOURNAL_AS_NOVEL, [scene]: JOURNAL_AS_NOVEL[scene]!.replace("status: drafted", "status: drafted\npov: char_a1exab") });
    const head = git(dir, "rev-parse", "HEAD");
    await expect(convertBook(dir, "journal")).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/point of view/) });
    expect(git(dir, "rev-parse", "HEAD")).toBe(head);
    expect(git(dir, "status", "--porcelain")).toBe("");
  });

  it("through the server: the book opens afresh as a journal", async () => {
    const dir = journalAsNovel(fresh("served"));
    const library = await Library.open({ configDir: fresh("config"), cloneDir: fresh("books") });
    const book = await library.add(dir);
    const server = await createServer({ library, token: "t", sync: false, commit: false });
    const headers = { cookie: `${sessionCookie(server.port)}=t`, origin: server.url, "content-type": "application/json" };
    try {
      const novel = await send(server.port, `/api/novels/${book.id}`, { method: "GET", headers });
      expect((JSON.parse(novel.body) as { novel: { kind: { key: string } } }).novel.kind.key).toBe("novel");
      const done = await send(server.port, `/api/novels/${book.id}/convert`, { method: "POST", headers, body: JSON.stringify({ to: "journal" }) });
      expect(done.status).toBe(200);
      const journal = await send(server.port, `/api/novels/${book.id}`, { method: "GET", headers });
      expect((JSON.parse(journal.body) as { novel: { kind: { key: string } } }).novel.kind.key).toBe("journal");
      expect((await send(server.port, `/api/novels/${book.id}/convert`, { method: "POST", headers, body: JSON.stringify({ to: "journal" }) })).status).toBe(400);
    } finally {
      await server.close();
    }
  });
});
