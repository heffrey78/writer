import { fileURLToPath } from "node:url";
import { kindByKey, loadBook, locationProfile, memorySource, sceneFacts, storyClock, validateBook, withModules, type BookKind } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { snapshots } from "@writer/core/snapshots";
import { novel as novelKind } from "@writer/kinds";
import { describe, expect, it } from "vitest";
import { defaultLanes, laneModes, readableSpan, storyTimeline, timeline, timelineMermaid, timeOf } from "../src/core/index.ts";

/** Story time as a module (#30): the Novel's as before, and a kind without it has no story time anywhere. */

const sample = fileURLToPath(new URL("../../../../examples/sample-novel/", import.meta.url));
/** The Novel without story time. */
const plain: BookKind = { ...novelKind, key: "plain", modules: ["point-of-view", "plotlines", "presence"] };

describe("story time", () => {
  it("is the Novel's: its field where it was, its check, its facts, its diagram and its clock", async () => {
    const kind = kindByKey("novel");
    expect(kind.fields.map((f) => f.key)).toEqual(["pov", "locations", "characters", "when", "plotlines", "entities", "themes"]);
    expect(laneModes(kind)).toEqual(["carrier", "location", "plotline"]);
    const book = await loadBook(nodeSource(sample));
    expect(timeOf(book.pieces.find((p) => p.id === "sc_f100d0")!)).toEqual({ when: { at: "2009-11-02T23:00" }, duration: "PT2H" });
    expect(storyTimeline(book).items.length).toBeGreaterThan(0);
    expect(sceneFacts(book, "sc_f100d0").join(" ")).toMatch(/A flashback/);
    // The off-page events, another module's records, are placed among the scenes.
    expect(storyTimeline(book).items.filter((i) => i.kind === "record").length).toBe(book.moduleRecords.length);
    expect(locationProfile(book, "loc_br1dg3").span).toBeDefined();
    const files = snapshots(book);
    expect([...files.keys()]).toContain("diagrams/timeline.svg");
    expect(files.get("diagrams/README.md")).toContain("## Timeline");
  });

  it("is nowhere in a kind without the module: no field, check, facts, diagram or clock", async () => {
    const kind = withModules(plain);
    expect(kind.fields.some((f) => f.type.kind === "story-time")).toBe(false);
    const book = await loadBook(nodeSource(sample), plain);
    // The scenes' `when` is a key the kind doesn't know: kept in the file, read by nothing.
    expect(book.pieces.every((p) => !("when" in p.fields))).toBe(true);
    expect(validateBook(book).map((d) => d.code)).not.toContain("W_TIME_OVERLAP");
    expect(book.pieces.flatMap((p) => sceneFacts(book, p.id)).join(" ")).not.toMatch(/flashback|after “|off-page event “/);
    expect(storyClock(book)).toBeUndefined();
    expect(locationProfile(book, "loc_br1dg3").span).toBeUndefined();
    const files = snapshots(book);
    expect([...files.keys()]).not.toContain("diagrams/timeline.svg");
    expect(files.get("diagrams/README.md")).not.toContain("Timeline");
  });

  it("runs lanes by the entry that carries a piece, where a kind has one, else by its first lanes field", async () => {
    const book = await loadBook(nodeSource(sample));
    expect(defaultLanes(book.kind)).toBe("carrier");
    expect(timeline(book, "carrier").lanes.map((l) => l.name)).toContain("Off page");
    const without = withModules({ ...novelKind, key: "unseen", modules: ["story-time"] });
    expect(laneModes(without)).toEqual(["location"]);
    expect(defaultLanes(without)).toBe("location");
  });

  it("puts the timeline in Mermaid in story-time order, the flashback noted, colons kept out of labels", async () => {
    const t = timelineMermaid(await loadBook(nodeSource(sample)));
    expect(t.split("\n").slice(0, 4)).toEqual([
      "timeline",
      "  title Story time",
      "  2 Nov 2009 : The flood of '09 (off page)",
      "  2 Nov 2009, 23∶00 : The Flood (6th in the book, a flashback)",
    ]);
    expect(t).toContain("  Day 3, 18∶30 (3 Mar 2024) : The Betrayal (5th in the book)");
  });

  it("reads spans of story time", () => {
    expect(readableSpan(40 * 60_000)).toBe("40 min");
    expect(readableSpan(3 * 3_600_000)).toBe("3 h");
    expect(readableSpan(26 * 3_600_000)).toBe("1 day");
    expect(readableSpan(3 * 365 * 86_400_000)).toBe("3 years");
  });
});

describe("W_TIME_OVERLAP", () => {
  /** Witnesses in rooms: people and places by what their types are, not by their keys. */
  const inquest: BookKind = {
    ...novelKind,
    key: "inquest",
    entityTypes: [
      { key: "witness", prefix: "wit", folder: "witnesses", label: "Witness", builtin: true, is: "person" },
      { key: "room", prefix: "room", folder: "rooms", label: "Room", builtin: true, is: "place" },
      { key: "exhibit", prefix: "ex", folder: "exhibits", label: "Exhibit", builtin: true },
    ],
    fields: [
      { key: "seen", label: "Seen", type: { kind: "entities", entityType: "witness" } },
      { key: "rooms", label: "Rooms", type: { kind: "entities", entityType: "room" } },
      { key: "exhibits", label: "Exhibits", type: { kind: "entities", entityType: "exhibit" } },
    ],
    modules: ["story-time"],
    fieldOrder: [],
    entityTypeOrder: [],
  };
  const lines = (...l: string[]) => `${l.join("\n")}\n`;
  const scene = (id: string, title: string, ...front: string[]) => lines("---", `id: ${id}`, `title: ${title}`, ...front, "---", "Words.");
  const entry = (id: string, name: string) => lines("---", `id: ${id}`, `name: ${name}`, "---");
  const book = (second: string) =>
    loadBook(
      memorySource({
        "novel.yaml": lines("schema_version: 2", "id: nv_000001", "title: Inquest"),
        "manuscript/_order.yaml": lines("chapters: [ch_000001]"),
        "manuscript/01-one/_chapter.yaml": lines("id: ch_000001", "scenes: [sc_000001, sc_000002]"),
        "manuscript/01-one/01.md": scene("sc_000001", "Morning", "seen: [wit_000001]", "rooms: [room_000001]", "exhibits: [ex_000001]", 'when: { day: 1, time: "10:00" }', "duration: PT2H"),
        "manuscript/01-one/02.md": scene("sc_000002", "Later", second, 'when: { day: 1, time: "11:00" }'),
        "bible/witnesses/ada.md": entry("wit_000001", "Ada"),
        "bible/rooms/hall.md": entry("room_000001", "The Hall"),
        "bible/rooms/cellar.md": entry("room_000002", "The Cellar"),
        "bible/exhibits/knife.md": entry("ex_000001", "The Knife"),
        "bible/exhibits/rope.md": entry("ex_000002", "The Rope"),
      }),
      inquest,
    );
  const warnings = async (second: string) => validateBook(await book(second)).filter((d) => d.code === "W_TIME_OVERLAP").map((d) => d.message);

  it("finds a person in two places at once, from the types' `is`", async () => {
    expect(await warnings("seen: [wit_000001]\nrooms: [room_000002]")).toEqual(["Ada is at The Hall in “Morning” and at The Cellar in “Later” at the same time"]);
  });

  it("but not an entry of a type that is neither, in two of anything", async () => {
    expect(await warnings("exhibits: [ex_000001]\nrooms: [room_000002]")).toEqual([]);
  });
});
