import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { foldName, loadBook, mightBeTheSame, tidyCounts, tidyReport, type Book, type Entity } from "../src/index.ts";
import { nodeSource } from "../src/node.ts";

const novel = await loadBook(nodeSource(fileURLToPath(new URL("../../../examples/sample-novel/", import.meta.url))));
const BEN = "char_b3n0vs";
const ADA = "char_7f3k2q";
const character = (id: string, name: string, aliases: string[] = []): Entity => ({ ...novel.entities.find((e) => e.id === ADA)!, id, name, aliases, summary: "" });
const withEntries = (...extra: Entity[]): Book => ({ ...novel, entities: [...novel.entities, ...extra] });
const pairs = (book: Book) => mightBeTheSame(book).map(({ a, b, because }) => [a.name, b.name, because]);

describe("Tidy up (#172)", () => {
  it("counts names written without a link across the book, by entry, most first", () => {
    const report = tidyReport(novel);
    const ben = report.notLinked.find((n) => n.entry.id === BEN)!;
    expect(ben.passages).toHaveLength(3);
    expect(ben.passages.every((p) => !p.linked)).toBe(true);
    const counts = report.notLinked.map((n) => n.passages.length);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(tidyCounts(report).notLinked).toBe(counts.reduce((a, b) => a + b, 0));
  });

  it("leaves out a word judged not a name there, and lists a judgement whose word is gone", () => {
    const ledger = novel.pieces.find((p) => p.id === "sc_1edger")!;
    const sentence = "The ledger was where their mother had kept the egg money, behind the loose board under the stairs, which meant Ben had wanted it found by someone, someday.";
    const judged: Book = { ...novel, notNames: [{ entry: BEN, piece: ledger.id, sentence, nth: 0 }, { entry: BEN, piece: ledger.id, sentence: "A sentence long since rewritten into something else entirely.", nth: 0 }] };
    const report = tidyReport(judged);
    expect(report.notLinked.find((n) => n.entry.id === BEN)!.passages).toHaveLength(2);
    expect(report.dormant).toEqual([judged.notNames[1]]);
  });

  it("lists entries never in the book, with no summary, and declared fields left empty", () => {
    const report = tidyReport(withEntries(character("char_n0b0dy", "Nobody Yet")));
    expect(report.absent.map((e) => e.name)).toContain("Nobody Yet");
    expect(report.noSummary.map((e) => e.name)).toContain("Nobody Yet");
    const tomas = report.emptyFields.find((x) => x.entry.name === "Tomas Hale")!;
    expect(tomas.fields.map((f) => f.key)).toContain("occupation");
    expect(tidyCounts(report).emptyFields).toBe(report.emptyFields.reduce((n, x) => n + x.fields.length, 0));
  });

  it("pairs entries of one type that might be the same: one name beginning the other, the same name, or spelled nearly alike", () => {
    expect(pairs(novel)).toEqual([]);
    const book = withEntries(character("char_b3nj4m", "Benjamin"), character("char_m1re1b", "Mirela Kóst"), character("char_t0ma5i", "Tomas Hal"), character("char_adamxx", "Adam"));
    expect(pairs(book)).toEqual([
      ["Mirela Kost", "Mirela Kóst", "same name"],
      ["Ada Varn", "Adam", "one begins the other"],
      ["Ben Varn", "Benjamin", "one begins the other"],
      ["Tomas Hale", "Tomas Hal", "spelled alike"],
    ]);
  });

  it("never pairs entries of different types, or a pair judged different", () => {
    const place = { ...character("loc_b3nnyy", "Benny's"), type: "location" };
    expect(pairs(withEntries(place))).toEqual([]);
    const benjamin = character("char_b3nj4m", "Benjamin");
    expect(pairs({ ...withEntries(benjamin), different: [[BEN, "char_b3nj4m"].sort() as [string, string]] })).toEqual([]);
  });

  it("compares names with accents, case and spacing set aside", () => {
    expect(foldName("  Mirela   KÓST ")).toBe("mirela kost");
  });
});
