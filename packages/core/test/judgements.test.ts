import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dismissedIn, differentLine, judgedDifferent, loadBook, memorySource, namesNotLinkedIn, notNameLine, passagesOf, readDifferent, readNotNames, type Book, type NotName, type Piece } from "../src/index.ts";
import { nodeSource } from "../src/node.ts";

const novel = await loadBook(nodeSource(fileURLToPath(new URL("../../../examples/sample-novel/", import.meta.url))));
const ADA = "char_7f3k2q";
const BEN = "char_b3n0vs";
const piece = novel.pieces[0]!;
const BODY = "Ada said she would go. Then Ada went, and Ada came back.\n\nNobody asked Ada why.\n";
/** The sample novel with one piece of `body`, and these judgements. */
const book = (notNames: NotName[], body = BODY): Book => ({ ...novel, pieces: [{ ...piece, body } as Piece], notNames });
const plainAda = (b: Book) => passagesOf(b, ADA).filter((p) => !p.linked).map((p) => p.text.slice(0, p.at[0]) + "[" + p.text.slice(...p.at) + "]" + p.text.slice(p.at[1]));

describe("the judgements' files (D19)", () => {
  it("reads one judgement a line, skipping a line that isn't one with a warning", () => {
    const text = `# header\n${notNameLine({ entry: ADA, piece: piece.id, sentence: "Then Ada went, and \"Ada\" came back.", nth: 1 })}- { entry: nope }\n- not yaml: [\n\n- { entry: ${BEN}, piece: ${piece.id}, sentence: "x", nth: -1 }\n`;
    const read = readNotNames(text, "bible/not-names.yaml");
    expect(read.items).toEqual([{ entry: ADA, piece: piece.id, sentence: 'Then Ada went, and "Ada" came back.', nth: 1 }]);
    expect(read.diagnostics.map((d) => [d.code, d.line])).toEqual([["W_JUDGEMENT", 3], ["W_JUDGEMENT", 4], ["W_JUDGEMENT", 6]]);
    expect(readDifferent(`${differentLine([BEN, ADA])}- [${ADA}, ${ADA}]\n- [x]\n`, "f").items).toEqual([[ADA, BEN]]);
  });

  it("writes a line that reads back as written, whatever the sentence holds", () => {
    const n = { entry: ADA, piece: piece.id, sentence: "She said: “Ada? #not: a comment”, \\ and {braces} [too].", nth: 0 };
    expect(readNotNames(notNameLine(n), "f").items).toEqual([n]);
    expect(notNameLine(n).split("\n")).toHaveLength(2);
  });

  it("loads them into the book from the index's folder", async () => {
    const files = { "novel.yaml": "schema_version: 2\ntitle: T\n", "bible/not-names.yaml": notNameLine({ entry: ADA, piece: "sc_aaaaaa", sentence: "S.", nth: 0 }), "bible/different.yaml": differentLine([ADA, BEN]) };
    const loaded = await loadBook(memorySource(files));
    expect(loaded.notNames).toHaveLength(1);
    expect(judgedDifferent(loaded, BEN, ADA)).toBe(true);
    expect((await loadBook(memorySource({ "novel.yaml": files["novel.yaml"] }))).notNames).toEqual([]);
  });
});

describe("Not a name here, one rule for passages, names not linked and the editor", () => {
  it("dismisses the occurrence it counted in its sentence, and no other", () => {
    expect(plainAda(book([]))).toHaveLength(4);
    const judged = book([{ entry: ADA, piece: piece.id, sentence: "Then Ada went, and Ada came back.", nth: 1 }]);
    expect(plainAda(judged)).toEqual(["[Ada] said she would go.", "Then [Ada] went, and Ada came back.", "Nobody asked [Ada] why."]);
    expect(namesNotLinkedIn(judged, judged.pieces[0]!).find((n) => n.id === ADA)!.passages).toHaveLength(3);
  });

  it("gives each plain passage what a judgement keeps of it", () => {
    const passages = passagesOf(book([]), ADA).filter((p) => !p.linked);
    expect(passages.map((p) => p.notName)).toEqual([
      { sentence: "Ada said she would go.", nth: 0 },
      { sentence: "Then Ada went, and Ada came back.", nth: 0 },
      { sentence: "Then Ada went, and Ada came back.", nth: 1 },
      { sentence: "Nobody asked Ada why.", nth: 0 },
    ]);
  });

  it("follows its sentence as the piece is edited around it, and through a small edit to it", () => {
    const judgement = { entry: ADA, piece: piece.id, sentence: "Nobody asked Ada why.", nth: 0 };
    const moved = book([judgement], `A new first paragraph.\n\n${BODY}`);
    expect(plainAda(moved)).not.toContain("Nobody asked [Ada] why.");
    const touched = book([judgement], BODY.replace("Nobody asked Ada why.", "Nobody ever asked Ada why."));
    expect(plainAda(touched)).not.toContain("Nobody ever asked [Ada] why.");
  });

  it("is dormant once its sentence is rewritten: the name is offered again", () => {
    const rewritten = book([{ entry: ADA, piece: piece.id, sentence: "Nobody asked Ada why.", nth: 0 }], BODY.replace("Nobody asked Ada why.", "Ada, unasked, kept her reasons to herself all winter long."));
    expect(plainAda(rewritten)).toHaveLength(4);
  });

  it("holds only in its own piece", () => {
    const elsewhere = book([{ entry: ADA, piece: "sc_zzzzzz", sentence: "Nobody asked Ada why.", nth: 0 }]);
    expect(plainAda(elsewhere)).toHaveLength(4);
  });

  it("is the same function the editor calls on a paragraph's text", () => {
    const text = "Then Ada went, and Ada came back.";
    const hits = [{ id: ADA, at: [5, 8] as const }, { id: ADA, at: [19, 22] as const }];
    expect([...dismissedIn(text, hits, [{ entry: ADA, sentence: text, nth: 1 }])]).toEqual([1]);
    expect([...dismissedIn(text, hits, [{ entry: BEN, sentence: text, nth: 1 }])]).toEqual([]);
  });
});

describe("validate", () => {
  it("warns of a line in a judgements file that isn't one, and still loads the book", async () => {
    const { validate } = await import("../src/index.ts");
    const result = await validate(memorySource({ "novel.yaml": "schema_version: 2\ntitle: T\n", "bible/not-names.yaml": "- { entry: oops }\n" }));
    expect(result.diagnostics.filter((d) => d.code === "W_JUDGEMENT")).toEqual([expect.objectContaining({ severity: "warning", file: "bible/not-names.yaml", line: 1 })]);
  });
});
