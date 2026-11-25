// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { loadBook, memorySource, NOTE_COLORS, shownPictures, type Book, type Note } from "@writer/core";
import { novel } from "@writer/kinds";
import fc from "fast-check";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cardText, leadingSite, NoteCard } from "../src/notes/note-card.tsx";
import { filterNotes, filtersOn, NOTE_SORTS, noteFiltersOf, withNoteFilters, type NoteFilters } from "../src/notes/note-filters.ts";

/** The Notes gallery (#225, #226): its choices kept in the address, what they keep, and a card's parts. */

const lines = (...l: string[]) => `${l.join("\n")}\n`;
const note = (file: string, ...fm: string[]) => (body: string) => [`notes/${file}.md`, lines("---", ...fm, "---", body)] as const;

const book = (): Promise<Book> =>
  loadBook(
    memorySource(
      Object.fromEntries([
        ["novel.yaml", lines("schema_version: 2", "id: nv_000001", "title: The Bridge")],
        ["manuscript/_order.yaml", lines("chapters: []")],
        note("plans", "id: note_000001", "title: What if Ben never sold the plans?", "created: 2026-11-03T10:00:00Z", "color: yellow", "tags: [ending, ben]")("Then Ada has no reason to come home."),
        note("wind", "id: note_000002", "title: The bridge in a west wind", "created: 2026-11-02T10:00:00Z", "color: blue", "tags: [research]")("It hums.\n\n![The span](/images/span.jpg)\n\n![The pier](/images/pier.jpg)"),
        note("truss", "id: note_000003", "title: Riveting a truss bridge", "created: 2026-11-01T10:00:00Z")("<https://www.youtube.com/watch?v=abc>\n\nHow the gangs heated the rivets."),
        note("ada", "id: note_000004", "title: Ada Varn", "created: 2026-10-30T10:00:00Z", "tags: [ada]")("Left Varn at nineteen."),
      ]),
    ),
    novel,
  );

afterEach(cleanup);

describe("the gallery's choices in the address", () => {
  it("are read back as they were set, each choice its own key, the defaults none", () => {
    const filters = fc.record({
      q: fc.string(),
      sort: fc.constantFrom(...NOTE_SORTS),
      tag: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
      color: fc.option(fc.constantFrom(...NOTE_COLORS), { nil: undefined }),
      pictures: fc.boolean(),
    });
    fc.assert(
      fc.property(filters, (f) => {
        const params = withNoteFilters(new URLSearchParams("other=kept"), f);
        const back = noteFiltersOf(new URLSearchParams(params.toString()));
        const { tag, color, ...rest } = f;
        expect(back).toEqual({ ...rest, ...(tag ? { tag } : {}), ...(color ? { color } : {}) });
        expect(params.get("other")).toBe("kept");
        if (f.sort === "newest") expect(params.has("sort")).toBe(false);
      }),
    );
  });

  it("leave out what they can't mean", () => {
    expect(noteFiltersOf(new URLSearchParams("sort=sideways&color=mauve&pictures=yes"))).toEqual({ q: "", sort: "newest", pictures: false });
    expect(withNoteFilters(new URLSearchParams("color=yellow&tag=ben&pictures=1"), { color: undefined, pictures: false }).toString()).toBe("tag=ben");
  });
});

describe("what the gallery keeps", () => {
  let notes: Note[] = [];
  beforeAll(async () => void (notes = (await book()).notes));
  const ids = (f: Partial<NoteFilters>) => filterNotes(notes, { q: "", sort: "newest", pictures: false, ...f }, (n) => shownPictures(n.body)).map((n) => n.id.slice(-1));

  it("sorts newest first, oldest first or by title", () => {
    expect(ids({})).toEqual(["1", "2", "3", "4"]);
    expect(ids({ sort: "oldest" })).toEqual(["4", "3", "2", "1"]);
    expect(ids({ sort: "title" })).toEqual(["4", "3", "2", "1"].sort((a, b) => notes.find((n) => n.id.endsWith(a))!.title.localeCompare(notes.find((n) => n.id.endsWith(b))!.title)));
  });

  it("keeps a color, a tag, those with pictures and words searched, together", () => {
    expect(ids({ color: "yellow" })).toEqual(["1"]);
    expect(ids({ tag: "research" })).toEqual(["2"]);
    expect(ids({ pictures: true })).toEqual(["2"]);
    expect(ids({ q: "RIVETS" })).toEqual(["3"]);
    expect(ids({ color: "blue", tag: "ending" })).toEqual([]);
    expect(filtersOn({ q: "x", sort: "title", pictures: true, color: "red", tag: "a" })).toBe(3);
  });
});

describe("a note's card", () => {
  const card = (n: Note, b: Book) =>
    render(
      <MemoryRouter>
        <NoteCard novelId="b" novel={b} note={n} pictures={shownPictures(n.body)} />
      </MemoryRouter>,
    ).container.querySelector("a")!;

  it("is filled with its color, and a screen reader hears the title, the color, then the words", async () => {
    const b = await book();
    const link = card(b.notes.find((n) => n.id === "note_000001")!, b);
    expect(link.className).toContain("bg-note-yellow");
    expect(link.className).not.toContain("border-l-");
    expect(link.textContent).toMatch(/^What if Ben never sold the plans\?, yellow\.Then Ada has no reason to come home\.endingben$/);
    expect(screen.getByText("ending").tagName).toBe("SPAN");
  });

  it("without a color is plain", async () => {
    const b = await book();
    const link = card(b.notes.find((n) => n.id === "note_000004")!, b);
    expect(link.className).toContain("bg-raised");
    expect(link.textContent).not.toMatch(/yellow|blue/);
  });

  it("shows its first picture and how many it has", async () => {
    const b = await book();
    const link = card(b.notes.find((n) => n.id === "note_000002")!, b);
    expect(link.querySelectorAll("img")).toHaveLength(1);
    expect(link.querySelector("img")!.getAttribute("src")).toContain("span.jpg");
    expect(link.textContent).toContain("2 pictures");
  });

  it("starting with a link, shows the link's site, not its address", async () => {
    const b = await book();
    const link = card(b.notes.find((n) => n.id === "note_000003")!, b);
    expect(link.textContent).toMatch(/^youtube\.comRiveting a truss bridgeHow the gangs heated the rivets\.$/);
  });
});

describe("a link's site", () => {
  it("is the site of a link the words start with, not of one after them", () => {
    expect(leadingSite("<https://www.youtube.com/watch?v=1>\n\nWords.")).toBe("youtube.com");
    expect(leadingSite("[Old bridges \\[1931\\]](https://archive.org/details/x)")).toBe("archive.org");
    expect(leadingSite("Words first <https://example.com>")).toBeUndefined();
    expect(leadingSite("Plain words.")).toBeUndefined();
    expect(cardText("<https://example.com/a>\n\nWords.")).toBe("Words.");
    expect(cardText("[A page](https://example.com/a)")).toBe("A page");
  });
});
