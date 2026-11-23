import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ID_ALPHABET } from "@writer/core";
import { writeBigNovel } from "./big-novel.ts";
import type { App } from "./fixtures.ts";

/**
 * A long book with a large index (#177), for the index's performance spec: the 200,000-word novel of
 * big-novel.ts, its index grown to about 500 entries across the kind's types (characters, locations,
 * artifacts, plotlines and themes). Each type declares its fields (D18) and its entries fill them in;
 * the characters have relationships with each other and hold the artifacts; every scene mentions a few
 * of them, linked, and every fourth names one without a link, for Tidy up to find. In format 3
 * (book.yaml), committed as a git repository.
 */

/** An ID in the format's alphabet: char_000001, loc_000002… (from 1000 on: clear of big-novel's). */
const id = (prefix: string, n: number) => `${prefix}_${Array.from({ length: 6 }, (_, i) => ID_ALPHABET[Math.floor((1000 + n) / 32 ** (5 - i)) % 32]).join("")}`;

const FIRST = ["Ilse", "Bram", "Oda", "Feliks", "Maren", "Joss", "Agnes", "Teo", "Rina", "Casimir", "Hedda", "Linus", "Vera", "Oskar", "Petra", "Anselm", "Sabine", "Ruben", "Zofia", "Matthias", "Irma", "Gideon", "Lotte", "Emil"];
const LAST = ["Marrow", "Quist", "Haldane", "Brekke", "Toller", "Vasko", "Ingram", "Pell", "Strand", "Okafor", "Lindqvist", "Dunmore", "Achterberg", "Faye", "Novak", "Ruskin", "Weir", "Castellan", "Hollis", "Yarrow", "Belmont"];
const PLACE = ["Lantern", "Salt", "Ferry", "Willow", "Cooper's", "Gull", "Ropewalk", "Chapel", "Market", "Tannery", "Lock", "Weaver's"];
const SPOT = ["Steps", "Yard", "Quay", "Lane", "Row", "Court", "Wharf", "Close", "Gate", "Mill"];
const THING = ["Key", "Ledger", "Lamp", "Compass", "Seal", "Bell", "Chart", "Ring"];
const MATERIAL = ["Brass", "Oak", "Iron", "Silver", "Bone"];
export const OCCUPATIONS = ["Ferryman", "Toll keeper", "Clerk", "Engineer", "Baker", "Surveyor", "Teacher", "Fisher"];
const THREADS = ["The toll debt", "The flooded cellar", "The forged deed", "The missing barge", "The council vote", "The night crossing", "The bell tower", "The old survey", "The second bridge", "The weir keeper's secret", "The ferry strike", "The sealed letter", "The salt tax", "The lantern feud", "The drowned map"];
const THEMES = ["Memory", "Duty", "Belonging", "Debt", "Silence", "Pride", "Mercy", "Exile", "Craft", "Faith", "Thrift", "Weather"];

export interface BigIndex {
  characters: number;
  locations: number;
  artifacts: number;
  plotlines: number;
  themes: number;
}

/** About 500 entries with the sample's own: 304 characters, 124 locations, 41 artifacts, 17 plotlines, 14 themes. */
export const BIG_INDEX: BigIndex = { characters: 300, locations: 120, artifacts: 40, plotlines: 15, themes: 12 };

export const characterName = (i: number) => `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`;

/** Writes the book in `app`'s novels folder and commits it; returns its folder. */
export function writeBigIndex(app: App, counts: Partial<BigIndex> = {}): string {
  const n = { ...BIG_INDEX, ...counts };
  const dir = join(app.home, "novels", "the-long-crossing");
  writeBigNovel(dir, { total: 200_000, extraCharacters: 0 });

  // Format 3, the types' fields declared: the artifact (the sample's own type) in its entry, the kind's types in entity_fields.
  const manifest = readFileSync(join(dir, "novel.yaml"), "utf8")
    .replace(/^schema_version: 2$/m, "schema_version: 3\nkind: novel")
    .replace(/^(\s+)color: 8c564b$/m, `$1color: 8c564b\n$1fields:\n$1  - key: maker\n$1    holds: entry\n$1    type: character\n$1  - key: condition\n$1    holds: choice\n$1    options: [whole, cracked, lost]\n$1    card: true`);
  rmSync(join(dir, "novel.yaml"));
  writeFileSync(
    join(dir, "book.yaml"),
    `${manifest.trimEnd()}
entity_fields:
  character:
    - key: age
      holds: number
      card: true
    - key: occupation
      holds: text
      card: true
    - key: home
      holds: entry
      type: location
    - key: status
      holds: choice
      options: [here, away, gone]
      changes: true
  location:
    - key: kind_of_place
      holds: choice
      options: [street, quay, house, yard, workshop]
      card: true
    - key: built
      holds: number
`,
  );

  const characters = Array.from({ length: n.characters }, (_, i) => ({ id: id("char", i), name: characterName(i), i }));
  const locations = Array.from({ length: n.locations }, (_, i) => ({ id: id("loc", i), name: `${PLACE[i % PLACE.length]} ${SPOT[Math.floor(i / PLACE.length) % SPOT.length]}`, i }));
  const artifacts = Array.from({ length: n.artifacts }, (_, i) => ({ id: id("art", i), name: `The ${MATERIAL[i % MATERIAL.length]} ${THING[Math.floor(i / MATERIAL.length) % THING.length]}`, i }));
  const plotlines = Array.from({ length: n.plotlines }, (_, i) => ({ id: id("plot", i), name: THREADS[i % THREADS.length]!, i }));
  const themes = Array.from({ length: n.themes }, (_, i) => ({ id: id("theme", i), name: THEMES[i % THEMES.length]!, i }));

  const write = (folder: string, e: { id: string; name: string }, front: string, body: string) => writeFileSync(join(dir, "bible", folder, `${e.id}.md`), `---\nid: ${e.id}\nname: ${e.name}\n${front}---\n${body}\n`);
  for (const c of characters) {
    const home = locations.length ? `  home: ${locations[c.i % locations.length]!.id}\n` : "";
    write("characters", c, `summary: Someone from the ${c.i % 2 ? "east" : "west"} bank who remembers the old bridge.\nfields:\n  age: ${20 + (c.i % 60)}\n  occupation: ${OCCUPATIONS[c.i % OCCUPATIONS.length]}\n${home}  status: here\ntags: [${c.i % 3 ? "town" : "river"}]\n`, `Grew up near pier ${1 + (c.i % 9)}. Keeps a ledger of the tolls.`);
  }
  for (const l of locations) write("locations", l, `summary: A corner of the town by the water.\nfields:\n  kind_of_place: ${["street", "quay", "house", "yard", "workshop"][l.i % 5]}\n  built: ${1700 + l.i}\ntags: [town]\n`, "Cobbles, a lamp, the sound of the weir.");
  for (const a of artifacts) write("artifacts", a, `summary: Kept, lost and found again.\nfields:\n${characters.length ? `  maker: ${characters[(a.i * 7) % characters.length]!.id}\n` : ""}  condition: ${["whole", "cracked", "lost"][a.i % 3]}\n`, "Worn smooth where it's held.");
  for (const p of plotlines) write("plotlines", p, "summary: A thread through the book.\n", "Where it starts, and where it should end.");
  for (const t of themes) write("themes", t, "summary: What the book keeps coming back to.\n", "");

  // Relationships: neighbours allied, every fifth owing another, each artifact held by someone.
  let r = 0;
  const rel = (from: string, to: string, type: string) => `  - id: ${id("rel", r++)}\n    from: ${from}\n    to: ${to}\n    type: ${type}\n`;
  const relationships = [
    ...characters.filter((c) => c.i % 2 === 0 && characters[c.i + 1]).map((c) => rel(c.id, characters[c.i + 1]!.id, "allies")),
    ...characters.filter((c) => c.i % 5 === 0 && characters.length > 7).map((c) => rel(c.id, characters[(c.i + 7) % characters.length]!.id, "owes")),
    ...(characters.length ? artifacts.map((a) => rel(characters[(a.i * 11) % characters.length]!.id, a.id, "holds")) : []),
  ];
  writeFileSync(join(dir, "bible/relationships.yaml"), `relationships:\n${relationships.join("")}`);

  // Mentions through the manuscript: each scene a paragraph naming a few, linked, and every fourth one more without a link.
  const link = (e: { id: string; name: string }) => `[${e.name}](#${e.id})`;
  const scenes: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (f.isDirectory()) walk(join(d, f.name));
      else if (/^\d\d-scene-\d+\.md$/.test(f.name)) scenes.push(join(d, f.name));
    }
  };
  walk(join(dir, "manuscript"));
  scenes.forEach((path, k) => {
    const pick = <T>(list: T[], at: number) => (list.length ? [list[at % list.length]!] : []);
    const who = [...pick(characters, k * 3), ...pick(characters, k * 3 + 1), ...pick(characters, k * 3 + 2)];
    const where = [...pick(locations, k), ...pick(artifacts, k)];
    const named = [...who, ...where];
    if (!named.length) return;
    let paragraph = `${named.map(link).join(", ")} were at the crossing that evening.`;
    const plain = pick(characters, k * 3 + 150);
    if (k % 4 === 0 && plain[0]) paragraph += ` ${plain[0].name} watched from the far bank.`;
    writeFileSync(path, `${readFileSync(path, "utf8").trimEnd()}\n\n${paragraph}\n`);
  });

  app.git(dir, "init", "-q");
  app.git(dir, "add", "-A");
  app.git(dir, "commit", "-qm", "Start");
  return dir;
}
