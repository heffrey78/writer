import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EVENT_FILES_FORMAT, memorySource, migration, validate, type Migration } from "@writer/core";
import { SAMPLE_EVENTS_V1 } from "../../../server/test/fixtures.ts";
import { eventsOf, type StoryEvent } from "../src/core/index.ts";

/** Moving a novel's events to files of their own (format v2, D11): the module's step of the base's migration. */

const SAMPLE = fileURLToPath(new URL("../../../../examples/sample-novel", import.meta.url));
const V1 = "schema_version: 1\nid: nv_4k8h2c\ntitle: Tiny\n";

/** Every file of a folder, by repository path. */
function filesOf(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (e.isFile()) out[join(e.parentPath, e.name).slice(root.length + 1)] = readFileSync(join(e.parentPath, e.name), "utf8");
  }
  return out;
}

/** The files after a migration's writes. */
function applied(files: Record<string, string>, m: Migration): Record<string, string> {
  if (m.status !== "migrate") throw new Error(`No migration: ${m.status}`);
  const out = { ...files };
  for (const w of m.writes) {
    if (w.content === null) delete out[w.path];
    else out[w.path] = w.content;
  }
  return out;
}

/** What an event says, wherever it's kept. */
const facts = (e: StoryEvent) => ({ id: e.id, title: e.title, when: e.when, duration: e.duration, characters: e.characters, locations: e.locations, plotlines: e.plotlines, note: e.body.trim() });


describe("migration to format v2 (D11)", () => {
  it("moves the sample in format v1 to exactly the sample as it is, losing nothing, and validates clean", async () => {
    const now = filesOf(SAMPLE);
    // The sample as format v1 had it: its events in bible/events.yaml.
    const before = Object.fromEntries(Object.entries(now).filter(([p]) => !p.startsWith("bible/events/")));
    before["bible/events.yaml"] = SAMPLE_EVENTS_V1;
    before["novel.yaml"] = now["novel.yaml"]!.replace("schema_version: 2", "schema_version: 1");

    const m = await migration(memorySource(before), EVENT_FILES_FORMAT);
    expect(m).toMatchObject({ status: "migrate", from: 1, to: 2, message: "Format v2: off-page events as files" });
    const after = applied(before, m);
    expect(after).toEqual(now);

    const [old, migrated] = await Promise.all([validate(memorySource(before)), validate(memorySource(after))]);
    expect(migrated.diagnostics).toEqual([]);
    const byId = (es: StoryEvent[]) => es.map(facts).sort((a, b) => a.id.localeCompare(b.id));
    expect(byId(eventsOf(migrated.novel))).toEqual(byId(eventsOf(old.novel)));
    expect(after["bible/events/the-plans-are-stolen.md"]).toBe(
      "---\nid: evt_p1an5t\ntitle: The plans are stolen\nwhen:\n  day: -5\ncharacters:\n  - char_b3n0vs\nlocations:\n  - loc_w0rk5p\nplotlines:\n  - plot_h315tz\n  - plot_gr1efa\n---\n\nOff page. Ben uses Tomas's key.\n",
    );
  });

  it("gives events of the same title their own names, and quotes clock times", async () => {
    const m = await migration(memorySource({
      "novel.yaml": V1,
      "bible/events.yaml": 'events:\n  - {id: evt_aaaaaa, title: Storm, when: {day: 2, time: "22:00"}}\n  - {id: evt_bbbbbb, title: Storm}\n',
    }), EVENT_FILES_FORMAT);
    expect(m.status === "migrate" && m.writes.map((w) => [w.path, w.content])).toEqual([
      ["bible/events/storm.md", '---\nid: evt_aaaaaa\ntitle: Storm\nwhen:\n  day: 2\n  time: "22:00"\n---\n'],
      ["bible/events/storm-2.md", "---\nid: evt_bbbbbb\ntitle: Storm\n---\n"],
      ["bible/events.yaml", null],
      ["novel.yaml", "schema_version: 2\nid: nv_4k8h2c\ntitle: Tiny\n"],
    ]);
  });

  it("refuses a custom type in bible/events/, and files it can't read", async () => {
    const reason = async (files: Record<string, string>) => {
      const m = await migration(memorySource(files), EVENT_FILES_FORMAT);
      return m.status === "refused" ? m.reason : m.status;
    };
    expect(await reason({ "novel.yaml": `${V1}entity_types:\n  - {key: happening, prefix: hap, folder: events, label: Happening}\n` })).toMatch(/“Happening” keeps its entries in bible\/events\//);
    expect(await reason({ "novel.yaml": V1, "bible/events.yaml": "events: [\n" })).toMatch(/bible\/events.yaml can't be read/);
  });
  it("moves format v1 all the way, in one migration", async () => {
    const m = await migration(memorySource({ "novel.yaml": V1, "bible/events.yaml": "events:\n  - {id: evt_aaaaaa, title: Storm}\n" }));
    expect(m).toMatchObject({ status: "migrate", from: 1, to: 3, message: "Format v3: off-page events as files, and the book's settings in book.yaml, naming its kind" });
    expect(m.status === "migrate" && m.writes.map((w) => w.path)).toEqual(["bible/events/storm.md", "bible/events.yaml", "novel.yaml", "book.yaml"]);
  });

});
