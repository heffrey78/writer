import { fileURLToPath } from "node:url";
import { kindByKey, loadBook, memorySource, modulesOf, parseYaml, picturesShown, validate, type Diagnostic } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BOARD, boardFile, boardsOf, cardLine, placeCard, readBoard, type BoardCard } from "../src/core/index.ts";

/** Mood boards in the format (#206): boards/<slug>.yaml, read, checked, and counted as showing pictures. */

const NOVEL = "schema_version: 1\nid: nv_4k8h2c\ntitle: Fixture\n";

/** The board's file as the mock-ups drew it, its cards written by hand over several lines. */
const BELFRY = `# A mood board. Kept by Writer.
id: board_be1fry
title: The Belfry
cards:
  # A picture alone: its description lives here.
  - picture: images/the-belfry-at-dusk.jpg
    description: The Belfry at dusk, a light in its window
    at: [36, 30]
    size: [480, 320]
  # A note, as a card.
  - note: note_4k8h2c
    at: [556, 36]
    size: [252, 300]
  # A picture from that note, tethered to it.
  - note: note_4k8h2c
    picture: images/the-bell.jpg
    at: [872, 232]
    size: [210, 230]
  # An index entry.
  - entry: char_aaaaaa
    at: [48, 392]
    size: [196, 230]
  - note: note_7c3h0r
    at: [556, 404]
    size: [252, 170]
    # Words only: no picture shown.
    picture: none
`;

const note = (id: string, title: string, body = "Words.\n") => `---\nid: ${id}\ntitle: ${title}\n---\n${body}`;

/** A small novel with two notes, an entry, the pictures they show, and a board. Override or delete (undefined) files per test. */
function files(overrides: Record<string, string | undefined> = {}) {
  const all: Record<string, string | undefined> = {
    "novel.yaml": NOVEL,
    "manuscript/_order.yaml": "chapters: [ch_aaaaaa]\n",
    "manuscript/01-one/_chapter.yaml": "id: ch_aaaaaa\nscenes: [sc_aaaaaa]\n",
    "manuscript/01-one/01-a.md": "---\nid: sc_aaaaaa\ntitle: A\n---\nProse.\n",
    "bible/characters/ada.md": "---\nid: char_aaaaaa\nname: Ada\n---\n",
    "notes/the-bell.md": note("note_4k8h2c", "The bell", "![The bell](/images/the-bell.jpg)\n"),
    "notes/the-tide.md": note("note_7c3h0r", "The tide"),
    "images/the-belfry-at-dusk.jpg": "jpeg",
    "images/the-bell.jpg": "jpeg",
    "boards/the-belfry.yaml": BELFRY,
    ...overrides,
  };
  return memorySource(Object.fromEntries(Object.entries(all).filter((e): e is [string, string] => e[1] !== undefined)));
}

const codes = (ds: Diagnostic[]) => ds.map((d) => d.code);
const sample = (name: string) => fileURLToPath(new URL(`../../../../examples/${name}/`, import.meta.url));

describe("mood boards", () => {
  it("are the Novel's and the Campaign's, and no other kind's", () => {
    const using = (key: string) => modulesOf(kindByKey(key)).some((m) => m.id === "mood-board");
    expect(["novel", "campaign", "journal", "nonfiction"].map(using)).toEqual([true, true, false, false]);
  });

  it("read from boards/: each kind of card, in the file's order, comments and all", async () => {
    const { novel, diagnostics } = await validate(files());
    expect(diagnostics).toEqual([]);
    const [board] = boardsOf(novel);
    expect(board).toMatchObject({ id: "board_be1fry", title: "The Belfry", file: "boards/the-belfry.yaml" });
    expect(board!.cards).toEqual<BoardCard[]>([
      { kind: "picture", picture: "images/the-belfry-at-dusk.jpg", description: "The Belfry at dusk, a light in its window", at: [36, 30], size: [480, 320] },
      { kind: "note", note: "note_4k8h2c", wordsOnly: false, at: [556, 36], size: [252, 300] },
      { kind: "note-picture", note: "note_4k8h2c", picture: "images/the-bell.jpg", at: [872, 232], size: [210, 230] },
      { kind: "entry", entry: "char_aaaaaa", at: [48, 392], size: [196, 230] },
      { kind: "note", note: "note_7c3h0r", wordsOnly: true, at: [556, 404], size: [252, 170] },
    ]);
  });

  it("are in file-name order, and a board with no cards is one", async () => {
    const book = await loadBook(files({ "boards/a-harbour.yaml": "id: board_aaaaaa\ntitle: A harbour\n", "boards/notes.txt": "not a board" }));
    expect(boardsOf(book).map((b) => [b.title, b.cards.length])).toEqual([["A harbour", 0], ["The Belfry", 5]]);
  });

  it("aren't read in a kind without the module: a journal's boards/ is just a folder", async () => {
    const journal = await loadBook(nodeSource(sample("sample-journal")));
    expect(journal.kind.key).toBe("journal");
    expect(journal.moduleFiles).toEqual([]);
  });

  it("leave the shipped samples as they were: none has a board", async () => {
    for (const name of ["sample-novel", "sample-campaign"]) {
      const { novel, errors } = await validate(nodeSource(sample(name)));
      expect(errors).toBe(0);
      expect(boardsOf(novel)).toEqual([]);
    }
  });

  it("keep the pictures they show: a picture alone's, and a note's picture even once the note no longer shows it", async () => {
    const book = await loadBook(files({ "notes/the-bell.md": note("note_4k8h2c", "The bell") }));
    expect([...picturesShown(book)].sort()).toEqual(["images/the-belfry-at-dusk.jpg", "images/the-bell.jpg"]);
  });

  it("report a picture whose file isn't there (W_MISSING_IMAGE)", async () => {
    const { diagnostics } = await validate(files({ "images/the-belfry-at-dusk.jpg": undefined }));
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "W_MISSING_IMAGE", file: "boards/the-belfry.yaml", message: "A picture on “The Belfry”, images/the-belfry-at-dusk.jpg, isn't in the repository" }),
    ]);
  });

  it("report a card naming a note or an entry the book doesn't have (W_BOARD_UNKNOWN)", async () => {
    const { diagnostics, errors } = await validate(files({ "notes/the-bell.md": undefined, "bible/characters/ada.md": undefined, "images/the-bell.jpg": "jpeg" }));
    expect(errors).toBe(0);
    expect(diagnostics.map((d) => [d.code, d.pointer, d.message])).toEqual([
      ["W_BOARD_UNKNOWN", "/cards/1/note", "The board “The Belfry” shows the note note_4k8h2c, which isn't in the book"],
      ["W_BOARD_UNKNOWN", "/cards/2/note", "The board “The Belfry” shows the note note_4k8h2c, which isn't in the book"],
      ["W_BOARD_UNKNOWN", "/cards/3/entry", "The board “The Belfry” shows char_aaaaaa, which isn't in the book"],
    ]);
  });

  it("report a malformed board (E_SCHEMA): no title, a bad position, a card that's two things or nothing", async () => {
    const check = async (yaml: string) => (await validate(files({ "boards/the-belfry.yaml": yaml }))).diagnostics.map((d) => [d.code, d.pointer ?? "", d.message]);
    expect(await check("id: board_be1fry\ncards: []\n")).toEqual([["E_SCHEMA", "", 'Missing required field "title"']]);
    expect(await check("id: board_be1fry\ntitle: B\ncards:\n  - { entry: char_aaaaaa, at: [1], size: [2, 3] }\n")).toEqual([["E_SCHEMA", "/cards/0/at", "Value at /cards/0/at must NOT have fewer than 2 items"]]);
    expect(await check("id: board_be1fry\ntitle: B\ncards:\n  - { entry: char_aaaaaa, at: [1, 2], size: [0, 3] }\n")).toEqual([["E_SCHEMA", "/cards/0/size/0", "Value at /cards/0/size/0 must be > 0"]]);
    expect(await check("id: board_be1fry\ntitle: B\ncards:\n  - { picture: ../outside.jpg, at: [1, 2], size: [2, 3] }\n")).toEqual([["E_SCHEMA", "/cards/0/picture", expect.stringContaining("must match pattern")]]);
    expect(await check("id: board_be1fry\ntitle: B\ncards:\n  - { note: note_4k8h2c, entry: char_aaaaaa, at: [1, 2], size: [2, 3] }\n  - { picture: none, at: [1, 2], size: [2, 3] }\n  - { entry: char_aaaaaa, picture: images/the-bell.jpg, at: [1, 2], size: [2, 3] }\n  - { note: note_4k8h2c, description: Words, at: [1, 2], size: [2, 3] }\n")).toEqual([
      ["E_SCHEMA", "/cards/0", "Card 1 names a note and an entry: a card is one or the other"],
      ["E_SCHEMA", "/cards/1", "Card 2 names nothing to show: a picture (`picture: images/…`), a note or an entry"],
      ["E_SCHEMA", "/cards/2", "Card 3 is an entry's, which shows the entry's own picture: it has no `picture` or `description`"],
      ["E_SCHEMA", "/cards/3", "Card 4 is a note's, whose pictures are described in the note: it has no `description`"],
    ]);
    expect(await check("id: board_be1fry\ntitle: B\ncards:\n  - { entry: char_aaaaaa, at: [1, 2], size: [2, 3], colour: red }\n")).toEqual([["W_UNKNOWN_KEY", "/cards/0/colour", 'Unknown field "colour" at /cards/0']]);
  });

  it("have IDs of their own: board_, and none another record has", async () => {
    expect(codes((await validate(files({ "boards/the-belfry.yaml": BELFRY.replace("board_be1fry", "note_be1fry") }))).diagnostics)).toEqual(["E_ID_PREFIX"]);
    expect(codes((await validate(files({ "boards/the-belfry.yaml": BELFRY.replace("board_be1fry", "note_7c3h0r") }))).diagnostics)).toEqual(["E_DUPLICATE_ID", "E_ID_PREFIX"]);
  });

  it("are written a card a line, and read back as they were written", async () => {
    const cards: BoardCard[] = [
      { kind: "picture", picture: "images/the-belfry-at-dusk.jpg", description: "The Belfry: at dusk, “a light”", at: [36, 30], size: [480, 320] },
      { kind: "note", note: "note_4k8h2c", wordsOnly: false, at: [556, 36], size: [252, 300] },
      { kind: "note-picture", note: "note_4k8h2c", picture: "images/the-bell.jpg", at: [872.5, -40], size: [210, 230] },
      { kind: "entry", entry: "char_aaaaaa", at: [48, 392], size: [196, 230] },
      { kind: "note", note: "note_7c3h0r", wordsOnly: true, at: [556, 404], size: [252, 170] },
    ];
    const text = boardFile({ id: "board_be1fry", title: "The Belfry", cards });
    expect(text).toBe(`# A mood board. Kept by Writer.
id: board_be1fry
title: The Belfry
cards:
  - { picture: images/the-belfry-at-dusk.jpg, description: "The Belfry: at dusk, “a light”", at: [ 36, 30 ], size: [ 480, 320 ] }
  - { note: note_4k8h2c, at: [ 556, 36 ], size: [ 252, 300 ] }
  - { note: note_4k8h2c, picture: images/the-bell.jpg, at: [ 872.5, -40 ], size: [ 210, 230 ] }
  - { entry: char_aaaaaa, at: [ 48, 392 ], size: [ 196, 230 ] }
  - { note: note_7c3h0r, picture: none, at: [ 556, 404 ], size: [ 252, 170 ] }
`);
    const { novel, diagnostics } = await validate(files({ "boards/the-belfry.yaml": text }));
    expect(diagnostics).toEqual([]);
    expect(boardsOf(novel)[0]!.cards).toEqual(cards);
    expect(boardFile({ id: "board_aaaaaa", title: "Empty", cards: [] })).toBe("# A mood board. Kept by Writer.\nid: board_aaaaaa\ntitle: Empty\ncards: []\n");
  });

  it("move a card by changing its line alone, and keep the author's comments and layout", () => {
    const moved = placeCard(BELFRY, 3, { at: [60, 400], size: [200, 240] });
    expect(moved).toBe(BELFRY.replace("  - entry: char_aaaaaa\n    at: [48, 392]\n    size: [196, 230]\n", "  - entry: char_aaaaaa\n    at: [60, 400]\n    size: [200, 240]\n"));
    expect(placeCard(BELFRY, 3, { at: [48, 392] })).toBe(BELFRY);
  });

  it("change only the moved cards' lines, however many are moved (property)", () => {
    const point = fc.tuple(fc.integer({ min: -5000, max: 5000 }), fc.integer({ min: -5000, max: 5000 }));
    const size = fc.tuple(fc.integer({ min: 1, max: 2000 }), fc.integer({ min: 1, max: 2000 }));
    const card = fc.oneof(
      fc.record({ kind: fc.constant("entry" as const), entry: fc.constant("char_aaaaaa"), at: point, size }),
      fc.record({ kind: fc.constant("note" as const), note: fc.constant("note_4k8h2c"), wordsOnly: fc.boolean(), at: point, size }),
      fc.record({ kind: fc.constant("picture" as const), picture: fc.constant("images/the-bell.jpg"), description: fc.string(), at: point, size }),
    );
    fc.assert(
      fc.property(fc.array(card, { minLength: 1, maxLength: 12 }), fc.array(fc.tuple(fc.nat(), point, size), { maxLength: 6 }), (cards, moves) => {
        const before = boardFile({ id: "board_be1fry", title: "The Belfry", cards });
        let after = before;
        const placed = cards.map((c) => ({ ...c }));
        for (const [n, at, sz] of moves) {
          const i = n % cards.length;
          after = placeCard(after, i, { at, size: sz });
          placed[i] = { ...placed[i]!, at, size: sz };
        }
        const was = before.split("\n"), now = after.split("\n");
        expect(now.length).toBe(was.length);
        const changed = new Set(now.flatMap((line, i) => (line === was[i] ? [] : [i])));
        const movedLines = new Set(moves.map(([n]) => 4 + (n % cards.length)));
        for (const i of changed) expect(movedLines.has(i)).toBe(true);
        expect(readBoard({ type: BOARD.key, id: "board_be1fry", title: "The Belfry", data: parseYaml(after, "b.yaml").data as Record<string, unknown>, pictures: [], file: "b.yaml" }).cards).toEqual(placed);
      }),
    );
  });

  it("write a card's line the way the board's file has it", () => {
    expect(cardLine({ kind: "entry", entry: "char_aaaaaa", at: [1, 2], size: [3, 4] })).toBe("  - { entry: char_aaaaaa, at: [ 1, 2 ], size: [ 3, 4 ] }\n");
  });
});
