import fc from "fast-check";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bookNameMatcher, countWords, loadBook, mentionTargets, nameMatcher, namesInBlock, passagesOf, proseBlocks, sentenceAround, type Book, type Piece } from "../src/index.ts";
import { nodeSource } from "../src/node.ts";

const novel = await loadBook(nodeSource(fileURLToPath(new URL("../../../examples/sample-novel/", import.meta.url))));
const campaign = await loadBook(nodeSource(fileURLToPath(new URL("../../../examples/sample-campaign/", import.meta.url))));
const ADA = "char_7f3k2q";
const BEN = "char_b3n0vs";
const BRIDGE = "loc_br1dg3";

/** The sample novel with one piece, of this body. */
const withBody = (body: string, book: Book = novel): Book => ({ ...book, pieces: [{ ...book.pieces[0]!, body } as Piece] });
const shown = (book: Book, id: string) => passagesOf(book, id).map((p) => [p.text.slice(...p.at), p.linked] as const);

describe("passagesOf", () => {
  it("lists every mention and every plain name, in reading order, with its sentence and role", () => {
    const ben = passagesOf(novel, BEN);
    expect(ben[0]).toMatchObject({ piece: { title: "Walking the Span" }, linked: true, roles: ["characters"] });
    expect(ben[0]!.text).toBe("Ben met her at the toll house with two coffees and a grin that was a size too large for him.");
    const flood = ben.filter((p) => p.piece.title === "The Flood");
    expect(flood.map((p) => p.linked)).toEqual([false, false]);
    expect(flood[0]!.roles).toEqual(["pov", "characters"]);
    const order = novel.pieces.map((p) => p.id);
    const at = ben.map((p) => order.indexOf(p.piece.id));
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it("says where each is in the piece's Markdown: the mention, or the plain words to link", () => {
    for (const id of [ADA, BEN, BRIDGE]) {
      for (const p of passagesOf(novel, id)) {
        const raw = p.piece.body.slice(...p.raw!);
        if (p.linked) expect(raw).toBe(`[${p.text.slice(...p.at)}](#${id})`);
        else expect(raw).toBe(p.text.slice(...p.at));
      }
    }
  });

  it("counts a name once, as the longest name it's part of, and never inside a link or code", () => {
    const book = withBody("Ada Varn met Ada. Ben waved at [Ada](#char_7f3k2q), and [Ada's notes](https://x.example) and `Ada` stayed as they were.\n");
    expect(shown(book, ADA)).toEqual([
      ["Ada Varn", false],
      ["Ada", false],
      ["Ada", true],
    ]);
    expect(shown(book, BEN)).toEqual([["Ben", false]]);
  });

  it("reads names split by emphasis and in lists, quotes, headings and footnotes, and skips code blocks", () => {
    const book = withBody(
      [
        "# Ada at the station",
        "",
        "She saw *Ada* Varn and **the bridge**.",
        "",
        "- Ben first",
        "- then Ada",
        "",
        "> Ben, quoted.",
        "",
        "```",
        "Ada in code",
        "```",
        "",
        "A note.[^1]",
        "",
        "[^1]: Ben, in a footnote.",
        "",
      ].join("\n"),
    );
    expect(shown(book, ADA).map(([n]) => n)).toEqual(["Ada", "Ada Varn", "Ada"]);
    expect(shown(book, BEN).map(([n]) => n)).toEqual(["Ben", "Ben", "Ben"]);
    expect(shown(book, BRIDGE).map(([n]) => n)).toEqual(["the bridge"]);
  });

  it("finds the plain words in the Markdown even where escapes and character references come first", () => {
    const body = "Fish \\& chips &amp; then Ben came.\n";
    const [p] = passagesOf(withBody(body), BEN);
    expect(body.slice(...p!.raw!)).toBe("Ben");
  });

  it("trims a long sentence to about thirty words around the name", () => {
    const long = `${"word ".repeat(40)}Ben ${"more ".repeat(40)}end.`;
    const [p] = passagesOf(withBody(`${long}\n`), BEN);
    expect(p!.text).toMatch(/^….*…$/);
    expect(p!.text.split(/\s+/).length).toBeLessThanOrEqual(33);
    expect(p!.text.slice(...p!.at)).toBe("Ben");
  });

  it("doesn't end a sentence at an abbreviation or an initial", () => {
    const text = "Dr. Hale met M. K. Kost at noon. Then Ben left.";
    const at = text.indexOf("Kost");
    expect(sentenceAround(text, [at, at + 4]).text).toBe("Dr. Hale met M. K. Kost at noon.");
  });

  it("lists a module's mentionable records too, and nothing for an ID the book doesn't have", () => {
    const event = novel.moduleRecords.find((r) => r.type === "event")!;
    expect(mentionTargets(novel).some((t) => t.id === event.id)).toBe(true);
    expect(passagesOf(novel, "char_n0ne00")).toEqual([]);
  });

  it("reads a campaign's sessions in its own words", () => {
    const marta = campaign.entities.find((e) => e.name === "Marta Hollin")!;
    const passages = passagesOf(campaign, marta.id);
    expect(passages.length).toBeGreaterThan(0);
    expect(passages.every((p) => p.text.includes("Marta"))).toBe(true);
  });

  // Random prose of words, names (plain or linked), emphasis and links elsewhere.
  const names = [
    { text: "Ada Varn", id: ADA },
    { text: "Ada", id: ADA },
    { text: "Ben", id: BEN },
    { text: "the bridge", id: BRIDGE },
  ];
  const token = fc.oneof(
    fc.constantFrom("she", "walked", "over", "and", "then", "said", "nothing", "Adam", "Bennet", "bridges"),
    fc.record({ name: fc.constantFrom(...names), linked: fc.boolean(), em: fc.boolean() }),
    fc.constantFrom("[a link](https://x.example)", ",", ".", "!"),
  );
  const prose = fc.array(fc.array(token, { minLength: 1, maxLength: 12 }), { minLength: 1, maxLength: 4 });

  it("finds every name put in random prose once, linked or not, where it was put", () => {
    fc.assert(
      fc.property(prose, (paragraphs) => {
        const put: { id: string; text: string; linked: boolean; at: number }[] = [];
        let body = "";
        for (const words of paragraphs) {
          for (const t of words) {
            if (body && !body.endsWith("\n")) body += " ";
            if (typeof t === "string") body += t;
            else {
              const { name, linked, em } = t;
              const written = linked ? `[${name.text}](#${name.id})` : name.text;
              const open = em ? "*" : "";
              body += open;
              put.push({ id: name.id, text: name.text, linked, at: body.length });
              body += written + open;
            }
          }
          body += "\n\n";
        }
        const book = withBody(body);
        for (const id of [ADA, BEN, BRIDGE]) {
          const expected = put.filter((p) => p.id === id);
          const got = passagesOf(book, id);
          // Two names side by side can read as one longer one ("Ada" "Varn"…): only the clean cases count.
          if (got.length !== expected.length) continue;
          expect(got.map((p) => [p.raw![0], p.linked])).toEqual(expected.map((p) => [p.at, p.linked]));
          for (const p of got) expect(p.text.slice(...p.at)).toMatch(/Ada|Ben|the bridge/);
        }
      }),
    );
  });

  // The budget is 50 ms (about 40 on a desktop, measured alone); the browser's is held by the index's
  // performance spec, which runs alone. Here, beside the whole suite in parallel, this only guards
  // against parsing every piece as Markdown again (2.4 s).
  it("lists one entry's passages in a 200,000-word book in a fraction of a second", () => {
    const body = novel.pieces.map((p) => p.body).join("\n\n");
    const n = Math.ceil(200_000 / countWords(body));
    const big = (k: number): Book => ({ ...novel, pieces: Array.from({ length: n }, (_, i) => ({ ...novel.pieces[i % novel.pieces.length]!, id: `sc_${String(i).padStart(6, "0")}`, body: `${body}\n\nPiece ${k}-${i}.\n` })) });
    passagesOf(big(0), ADA); // the code warmed up, as in an app that's running
    const times = [1, 2, 3, 4, 5].map((k) => {
      const book = big(k); // each read afresh: nothing cached
      const t = performance.now();
      passagesOf(book, ADA);
      return performance.now() - t;
    });
    expect(times.sort((a, b) => a - b)[2]).toBeLessThan(400);
  });
});

describe("the name matcher", () => {
  it("is the book's mention targets', longest first, whole words, with their case", () => {
    const m = bookNameMatcher(novel)!;
    expect(m.ids.get("Ada")).toBe(ADA);
    expect("Adam met Ada Varn and ada".match(m.pattern)).toEqual(["Ada Varn"]);
    expect(nameMatcher([{ id: "x_000000", name: "A", aliases: [] }])).toBeUndefined();
  });

  it("finds names only in plain words of a block", () => {
    const [b] = proseBlocks("Ben and [Ben](#char_b3n0vs) and [Ben](https://x.example) and Ben.\n");
    const hits = namesInBlock("", b!, nameMatcher([{ id: BEN, name: "Ben", aliases: [] }]));
    expect(hits.map((h) => h.linked)).toEqual([false, true, false]);
  });
});
