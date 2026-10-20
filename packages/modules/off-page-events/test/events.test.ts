import { fileURLToPath } from "node:url";
import { kindByKey, loadBook, memorySource, sceneFacts, validate, validateBook, withModules, type BookKind, type Diagnostic } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { novel as novelKind } from "@writer/kinds";
import { storyTimeline } from "@writer/module-story-time/core";
import { describe, expect, it } from "vitest";
import { around, EVENT, eventFields, eventsInTime, eventsOf } from "../src/core/index.ts";

/** Off-page events as a module (#33): the Novel's as before, and a kind without it has no events. */

const sample = fileURLToPath(new URL("../../../../examples/sample-novel/", import.meta.url));
/** The Novel without off-page events. */
const plain: BookKind = { ...novelKind, key: "plain-events", modules: ["point-of-view", "plotlines", "presence", "story-time"] };

const NOVEL = `schema_version: 1
id: nv_4k8h2c
title: Fixture
relationship_types:
  - key: sibling
    symmetric: true
`;

const scene = (id: string, title: string, extra = "", body = "Prose.\n") => `---\nid: ${id}\ntitle: ${title}\n${extra}---\n${body}`;

/** A small valid novel: one chapter, three scenes, a few bible entries. Override or delete (undefined) files per test. */
function fixture(overrides: Record<string, string | undefined> = {}) {
  const files: Record<string, string | undefined> = {
    "novel.yaml": NOVEL,
    "manuscript/_order.yaml": "chapters: [ch_aaaaaa]\n",
    "manuscript/01-one/_chapter.yaml": "id: ch_aaaaaa\nscenes: [sc_aaaaaa, sc_bbbbbb, sc_cccccc]\n",
    "manuscript/01-one/01-a.md": scene("sc_aaaaaa", "A", "pov: char_aaaaaa\ncharacters: [char_aaaaaa]\nlocations: [loc_aaaaaa]\nplotlines: [plot_aaaaaa]\n"),
    "manuscript/01-one/02-b.md": scene("sc_bbbbbb", "B"),
    "manuscript/01-one/03-c.md": scene("sc_cccccc", "C"),
    "bible/characters/ada.md": "---\nid: char_aaaaaa\nname: Ada\n---\n",
    "bible/locations/bridge.md": "---\nid: loc_aaaaaa\nname: Bridge\n---\n",
    "bible/plotlines/sale.md": "---\nid: plot_aaaaaa\nname: Sale\n---\n",
    ...overrides,
  };
  const defined = Object.fromEntries(Object.entries(files).filter((e): e is [string, string] => e[1] !== undefined));
  return validate(memorySource(defined));
}

const only = (ds: Diagnostic[]) => ds.map((d) => d.code);

describe("off-page events", () => {
  it("are the Novel's: a record type in the codex's events/, with the kind's time and lists, needing story time", async () => {
    const kind = kindByKey("novel");
    expect(eventFields(kind).map((f) => [f.key, f.label])).toEqual([["when", "When"], ["characters", "Characters"], ["locations", "Where"], ["plotlines", "Plotlines"]]);
    const book = await loadBook(nodeSource(sample));
    expect(eventsOf(book).map((e) => e.title).sort()).toEqual(["Ada leaves for the polytechnic", "The flood of '09", "The plans are stolen"]);
    // In story time: the flood first, and the plans stolen five days before Day 1.
    expect(eventsInTime(book).map((e) => e.title)).toEqual(["The flood of '09", "Ada leaves for the polytechnic", "The plans are stolen"]);
    expect(around(book, "evt_9ab3kd").after?.title).toBe("The Flood");
    expect(storyTimeline(book).items.some((i) => i.kind === "record" && i.record.type === EVENT.key)).toBe(true);
  });

  it("are nowhere in a kind without the module: not loaded, mentioned, timed or listed", async () => {
    expect(withModules(plain).modules).not.toContain("off-page-events");
    const book = await loadBook(nodeSource(sample), plain);
    expect(book.moduleRecords).toEqual([]);
    expect(eventsOf(book)).toEqual([]);
    expect(storyTimeline(book).undatedRecords).toEqual([]);
    expect(book.pieces.flatMap((p) => sceneFacts(book, p.id)).join(" ")).not.toMatch(/off-page event/);
    // Its files aren't read: a mention of one names nothing the book has, and the folder is no entry type's.
    const small = await loadBook(memorySource({
      "novel.yaml": "schema_version: 2\nid: nv_4k8h2c\ntitle: T\n",
      "manuscript/_order.yaml": "chapters: [ch_aaaaaa]\n",
      "manuscript/01-one/_chapter.yaml": "id: ch_aaaaaa\nscenes: [sc_aaaaaa]\n",
      "manuscript/01-one/01-a.md": scene("sc_aaaaaa", "A", "", "After [the flood](#evt_aaaaaa).\n"),
      "bible/events/flood.md": "---\nid: evt_aaaaaa\ntitle: Flood\n---\n",
      "bible/events.yaml": "events:\n  - {id: evt_bbbbbb, title: Leaving}\n",
    }), plain);
    expect(validateBook(small).concat(small.diagnostics).map((d) => d.code).sort()).toEqual(["E_DANGLING_REF", "E_UNKNOWN_FOLDER"]);
  });

  it("need story time: a kind that lists them without it is a mistake", () => {
    expect(() => withModules({ ...novelKind, key: "untimed", modules: ["off-page-events"] })).toThrow(/needs “story-time”/);
  });

  it("say which event a scene dramatizes, among its facts", async () => {
    const book = await loadBook(memorySource({
      "novel.yaml": "schema_version: 2\nid: nv_4k8h2c\ntitle: T\n",
      "manuscript/_order.yaml": "chapters: [ch_aaaaaa]\n",
      "manuscript/01-one/_chapter.yaml": "id: ch_aaaaaa\nscenes: [sc_aaaaaa]\n",
      "manuscript/01-one/01-a.md": scene("sc_aaaaaa", "A"),
      "bible/events/flood.md": "---\nid: evt_aaaaaa\ntitle: Flood\nscene: sc_aaaaaa\n---\n",
    }));
    expect(sceneFacts(book, "sc_aaaaaa")).toContain("Dramatizes the off-page event “Flood”.");
  });

  describe("as files (format v2, D11)", () => {
    const V2 = NOVEL.replace("schema_version: 1", "schema_version: 2");
    const event = (id: string, front = "", body = "") => `---\nid: ${id}\ntitle: Flood\n${front}---\n${body}`;

    it("loads an event file, its note as prose, and validates mentions of events", async () => {
      const r = await fixture({
        "novel.yaml": V2,
        "bible/events/flood.md": event("evt_aaaaaa", "when: {at: 2009-11-02}\ncharacters: [char_aaaaaa]\nscene: sc_bbbbbb\n", "\n[Ada](#char_aaaaaa) holds the pier.\n"),
        "manuscript/01-one/02-b.md": scene("sc_bbbbbb", "B", "", "After [the flood](#evt_aaaaaa).\n"),
        "bible/characters/ada.md": "---\nid: char_aaaaaa\nname: Ada\n---\nShe remembers [the flood](#evt_aaaaaa).\n",
      });
      expect(r.diagnostics).toEqual([]);
      const [ev] = eventsOf(r.novel);
      expect(ev).toMatchObject({ id: "evt_aaaaaa", title: "Flood", when: { at: "2009-11-02" }, characters: ["char_aaaaaa"], scene: "sc_bbbbbb", file: "bible/events/flood.md", bodyLine: 8 });
      expect(ev!.body).toBe("\n[Ada](#char_aaaaaa) holds the pier.\n");
      expect(ev!.index).toBeUndefined();
    });

    it("checks an event file's references, its scene and the mentions in its note, by pointer and line", async () => {
      const r = await fixture({
        "novel.yaml": V2,
        "bible/events/flood.md": event("evt_aaaaaa", "locations: [char_aaaaaa]\nscene: char_aaaaaa\n", "\nThen [Zed](#char_zzzzzz).\n"),
      });
      expect(r.diagnostics.map((d) => [d.code, d.file, d.pointer ?? d.line])).toEqual([
        ["E_REF_TYPE", "bible/events/flood.md", "/locations/0"],
        ["E_REF_TYPE", "bible/events/flood.md", "/scene"],
        ["E_DANGLING_REF", "bible/events/flood.md", 8],
      ]);
    });

    it("an event's prefix must be evt_; a v1 events.yaml left in a v2 novel is W_EVENTS_YAML", async () => {
      const r = await fixture({
        "novel.yaml": V2,
        "bible/events/flood.md": event("sc_dddddd"),
        "bible/events.yaml": "events:\n  - {id: evt_bbbbbb, title: Leaving}\n",
      });
      expect(only(r.diagnostics)).toEqual(["W_EVENTS_YAML", "E_ID_PREFIX"]);
      expect(eventsOf(r.novel).map((e) => e.id).sort()).toEqual(["evt_bbbbbb", "sc_dddddd"]);
    });

    it("bible/events.yaml in a v1 novel is fine, its note the event's prose", async () => {
      const r = await fixture({ "bible/events.yaml": "events:\n  - {id: evt_bbbbbb, title: Leaving, note: By the night train.}\n" });
      expect(r.diagnostics).toEqual([]);
      expect(eventsOf(r.novel)[0]).toMatchObject({ body: "By the night train.", index: 0, file: "bible/events.yaml" });
    });

    it("events is no custom type's folder", async () => {
      const r = await fixture({ "novel.yaml": `${V2}entity_types:\n  - {key: happening, prefix: hap, folder: events, label: Happening}\n` });
      expect(only(r.diagnostics)).toEqual(["E_ENTITY_TYPE"]);
    });
  });

});
