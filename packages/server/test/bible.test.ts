import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadBook, relationshipsAt, relationshipStyle, validateBook } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BibleOperations, createServer, hashText, Library, ManuscriptOperations, sessionCookie, transaction } from "../src/index.ts";
import { asFormatV1, gitIn, novelRepo, scratch } from "./fixtures.ts";
import { send } from "./http.ts";

const ADA = "char_7f3k2q";
const BEN = "char_b3n0vs";
const ADA_FILE = "bible/characters/ada.md";

let fresh: (name: string) => string;
let cleanUp: () => void;
let tmp: string;
let dir: string;
let bible: BibleOperations;

beforeAll(() => ({ fresh, cleanUp, tmp } = scratch("bible")));
afterAll(() => cleanUp());

beforeEach(() => {
  dir = novelRepo(fresh("novel"));
  bible = new BibleOperations(dir, (fn) => fn());
});

const read = (path: string) => readFileSync(join(dir, path), "utf8");
const hash = (path: string) => hashText(readFileSync(join(dir, path)));
const lastCommit = () => gitIn(dir, "log", "-1", "--format=%s").trim();
const changedInLastCommit = () => gitIn(dir, "show", "--name-status", "--format=", "HEAD").trim().split("\n").sort();
const clean = () => expect(gitIn(dir, "status", "--porcelain")).toBe("");
const model = () => loadBook(nodeSource(dir));
async function valid() {
  const novel = await model();
  expect(validateBook(novel).filter((d) => d.severity === "error")).toEqual([]);
  return novel;
}

describe("entities", () => {
  it("adds an entity in its type's folder, with a new ID, as one commit", async () => {
    const { id, file, commit } = await bible.createEntity("character", { name: "Ilse Varn", aliases: ["Ilse"], summary: "Ada's aunt." }, "Lives above the toll house.");
    expect(id).toMatch(/^char_[0-9a-hjkmnp-tv-z]{6}$/);
    expect(file).toBe("bible/characters/ilse-varn.md");
    expect(read(file)).toBe(`---\nid: ${id}\nname: Ilse Varn\naliases:\n  - Ilse\nsummary: Ada's aunt.\n---\n\nLives above the toll house.\n`);
    expect(commit).toBe(gitIn(dir, "rev-parse", "HEAD").trim());
    expect(lastCommit()).toBe("Bible: add Ilse Varn");
    clean();
    expect((await valid()).entities.find((e) => e.id === id)?.name).toBe("Ilse Varn");
  });

  it("takes an ID the app picked, if it's new and of the type; a retry returns what was made", async () => {
    const { id, file, commit } = await bible.createEntity("character", { name: "Mira Kostova" }, "", "char_m1rak0");
    expect([id, file]).toEqual(["char_m1rak0", "bible/characters/mira-kostova.md"]);
    expect(read(file)).toBe("---\nid: char_m1rak0\nname: Mira Kostova\n---\n");
    expect(commit).not.toBeNull();
    // The same again (a response lost on the way): nothing new, the same entry.
    const head = gitIn(dir, "rev-parse", "HEAD").trim();
    expect(await bible.createEntity("character", { name: "Mira Kostova" }, "", "char_m1rak0")).toEqual({ commit: null, files: [], id, file });
    expect(gitIn(dir, "rev-parse", "HEAD").trim()).toBe(head);
    // Taken by something else, the wrong type's prefix, or not an ID at all.
    for (const [type, name, wanted] of [["character", "Someone Else", "char_m1rak0"], ["character", "Ada Again", ADA], ["location", "Mira's House", "char_zzzzzz"], ["character", "Odd", "nonsense"]] as const) {
      await expect(bible.createEntity(type, { name }, "", wanted)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    clean();
    await valid();
  });

  it("renames by changing one file and no references", async () => {
    const before = read(ADA_FILE);
    const { file } = await bible.updateEntity(ADA, hash(ADA_FILE), { name: "Ada Kost" });
    expect(file).toBe("bible/characters/ada-kost.md");
    expect(existsSync(join(dir, ADA_FILE))).toBe(false);
    expect(read(file)).toBe(before.replace("name: Ada Varn", "name: Ada Kost"));
    expect(lastCommit()).toBe("Bible: rename Ada Varn to Ada Kost");
    // git sees one file renamed, and nothing else.
    expect(gitIn(dir, "show", "-M", "--name-status", "--format=", "HEAD").trim()).toMatch(/^R\d+\tbible\/characters\/ada\.md\tbible\/characters\/ada-kost\.md$/);
    const novel = await valid();
    expect(novel.entities.find((e) => e.id === ADA)?.name).toBe("Ada Kost");
  });

  it("edits fields in place, and refuses an edit based on an old version", async () => {
    const base = hash(ADA_FILE);
    await bible.updateEntity(ADA, base, { summary: "Engineer.", tags: ["protagonist", "engineer"], fields: { age: 32, occupation: "Structural engineer" } });
    expect(lastCommit()).toBe("Bible: edit Ada Varn");
    const novel = await valid();
    expect(novel.entities.find((e) => e.id === ADA)).toMatchObject({ summary: "Engineer.", tags: ["protagonist", "engineer"], fields: { age: 32 } });
    await expect(bible.updateEntity(ADA, base, { summary: "Again." })).rejects.toMatchObject({ code: "STALE" });
    await expect(bible.updateEntity(ADA, hash(ADA_FILE), { name: " " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("writes only the fields that changed, keeping the rest of fields: as it was (#163)", async () => {
    writeFileSync(join(dir, ADA_FILE), read(ADA_FILE).replace("  age: 31\n", "  # at the start of the book\n  age: 31\n"));
    gitIn(dir, "commit", "-qam", "A comment");
    const before = read(ADA_FILE);
    await bible.updateEntity(ADA, hash(ADA_FILE), { fields: { age: 31, occupation: "Engineer", eyes: "grey", home: "loc_h0me5t" } });
    expect(read(ADA_FILE)).toBe(before.replace("  occupation: Structural engineer\n  eyes: grey\n", "  occupation: Engineer\n  eyes: grey\n  home: loc_h0me5t\n"));
    await bible.updateEntity(ADA, hash(ADA_FILE), { fields: { age: 31, eyes: "grey", home: "loc_h0me5t" } });
    expect(read(ADA_FILE)).toContain("fields:\n  # at the start of the book\n  age: 31\n  eyes: grey\n  home: loc_h0me5t\n");
  });

  it("never writes a list of entries into a novel in format 2, which gh-writer reads (D18)", async () => {
    await expect(bible.updateEntity(ADA, hash(ADA_FILE), { fields: { friends: [BEN] } })).rejects.toMatchObject({ code: "NEEDS_MIGRATION" });
    clean();
    await bible.migrate(3);
    await bible.updateEntity(ADA, hash(ADA_FILE), { fields: { age: 31, occupation: "Structural engineer", eyes: "grey", friends: [BEN] } });
    expect(read(ADA_FILE)).toContain(`  eyes: grey\n  friends:\n    - ${BEN}\n`);
    expect((await valid()).entities.find((e) => e.id === ADA)!.fields["friends"]).toEqual([BEN]);
  });

  it("writes a value that changes at a piece into the entry's file alone, in a book in format 3 (#165)", async () => {
    const change = { field: "occupation", value: "Bridge keeper", since: "sc_5tat1n" };
    await expect(bible.updateEntity(ADA, hash(ADA_FILE), { changes: [change] })).rejects.toMatchObject({ code: "NEEDS_MIGRATION" });
    await bible.migrate(3);
    await expect(bible.updateEntity(ADA, hash(ADA_FILE), { changes: [{ ...change, since: "sc_n0n3xx" }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const before = read(ADA_FILE);
    await bible.updateEntity(ADA, hash(ADA_FILE), { changes: [change] });
    expect(changedInLastCommit()).toEqual([`M\t${ADA_FILE}`]);
    expect(read(ADA_FILE)).toBe(before.replace("---\nLeft", "changes:\n  - field: occupation\n    value: Bridge keeper\n    since: sc_5tat1n\n---\nLeft"));
    expect((await valid()).entities.find((e) => e.id === ADA)!.changes).toEqual([change]);
  });

  it("refuses to delete an entity that's referred to, listing every reference, until confirmed", async () => {
    const head = gitIn(dir, "rev-parse", "HEAD").trim();
    const refusal = await bible.deleteEntity(ADA, hash(ADA_FILE)).catch((e: unknown) => e);
    expect(refusal).toMatchObject({ code: "REFERENCED" });
    const references = (refusal as { details: { references: { kind: string; id: string }[] } }).details.references;
    expect(references).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "scene", id: "sc_5tat1n" }), expect.objectContaining({ kind: "relationship" })]));
    expect(gitIn(dir, "rev-parse", "HEAD").trim()).toBe(head);
    expect(existsSync(join(dir, ADA_FILE))).toBe(true);

    await bible.deleteEntity(ADA, hash(ADA_FILE), true);
    expect(existsSync(join(dir, ADA_FILE))).toBe(false);
    expect(lastCommit()).toBe("Bible: remove Ada Varn");
    expect(changedInLastCommit()).toEqual([`D\t${ADA_FILE}`]);
  });

  it("deletes an entity nobody refers to without asking", async () => {
    const { id, file } = await bible.createEntity("location", { name: "The Old Mill" });
    await bible.deleteEntity(id, hash(file));
    expect(existsSync(join(dir, file))).toBe(false);
    await valid();
  });
});

describe("many entries at once (#167)", () => {
  const BEN_FILE = "bible/characters/ben.md";

  it("sets a field on several entries in one commit, named for it, and undoes it byte for byte", async () => {
    writeFileSync(join(dir, ADA_FILE), read(ADA_FILE).replace("  age: 31\n", "  # at the start of the book\n  age: 31\n"));
    gitIn(dir, "commit", "-qam", "A comment");
    const [ada, ben] = [read(ADA_FILE), read(BEN_FILE)];
    const novel = await model();
    const fields = (id: string) => novel.entities.find((e) => e.id === id)!.fields;
    const { commit, files } = await bible.editEntries([
      { id: ADA, base: hash(ADA_FILE), changes: { fields: { ...fields(ADA), eyes: "green" } } },
      { id: BEN, base: hash(BEN_FILE), changes: { fields: { ...fields(BEN), eyes: "brown" } } },
    ]);
    expect(lastCommit()).toBe("Bible: set Eyes on Ada Varn and Ben Varn");
    expect(changedInLastCommit()).toEqual([`M\t${ADA_FILE}`, `M\t${BEN_FILE}`]);
    expect(read(ADA_FILE)).toBe(ada.replace("eyes: grey", "eyes: green"));
    expect(read(BEN_FILE)).toBe(ben.replace("  occupation: Toll keeper\n", "  occupation: Toll keeper\n  eyes: brown\n"));
    clean();

    await bible.undo(commit!, files);
    expect(lastCommit()).toBe("Undo “Bible: set Eyes on Ada Varn and Ben Varn”");
    expect([read(ADA_FILE), read(BEN_FILE)]).toEqual([ada, ben]);
    clean();
    await valid();
  });

  it("names a tag added to each, and a field cleared on each", async () => {
    const novel = await model();
    const entry = (id: string) => novel.entities.find((e) => e.id === id)!;
    await bible.editEntries([ADA, BEN].map((id) => ({ id, base: hash(id === ADA ? ADA_FILE : BEN_FILE), changes: { tags: [...entry(id).tags, "family"] } })));
    expect(lastCommit()).toBe("Bible: tag Ada Varn and Ben Varn “family”");
    await bible.editEntries([ADA, BEN].map((id) => {
      const { occupation: _, ...rest } = entry(id).fields;
      return { id, base: hash(id === ADA ? ADA_FILE : BEN_FILE), changes: { fields: rest } };
    }));
    expect(lastCommit()).toBe("Bible: clear Occupation on Ada Varn and Ben Varn");
    expect((await valid()).entities.filter((e) => e.id === ADA || e.id === BEN).map((e) => e.fields["occupation"])).toEqual([undefined, undefined]);
  });

  it("changes none of them when one changed since it was read", async () => {
    const stale = hash(BEN_FILE);
    writeFileSync(join(dir, BEN_FILE), read(BEN_FILE).replace("Toll keeper", "Ferryman"));
    gitIn(dir, "commit", "-qam", "Elsewhere");
    const ada = read(ADA_FILE);
    await expect(bible.editEntries([
      { id: ADA, base: hash(ADA_FILE), changes: { summary: "Changed." } },
      { id: BEN, base: stale, changes: { summary: "Changed." } },
    ])).rejects.toMatchObject({ code: "STALE", details: { path: BEN_FILE } });
    expect(read(ADA_FILE)).toBe(ada);
    clean();
    await expect(bible.editEntries([])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(bible.editEntries([{ id: ADA, base: hash(ADA_FILE), changes: {} }, { id: ADA, base: hash(ADA_FILE), changes: {} }])).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("won't undo a change once its files have changed again", async () => {
    const { commit, files } = await bible.editEntries([{ id: ADA, base: hash(ADA_FILE), changes: { summary: "First." } }]);
    await bible.updateEntity(ADA, hash(ADA_FILE), { summary: "Second." });
    await expect(bible.undo(commit!, files)).rejects.toMatchObject({ code: "STALE", details: { path: ADA_FILE } });
    expect(read(ADA_FILE)).toContain("summary: Second.");
    await expect(bible.undo("0".repeat(40), files)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("undoes a new entry by removing its file", async () => {
    const { commit, files, file } = await bible.createEntity("location", { name: "The Weir" });
    await bible.undo(commit!, files);
    expect(existsSync(join(dir, file))).toBe(false);
    clean();
  });

  it("adds a relationship from each of several entries in one commit", async () => {
    const before = read("bible/relationships.yaml");
    const { ids, commit, files } = await bible.addRelationships([{ from: ADA, to: "char_m1re1a", type: "rivals" }, { from: BEN, to: "char_m1re1a", type: "rivals" }]);
    expect(ids).toHaveLength(2);
    expect(lastCommit()).toBe("Bible: add 2 “rivals” relationships");
    const novel = await valid();
    expect(ids.map((id) => novel.relationships.find((r) => r.id === id)?.from)).toEqual([ADA, BEN]);
    await expect(bible.addRelationships([{ from: ADA, to: BEN, type: "rivals" }, { from: ADA, to: BEN, type: "nope" }])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await bible.undo(commit!, files);
    expect(read("bible/relationships.yaml")).toBe(before);
  });
});

describe("Link all (#172)", () => {
  const LEDGER = "manuscript/01-return/02-old-debts/02-bens-ledger.md";
  const FLOOD = "manuscript/02-the-sale/01-night-crossing/02-the-flood.md";

  it("makes every plain Ben a mention in one commit, each piece listing him, nothing else changed; undone byte for byte", async () => {
    const [ledger, flood] = [read(LEDGER), read(FLOOD)];
    const { commit, files, linked } = await bible.linkNames(BEN);
    expect(linked).toBe(3);
    expect(files.sort()).toEqual([FLOOD, LEDGER].sort());
    expect(lastCommit()).toBe("Bible: link Ben Varn in 2 scenes");
    expect(read(LEDGER)).toBe(ledger.replace("which meant Ben had", "which meant [Ben](#char_b3n0vs) had").replace("characters: [char_7f3k2q]", "characters: [char_7f3k2q, char_b3n0vs]"));
    expect(read(FLOOD)).toBe(flood.replace("Ben was fourteen", "[Ben](#char_b3n0vs) was fourteen").replace("Nobody gave Ben anything", "Nobody gave [Ben](#char_b3n0vs) anything"));
    const novel = await valid();
    expect(novel.pieces.flatMap((p) => p.body.match(/(?<!\[)\bBen\b(?!\])/g) ?? [])).toEqual([]);
    clean();
    await bible.undo(commit!, files);
    expect([read(LEDGER), read(FLOOD)]).toEqual([ledger, flood]);
  });

  it("leaves a word judged not a name there, links only the pieces asked for, and refuses a piece changed since it was read", async () => {
    await bible.notAName({ entry: BEN, piece: "sc_f100d0", sentence: "Nobody gave Ben anything to hold.", nth: 0 });
    expect((await bible.linkNames(BEN, ["sc_f100d0"])).linked).toBe(1);
    expect(read(FLOOD)).toContain("Nobody gave Ben anything");
    expect(read(LEDGER)).toContain("which meant Ben had");
    await expect(bible.linkNames(BEN, undefined, { sc_1edger: "0".repeat(64) })).rejects.toMatchObject({ code: "STALE" });
    expect(await bible.linkNames(BEN, ["sc_f100d0"])).toEqual({ commit: null, files: [], linked: 0 });
  });
});

describe("the index's judgements (D19, #171)", () => {
  const PIECE = "sc_5tat1n";
  const judgement = { entry: ADA, piece: PIECE, sentence: "Ada said she would go.", nth: 0 };

  it("keeps Not a name here as a line of not-names.yaml, with .gitattributes merging it line by line, in one commit", async () => {
    const { files } = await bible.notAName(judgement);
    expect(files.sort()).toEqual([".gitattributes", "bible/not-names.yaml"]);
    expect(read("bible/not-names.yaml")).toBe(`# Words that look like an entry's name but aren't it here (Not a name here). One per line; kept by Writer.\n- { entry: ${ADA}, piece: ${PIECE}, sentence: "Ada said she would go.", nth: 0 }\n`);
    expect(read(".gitattributes")).toContain("bible/not-names.yaml merge=union\nbible/different.yaml merge=union\n");
    expect(lastCommit()).toMatch(/^Bible: a word in “.+” isn't Ada Varn$/);
    clean();
    expect((await valid()).notNames).toEqual([judgement]);
    // Asked again: nothing. Another: a line added, .gitattributes left alone.
    expect(await bible.notAName(judgement)).toEqual({ commit: null, files: [] });
    const second = await bible.notAName({ ...judgement, nth: 1 });
    expect(second.files).toEqual(["bible/not-names.yaml"]);
    expect(read("bible/not-names.yaml").trimEnd().split("\n")).toHaveLength(3);
    // A name there again: its line out, the other kept.
    await bible.forgetNotAName(judgement);
    expect((await model()).notNames).toEqual([{ ...judgement, nth: 1 }]);
    expect(lastCommit()).toBe("Bible: offer Ada Varn there again");
    await expect(bible.notAName({ ...judgement, entry: "char_zzzzzz" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(bible.notAName({ ...judgement, nth: -1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("keeps They're different as a pair, either way round, and forgets it", async () => {
    await bible.areDifferent(BEN, ADA);
    expect(read("bible/different.yaml")).toContain(`- [${ADA}, ${BEN}]\n`);
    expect(lastCommit()).toBe("Bible: Ben Varn and Ada Varn are different");
    expect(await bible.areDifferent(ADA, BEN)).toEqual({ commit: null, files: [] });
    await bible.forgetDifferent(ADA, BEN);
    expect((await model()).different).toEqual([]);
    clean();
  });

  it("adds to a .gitattributes the book has, and to a judgements file edited by hand", async () => {
    writeFileSync(join(dir, ".gitattributes"), "*.md text");
    writeFileSync(join(dir, "bible/not-names.yaml"), "# mine\n- { entry: char_7f3k2q, piece: sc_5tat1n, sentence: \"Other.\", nth: 0 }");
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-qm", "By hand");
    await bible.notAName(judgement);
    expect(read(".gitattributes")).toBe("*.md text\nbible/not-names.yaml merge=union\nbible/different.yaml merge=union\n");
    expect(read("bible/not-names.yaml")).toBe(`# mine\n- { entry: char_7f3k2q, piece: sc_5tat1n, sentence: "Other.", nth: 0 }\n- { entry: ${ADA}, piece: ${PIECE}, sentence: "Ada said she would go.", nth: 0 }\n`);
  });

  it("merges two devices' judgements without a conflict", async () => {
    await bible.notAName(judgement);
    const base = gitIn(dir, "rev-parse", "HEAD").trim();
    await bible.notAName({ ...judgement, sentence: "Another sentence.", nth: 0 });
    const ours = gitIn(dir, "rev-parse", "HEAD").trim();
    gitIn(dir, "checkout", "-q", "-b", "theirs", base);
    await bible.notAName({ ...judgement, sentence: "A third one.", nth: 0 });
    gitIn(dir, "checkout", "-q", "main");
    gitIn(dir, "merge", "-q", "--no-edit", "theirs");
    expect(gitIn(dir, "rev-parse", "HEAD^1").trim()).toBe(ours);
    expect((await valid()).notNames.map((n) => n.sentence).sort()).toEqual(["A third one.", "Ada said she would go.", "Another sentence."]);
  });
});

describe("relationships", () => {
  it("adds, changes at a scene, ends and removes a relationship", async () => {
    const before = (await model()).relationships.length;
    const { id } = await bible.createRelationship({ from: ADA, to: "char_m1re1a", type: "allies", note: "Against the council." });
    expect(lastCommit()).toBe("Bible: Ada Varn allies Mirela Kost");
    let novel = await valid();
    expect(novel.relationships).toHaveLength(before + 1);

    // From "The Betrayal" on, they're rivals.
    const { id: next } = await bible.changeRelationship(id, "sc_0d9wm4", { type: "rivals" });
    novel = await valid();
    expect(novel.relationships.find((r) => r.id === id)).toMatchObject({ type: "allies", until: "sc_0d9wm4" });
    expect(novel.relationships.find((r) => r.id === next)).toMatchObject({ type: "rivals", since: "sc_0d9wm4", note: "Against the council." });
    const between = (scene: string) => relationshipsAt(novel, scene).filter((r) => [r.from, r.to].includes("char_m1re1a") && [r.from, r.to].includes(ADA)).map((r) => r.type);
    expect(between("sc_br1dg3")).toContain("allies");
    expect(between("sc_br1dg3")).not.toContain("rivals");
    expect(between("sc_f100d0")).toContain("rivals");
    expect(between("sc_f100d0")).not.toContain("allies");

    await bible.endRelationship(next, "sc_r1vet8");
    expect((await valid()).relationships.find((r) => r.id === next)?.until).toBe("sc_r1vet8");
    await bible.updateRelationship(next, { note: null });
    expect((await model()).relationships.find((r) => r.id === next)?.note).toBeUndefined();
    await bible.deleteRelationship(id);
    expect((await valid()).relationships.some((r) => r.id === id)).toBe(false);
    clean();
  });

  it("refuses relationships that don't fit the novel", async () => {
    await expect(bible.createRelationship({ from: ADA, to: "char_zzzzzz", type: "allies" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(bible.createRelationship({ from: ADA, to: BEN, type: "enemies" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(bible.createRelationship({ from: ADA, to: BEN, type: "allies", since: "sc_f100d0", until: "sc_5tat1n" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("writes the first relationship of an empty file as a block list", async () => {
    writeFileSync(join(dir, "bible/relationships.yaml"), "# Every relationship, once.\nrelationships: []\n");
    gitIn(dir, "commit", "-qam", "Empty");
    const { id } = await bible.createRelationship({ from: ADA, to: BEN, type: "sibling" });
    expect(read("bible/relationships.yaml")).toBe(`# Every relationship, once.\nrelationships:\n  - id: ${id}\n    from: ${ADA}\n    to: ${BEN}\n    type: sibling\n`);
  });
});

describe("types", () => {
  it("sets a type's fields in book.yaml, renaming a field's values in its entries in the same commit (#164)", async () => {
    await expect(bible.setTypeFields("character", [{ key: "age", holds: "number" }])).rejects.toMatchObject({ code: "NEEDS_MIGRATION" });
    await bible.migrate(3);
    const before = read("book.yaml");
    await bible.setTypeFields(
      "character",
      [
        { key: "age", holds: "number", card: true },
        { key: "eye_colour", label: "Eye colour", holds: "text" },
        { key: "home", holds: "entry", type: "location", changes: true },
        { key: "mood", holds: "choice", options: ["calm", " calm", "", "fraught"] },
      ],
      [{ from: "eyes", to: "eye_colour" }],
    );
    expect(lastCommit()).toBe("Bible: the fields of Characters, renaming “eyes” in its entries");
    expect(changedInLastCommit()).toEqual([`M\t${ADA_FILE}`, "M\tbook.yaml"]);
    expect(read("book.yaml")).toBe(
      `${before}entity_fields:\n  character:\n    - key: age\n      holds: number\n      card: true\n    - key: eye_colour\n      holds: text\n    - key: home\n      holds: entry\n      type: location\n      changes: true\n    - key: mood\n      holds: choice\n      options:\n        - calm\n        - fraught\n`,
    );
    expect(read(ADA_FILE)).toContain("fields:\n  age: 31\n  occupation: Structural engineer\n  eye_colour: grey\n");
    const novel = await valid();
    expect(novel.entityTypes.find((t) => t.key === "character")!.fields!.map((f) => f.key)).toEqual(["age", "eye_colour", "home", "mood"]);

    // The book's own type keeps its list under its entry; a list that can't be is refused.
    await bible.createEntityType({ key: "vehicle", prefix: "veh", label: "Vehicle" });
    await bible.setTypeFields("vehicle", [{ key: "driver", holds: "entry", type: "character" }]);
    expect(read("book.yaml")).toContain("    label: Vehicle\n    fields:\n      - key: driver\n        holds: entry\n        type: character\n");
    await expect(bible.setTypeFields("vehicle", [{ key: "Driver", holds: "text" }])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(bible.setTypeFields("vehicle", [{ key: "a", holds: "choice" }])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(bible.setTypeFields("vehicle", [{ key: "a", holds: "entry", type: "ship" }])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(bible.setTypeFields("vehicle", [{ key: "a", holds: "text" }, { key: "a", holds: "text" }])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    clean();
  });

  it("adds a custom entity type, then entries of it, without code changes", async () => {
    await bible.createEntityType({ key: "vehicle", prefix: "veh", label: "Vehicle", color: "17becf" });
    expect(lastCommit()).toBe("Bible: add the Vehicle type");
    const { file, id } = await bible.createEntity("vehicle", { name: "The Night Train" });
    expect(file).toBe("bible/vehicles/the-night-train.md");
    expect(id).toMatch(/^veh_/);
    const novel = await valid();
    expect(novel.entities.find((e) => e.id === id)?.type).toBe("vehicle");
    await expect(bible.createEntityType({ key: "vehicle", prefix: "vhc", label: "Again" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(bible.createEntityType({ key: "boat", prefix: "char", label: "Boat" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await bible.updateEntityType("vehicle", { label: "Vehicles and craft" });
    expect((await model()).entityTypes.find((t) => t.key === "vehicle")?.label).toBe("Vehicles and craft");
  });

  it("adds a relationship type and uses it at once", async () => {
    await bible.createRelationshipType({ key: "owes-favour", label: "Owes a favour to", inverse_label: "Is owed a favour by", from_types: ["character"], to_types: ["character"] });
    await bible.createRelationship({ from: BEN, to: ADA, type: "owes-favour" });
    await valid();
    await bible.updateRelationshipType("owes-favour", { label: "Owes one to" });
    expect((await model()).relationshipTypes.find((t) => t.key === "owes-favour")?.label).toBe("Owes one to");
  });

  it("gives a new relationship type the first colour no type uses, and changes only its style's lines", async () => {
    const model0 = await model();
    const before = model0.relationshipTypes.map((t) => [t.key, relationshipStyle(model0, t.key)]);
    // Used in the sample: series-1, 4, 5, 6, 7 and 8 (some by their place in the list); 2 is free.
    await bible.createRelationshipType({ key: "loves", label: "Loves" });
    const novel = await model();
    expect(novel.relationshipTypes.find((t) => t.key === "loves")?.style).toEqual({ color: "series-2", line: "solid" });
    // Nobody else repainted.
    expect(novel.relationshipTypes.filter((t) => t.key !== "loves").map((t) => [t.key, relationshipStyle(novel, t.key)])).toEqual(before);

    const yaml = read("novel.yaml");
    await bible.updateRelationshipType("rivals", { style: { color: "series-7", line: "dotted" } });
    expect(read("novel.yaml")).toBe(yaml.replace("style: { color: series-8, line: dashed }", "style: { color: series-7, line: dotted }"));
    await bible.updateRelationshipType("sibling", { style: { color: "series-3" } });
    expect(relationshipStyle(await model(), "sibling")).toEqual({ slot: "series-3", line: "solid" });
    await valid();

    // Only the palette: never the status colours, nor a colour of its own.
    await expect(bible.updateRelationshipType("rivals", { style: { color: "danger" as never } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(bible.createRelationshipType({ key: "hates", label: "Hates", style: { color: "#ff0000" as never } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(bible.updateRelationshipType("rivals", { style: { line: "wavy" as never } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("transactions", () => {
  it("puts back every file it changed when one change fails, and commits nothing", async () => {
    const head = gitIn(dir, "rev-parse", "HEAD").trim();
    const before = read(ADA_FILE);
    await expect(
      transaction(dir, [{ path: ADA_FILE, content: "changed\n" }, { path: "bible/characters/new.md", content: "new\n" }, { path: "bible/../../escape.md", content: "x" }], "Never"),
    ).rejects.toThrow();
    expect(read(ADA_FILE)).toBe(before);
    expect(existsSync(join(dir, "bible/characters/new.md"))).toBe(false);
    expect(gitIn(dir, "rev-parse", "HEAD").trim()).toBe(head);
    clean();
  });

  it("changes nothing without a git identity", async () => {
    const global = process.env.GIT_CONFIG_GLOBAL;
    const empty = join(tmp, "no-identity");
    writeFileSync(empty, "");
    process.env.GIT_CONFIG_GLOBAL = empty;
    try {
      await expect(bible.createEntity("character", { name: "Nobody" })).rejects.toMatchObject({ code: "BLOCKED", message: expect.stringContaining("Your name and email") });
      expect(existsSync(join(dir, "bible/characters/nobody.md"))).toBe(false);
    } finally {
      process.env.GIT_CONFIG_GLOBAL = global;
    }
  });
});

describe("through the server", () => {
  it("answers each operation, and its refusals with their codes", async () => {
    const library = await Library.open({ configDir: fresh("config") });
    const novel = await library.add(dir);
    const server = await createServer({ library, token: "t", sync: false, commit: false });
    const headers = { cookie: `${sessionCookie(server.port)}=t`, origin: server.url, "content-type": "application/json" };
    const call = (method: string, path: string, body: unknown = {}) => send(server.port, `/api/novels/${novel.id}/bible${path}`, { method, headers, body: JSON.stringify(body) });
    try {
      const created = await call("POST", "/entities", { type: "location", name: "The Toll House" });
      expect(created.status).toBe(201);
      const { id, file } = JSON.parse(created.body) as { id: string; file: string };
      // An ID in the body is the one asked for, never a field written unchecked.
      const picked = await call("POST", "/entities", { type: "location", name: "The Weir", id: "loc_we1r00" });
      expect(JSON.parse(picked.body)).toMatchObject({ id: "loc_we1r00", file: "bible/locations/the-weir.md" });
      expect(read("bible/locations/the-weir.md")).toBe("---\nid: loc_we1r00\nname: The Weir\n---\n");
      expect((await call("POST", "/entities", { type: "location", name: "Bad", id: ADA })).status).toBe(400);
      expect((await call("PATCH", `/entities/${id}`, { base: hash(file), changes: { summary: "By the bridge." } })).status).toBe(200);
      expect(JSON.parse((await call("PATCH", `/entities/${id}`, { base: "0".repeat(64), changes: { summary: "x" } })).body)).toMatchObject({ code: "STALE", path: file });
      const refused = await call("POST", `/entities/${ADA}/delete`, { base: hash(ADA_FILE) });
      expect(refused.status).toBe(409);
      expect(JSON.parse(refused.body)).toMatchObject({ code: "REFERENCED", references: expect.any(Array) });
      const rel = await call("POST", "/relationships", { from: ADA, to: BEN, type: "rivals" });
      expect(rel.status).toBe(201);
      const relId = (JSON.parse(rel.body) as { id: string }).id;
      expect((await call("POST", `/relationships/${relId}/end`, { at: "sc_f100d0" })).status).toBe(200);
      expect((await call("POST", "/relationships", { from: ADA, to: BEN, type: "nope" })).status).toBe(400);
      expect((await call("POST", "/relationships/rel_zzzzzz/delete")).status).toBe(404);
      const many = await call("POST", "/entities/edit", { edits: [{ id, base: hash(file), changes: { tags: ["bridge"] } }, { id: "loc_we1r00", base: hash("bible/locations/the-weir.md"), changes: { tags: ["bridge"] } }] });
      expect(many.status).toBe(200);
      const done = JSON.parse(many.body) as { commit: string; files: string[] };
      expect(done.files).toHaveLength(2);
      expect((await call("POST", "/undo", done)).status).toBe(200);
      expect(JSON.parse((await call("POST", "/undo", done)).body)).toMatchObject({ code: "STALE" });
      expect((await call("POST", "/relationships/add", { relationships: [{ from: ADA, to: BEN, type: "allies" }] })).status).toBe(201);
    } finally {
      await server.close();
    }
  });
});

describe("a novel in format v1", () => {
  beforeEach(() => {
    asFormatV1(dir);
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-qm", "Format v1");
  });

  it("migrates on its own, from POST /migrate: as far as it's asked, else to the newest", async () => {
    expect(await bible.migrate(2)).toMatchObject({ migrated: true });
    expect(lastCommit()).toBe("Format v2: off-page events as files");
    expect(await bible.migrate(2)).toEqual({ commit: null, files: [], migrated: false });
    expect(await bible.migrate()).toMatchObject({ migrated: true });
    expect(lastCommit()).toBe("Format v3: the book's settings in book.yaml, naming its kind");
    expect(await bible.migrate()).toEqual({ commit: null, files: [], migrated: false });
    clean();
  });
});

describe("notes (D12)", () => {
  const IDEA = "notes/what-if-ben-never-sold.md";
  const today = new Date().toLocaleDateString("en-CA");
  const now = (text: string) => /\ncreated: (\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}\n/.exec(text)?.[1];

  it("adds a note dated today, its prose the note, as one commit", async () => {
    const { id, file } = await bible.createNote({ title: "A toll on the bridge", tags: ["money"], note: "Who sets it? [Ben](#char_b3n0vs)?" });
    expect(id).toMatch(/^note_[0-9a-hjkmnp-tv-z]{6}$/);
    expect(file).toBe("notes/a-toll-on-the-bridge.md");
    expect(read(file).replace(/T\d{2}:\d{2}:\d{2}\n/, "\n")).toBe(`---\nid: ${id}\ntitle: A toll on the bridge\ntags:\n  - money\ncreated: ${today}\n---\n\nWho sets it? [Ben](#char_b3n0vs)?\n`);
    expect(now(read(file))).toBe(today);
    expect(lastCommit()).toBe("Notes: add “A toll on the bridge”");
    clean();
    expect((await valid()).notes.map((n) => n.id)).toContain(id);
  });

  it("edits tags and prose against the file as read, renames with a new title, and removes it", async () => {
    const before = read(IDEA);
    await bible.updateNote("note_w1fben", { tags: null, note: "Then the bridge stands." }, { base: hashText(before) });
    expect(read(IDEA)).toBe("---\nid: note_w1fben\ntitle: What if Ben never sold the plans?\ncreated: 2026-10-15\n---\n\nThen the bridge stands.\n");
    await expect(bible.updateNote("note_w1fben", { tags: ["x"] }, { base: hashText(before) })).rejects.toMatchObject({ code: "STALE" });
    const { file } = await bible.updateNote("note_w1fben", { title: "Ben keeps the plans" });
    expect(file).toBe("notes/ben-keeps-the-plans.md");
    expect(existsSync(join(dir, IDEA))).toBe(false);
    expect(lastCommit()).toBe("Notes: rename “What if Ben never sold the plans?” to “Ben keeps the plans”");
    await bible.deleteNote("note_w1fben");
    expect(existsSync(join(dir, file))).toBe(false);
    expect(lastCommit()).toBe("Notes: remove “Ben keeps the plans”");
    clean();
  });

  it("writes a note as a scene, removing the note", async () => {
    const { id, file } = await bible.promoteNote("note_w1fben", "ch_h01d50", { keep: false }, new ManuscriptOperations(dir, (fn) => fn()));
    expect(read(file)).toBe(`---\nid: ${id}\ntitle: What if Ben never sold the plans?\nsynopsis: Then Ada has no reason to come home, and the bridge stands. Unless the debt goes back to the flood.\nstatus: idea\n---\n`);
    expect(existsSync(join(dir, IDEA))).toBe(false);
    expect(lastCommit()).toBe("Notes: write “What if Ben never sold the plans?” as a scene, removing the note");
    clean();
    await valid();
  });

  it("an entry a note mentions is only deleted once confirmed", async () => {
    await expect(bible.deleteEntity(ADA, hash(ADA_FILE))).rejects.toMatchObject({ code: "REFERENCED", details: { references: expect.arrayContaining([{ kind: "note", id: "note_w1fben", title: "What if Ben never sold the plans?" }]) } });
  });
});

describe("scene notes (heffrey78/gh-writer#222)", () => {
  const STATION = "sc_5tat1n";
  const SPAN = "sc_br1dg3";
  const manuscript = () => new ManuscriptOperations(dir, (fn) => fn());
  const front = (path: string) => read(path).split("---\n")[1]!;

  it("makes a note on a scene, and pins one note per scene, unpinning the other in the same commit", async () => {
    const a = await bible.createNote({ title: "Flags", scenes: [STATION] });
    expect(read(a.file)).toContain(`scenes:\n  - ${STATION}\n`);
    await bible.updateNote("note_w1fben", { scenes: [STATION, SPAN] });
    await bible.pinNote(a.id, STATION, true);
    expect(front(a.file)).toContain(`pinned:\n  - ${STATION}\n`);
    await bible.pinNote("note_w1fben", STATION, true);
    expect(lastCommit()).toBe("Notes: pin “What if Ben never sold the plans?” in “The Station”");
    expect(changedInLastCommit()).toEqual([`M\t${a.file}`, "M\tnotes/what-if-ben-never-sold.md"].sort());
    expect(front(a.file)).not.toContain("pinned");
    expect(front("notes/what-if-ben-never-sold.md")).toContain(`pinned:\n  - ${STATION}\n`);
    // Taking the scene off the note takes its pin too.
    await bible.updateNote("note_w1fben", { scenes: [SPAN] });
    expect(front("notes/what-if-ben-never-sold.md")).not.toContain("pinned");
    clean();
    expect(validateBook(await valid()).filter((d) => d.code === "W_NOTE_PIN")).toEqual([]);
  });

  it("deleting a scene takes it off its notes; notes left on no scene are kept or deleted as asked", async () => {
    const only = await bible.createNote({ title: "Flags", scenes: [STATION] });
    await bible.updateNote("note_w1fben", { scenes: [STATION, SPAN] });
    await bible.pinNote("note_w1fben", STATION, true);
    const head = gitIn(dir, "rev-parse", "HEAD");
    await expect(manuscript().delete(STATION)).rejects.toMatchObject({ code: "NOTES_LEFT", details: { notes: [{ id: only.id, title: "Flags" }] } });
    expect(gitIn(dir, "rev-parse", "HEAD")).toBe(head);

    await manuscript().delete(STATION, { notes: "keep" });
    expect(front(only.file)).not.toContain("scenes");
    expect(front("notes/what-if-ben-never-sold.md")).toContain(`scenes:\n  - ${SPAN}\n`);
    expect(front("notes/what-if-ben-never-sold.md")).not.toContain("pinned");
    clean();
    await valid();

    await bible.updateNote(only.id, { scenes: [SPAN] });
    await manuscript().delete("ch_arr1va", { notes: "delete" });
    expect(existsSync(join(dir, only.file))).toBe(false);
    expect(existsSync(join(dir, "notes/what-if-ben-never-sold.md"))).toBe(false);
    clean();
    await valid();
  });

  it("merging scenes puts the merged one's notes on the scene that stays", async () => {
    await bible.updateNote("note_w1fben", { scenes: [SPAN] });
    await bible.pinNote("note_w1fben", SPAN, true);
    await manuscript().merge(STATION);
    expect(front("notes/what-if-ben-never-sold.md")).toContain(`scenes:\n  - ${STATION}\npinned:\n  - ${STATION}\n`);
    clean();
    await valid();
  });
});
