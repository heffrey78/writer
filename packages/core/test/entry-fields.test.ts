import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { backlinks, cardFields, editFrontMatter, entriesNamedBy, fieldLabel, fieldsOfType, fieldText, holdsValue, kindByKey, knownKinds, loadBook, memorySource, validate } from "../src/index.ts";

/** A type's fields (D18, #138): declared by the kind and the book, values in an entry's fields, checked alike everywhere. */

const sample = (name: string) => fileURLToPath(new URL(`../../../examples/sample-${name}`, import.meta.url));
const files = (dir: string): Record<string, string> =>
  Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && !e.parentPath.includes(".github"))
      .map((e) => {
        const path = join(e.parentPath, e.name);
        return [path.slice(dir.length + 1), readFileSync(path, "utf8")];
      }),
  );
const CAMPAIGN = files(sample("campaign"));
const NOVEL = files(sample("novel"));
const VOSS = "codex/npcs/voss.md";
/** Voss with these lines under `fields:`. */
const voss = (fields: string) => CAMPAIGN[VOSS]!.replace("summary: Choirmaster of the Tide Choir.\n", `summary: Choirmaster of the Tide Choir.\nfields:\n${fields}`);
const campaign = (changes: Record<string, string>) => memorySource({ ...CAMPAIGN, ...changes });
const said = async (source: ReturnType<typeof memorySource>) => (await validate(source)).diagnostics.map((d) => [d.code, d.file, d.pointer, d.message]);

describe("each kind's fields", () => {
  it("are declared for its built-in types, well formed, naming types the kind has", () => {
    for (const kind of knownKinds()) {
      const types = new Set(kind.entityTypes.map((t) => t.key));
      for (const t of kind.entityTypes) {
        const keys = (t.fields ?? []).map((f) => f.key);
        expect(new Set(keys).size, `${kind.key} ${t.key}`).toBe(keys.length);
        for (const f of t.fields ?? []) {
          expect(f.key).toMatch(/^[a-z][a-z0-9_]*$/);
          if (f.type) expect(types.has(f.type), `${kind.key} ${t.key}.${f.key}`).toBe(true);
          expect(f.holds === "choice", `${t.key}.${f.key}`).toBe(!!f.options?.length);
        }
      }
    }
    expect(kindByKey("campaign").entityTypes.find((t) => t.key === "npc")!.fields!.map(fieldLabel)).toEqual(["Status", "Faction", "Disposition", "Location", "Voice"]);
  });

  it("are the type's unless the book declares its own, and a book's own type has the fields it declares", async () => {
    const book = await loadBook(
      campaign({
        "book.yaml": `${CAMPAIGN["book.yaml"]}entity_fields:\n  npc:\n    - key: oath\n      holds: text\nentity_types:\n  - key: ship\n    prefix: shp\n    folder: ships\n    fields:\n      - key: captain\n        holds: entry\n        type: npc\n`,
      }),
    );
    expect(fieldsOfType(book, "npc")).toEqual([{ key: "oath", holds: "text" }]);
    expect(fieldsOfType(book, "faction").map((f) => f.key)).toEqual(["leader", "goal"]);
    expect(fieldsOfType(book, "ship")).toEqual([{ key: "captain", holds: "entry", type: "npc" }]);
    expect(fieldsOfType(book, "location")).toEqual([]);
  });

  it("reads a field's label from its key", () => {
    expect(fieldLabel({ key: "kind_of_place" })).toBe("Kind of place");
    expect(fieldLabel({ key: "url", label: "URL" })).toBe("URL");
  });
});

describe("an entry's values", () => {
  it("names an entry by its ID, read as its name, and the named entry lists who names it", async () => {
    const source = campaign({ [VOSS]: voss("  status: alive\n  faction: fac_t1de00\n  location: loc_be1fry\n") });
    expect(await said(source)).toEqual([]);
    const book = await loadBook(source);
    const entry = book.entities.find((e) => e.id === "npc_v0ss01")!;
    expect(entriesNamedBy(book, entry).map(({ field, ids }) => [field.key, ids])).toEqual([
      ["faction", ["fac_t1de00"]],
      ["location", ["loc_be1fry"]],
    ]);
    expect(fieldText(book, entry.fields["faction"]!)).toBe("The Tide Choir");
    expect(backlinks(book, "fac_t1de00").entries.map(({ entry, field }) => [entry.name, field.key])).toEqual([["Voss", "faction"]]);
  });

  it("holds a list of IDs in a book in format 3", async () => {
    const source = campaign({ [VOSS]: voss("  rivals: [npc_ma7ra1, fac_watch0]\n") });
    expect(await said(source)).toEqual([]);
    const book = await loadBook(source);
    expect(book.entities.find((e) => e.id === "npc_v0ss01")!.fields["rivals"]).toEqual(["npc_ma7ra1", "fac_watch0"]);
    expect(backlinks(book, "npc_ma7ra1").entries).toEqual([]);
  });

  it("refuses a list in a novel in format 2, which gh-writer reads, and reads its fields as before", async () => {
    expect(await said(memorySource(NOVEL))).toEqual([]);
    const ada = "bible/characters/ada.md";
    const source = memorySource({ ...NOVEL, [ada]: NOVEL[ada]!.replace("  eyes: grey\n", "  eyes: grey\n  friends: [char_b3n000]\n") });
    expect(await said(source)).toEqual([["E_SCHEMA", ada, "/fields/friends", "fields.friends is a list, which only a book in format 3 may have"]]);
    const book = await loadBook(source);
    expect(book.entities.find((e) => e.file === ada)!.fields).toEqual({ age: 31, occupation: "Structural engineer", eyes: "grey" });
  });

  it("reports an entry naming nothing, an entry of the wrong type, and a value its field doesn't hold", async () => {
    const source = campaign({ [VOSS]: voss("  status: drowned\n  faction: npc_ma7ra1\n  location: loc_n0n3xx\n  voice: 3\n  allies: [fac_n0n3xx]\n") });
    expect(await said(source)).toEqual([
      ["E_DANGLING_REF", VOSS, "/fields/allies/0", "fields.allies refers to fac_n0n3xx, which does not exist"],
      ["E_REF_TYPE", VOSS, "/fields/faction", "fields.faction must be a faction, but npc_ma7ra1 is a npc"],
      ["E_DANGLING_REF", VOSS, "/fields/location", "fields.location refers to loc_n0n3xx, which does not exist"],
      ["W_FIELD_VALUE", VOSS, "/fields/status", "fields.status is \"drowned\", but Status holds one of alive, dead, missing or unknown"],
      ["W_FIELD_VALUE", VOSS, "/fields/voice", "fields.voice is 3, but Voice holds text"],
    ]);
  });

  it("warns, not refuses, of an entry written as a name", async () => {
    const source = campaign({ [VOSS]: voss("  faction: The Tide Choir\n") });
    expect(await said(source)).toEqual([["W_FIELD_VALUE", VOSS, "/fields/faction", "fields.faction is \"The Tide Choir\", but Faction holds the ID of a faction"]]);
  });

  it("checks each holds", () => {
    expect(holdsValue({ key: "n", holds: "number" }, 3)).toBe(true);
    expect(holdsValue({ key: "n", holds: "number" }, "3")).toBe(false);
    expect(holdsValue({ key: "y", holds: "yes-no" }, false)).toBe(true);
    expect(holdsValue({ key: "c", holds: "choice", options: ["a"] }, "a")).toBe(true);
    expect(holdsValue({ key: "e", holds: "entries" }, ["npc_ma7ra1"])).toBe(true);
    expect(holdsValue({ key: "e", holds: "entries" }, "npc_ma7ra1")).toBe(false);
    expect(holdsValue({ key: "t", holds: "time" }, "1490-03-12")).toBe(true);
  });
});

describe("declarations in book.yaml", () => {
  const withManifest = (yaml: string) => said(campaign({ "book.yaml": `${CAMPAIGN["book.yaml"]}${yaml}` }));

  it("are reported when malformed, doubled or naming a type there isn't", async () => {
    expect(await withManifest("entity_fields:\n  npc:\n    - key: oath\n      holds: text\n    - key: oath\n      holds: number\n    - key: ship\n      holds: entry\n      type: ship\n")).toEqual([
      ["E_SCHEMA", "book.yaml", "/entity_fields/npc/1", "NPC has two fields “oath”"],
      ["E_ENTITY_TYPE", "book.yaml", "/entity_fields/npc/2/type", "NPC's field “ship” names entries of a type there isn't, “ship”"],
    ]);
    const bad = await withManifest("entity_fields:\n  npc:\n    - key: mood\n      holds: choice\n    - key: Bad\n      holds: feeling\n");
    expect(bad.map(([code, , pointer]) => [code, pointer])).toEqual([
      ["E_SCHEMA", "/entity_fields/npc/0"],
      ["E_SCHEMA", "/entity_fields/npc/1/holds"],
      ["E_SCHEMA", "/entity_fields/npc/1/key"],
    ]);
  });

  it("are for the kind's types alone under entity_fields", async () => {
    expect(await withManifest("entity_fields:\n  dragon:\n    - key: hoard\n      holds: text\n")).toEqual([["E_ENTITY_TYPE", "book.yaml", "/entity_fields/dragon", "entity_fields names “dragon”, which isn't one of the campaign's types"]]);
  });

  it("round-trip byte for byte through an edit of an entry's fields, comments kept", () => {
    const text = "---\nid: npc_v0ss01\nname: Voss\nfields:\n  # who he answers to\n  faction: fac_t1de00\n---\n";
    const edited = editFrontMatter(text, [{ path: ["fields", "allies"], value: ["npc_ma7ra1"] }]);
    expect(edited).toBe("---\nid: npc_v0ss01\nname: Voss\nfields:\n  # who he answers to\n  faction: fac_t1de00\n  allies:\n    - npc_ma7ra1\n---\n");
    expect(editFrontMatter(edited, [{ path: ["fields", "allies"], remove: true }])).toBe(text);
  });
});

describe("a card", () => {
  it("shows the fields its type puts on cards", async () => {
    const book = await loadBook(campaign({ [VOSS]: voss("  voice: low\n  faction: fac_t1de00\n  status: alive\n") }));
    expect(cardFields(book, book.entities.find((e) => e.id === "npc_v0ss01")!)).toEqual(["alive", "The Tide Choir"]);
  });
});
