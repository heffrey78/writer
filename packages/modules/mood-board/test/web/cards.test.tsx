// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { loadBook, memorySource, type Book } from "@writer/core";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { modulePageActions, moduleViews, registerWebModule } from "@writer/web/modules.tsx";
import type { BoardCard } from "../../src/core/index.ts";
import { CardFace, shown } from "../../src/web/cards.tsx";
import { moodBoardWeb } from "../../src/web/index.tsx";

/** What each kind of card shows and is called (#207), and the Boards page with its boards under it in the sidebar. */

const NOTE = "---\nid: note_4k8h2c\ntitle: The Belfry at low tide\ncolor: teal\n---\nWhen the party reaches the causeway, the tide is out.\n\n![The harbour](/images/harbour.jpg)\n\n![The bell](/images/the-bell.jpg)\n";
let book: Book;

beforeAll(async () => {
  registerWebModule(moodBoardWeb);
  book = await loadBook(
    memorySource({
      "novel.yaml": "schema_version: 1\nid: nv_4k8h2c\ntitle: Fixture\n",
      "manuscript/_order.yaml": "chapters: []\n",
      "bible/characters/marta.md": "---\nid: char_aaaaaa\nname: Marta\naliases: [the choirmaster]\nimage: images/marta.jpg\n---\n",
      "notes/the-belfry.md": NOTE,
      "boards/the-belfry.yaml": "id: board_be1fry\ntitle: The Belfry\ncards: []\n",
    }),
  );
});
afterEach(cleanup);

const face = (card: BoardCard, cards: BoardCard[] = [card]) =>
  render(<CardFace novelId="nv" book={book} card={card} cards={cards} notesShown={new Set(cards.flatMap((c) => (c.kind === "note" ? [c.note] : [])))} />);
const at = { at: [0, 0] as [number, number], size: [100, 100] as [number, number] };

describe("cards", () => {
  it("a picture alone: the picture, described, and nothing else", () => {
    const card: BoardCard = { kind: "picture", picture: "images/dusk.jpg", description: "The Belfry at dusk", ...at };
    const { container } = face(card);
    expect(screen.getByRole("img", { name: "The Belfry at dusk" }).getAttribute("src")).toBe("/api/novels/nv/images/dusk.jpg");
    expect(container.textContent).toBe("");
    expect(shown(book, card)).toEqual({ label: "Picture: The Belfry at dusk" });
  });

  it("a note: its first picture, title and words, in its color, and how many of its pictures are on the board; or its words only", () => {
    const card: BoardCard = { kind: "note", note: "note_4k8h2c", wordsOnly: false, ...at };
    const bell: BoardCard = { kind: "note-picture", note: "note_4k8h2c", picture: "images/the-bell.jpg", ...at };
    const { container } = face(card, [card, bell]);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/api/novels/nv/images/harbour.jpg");
    expect(container.textContent).toBe("The Belfry at low tideWhen the party reaches the causeway, the tide is out.Note · 2 pictures, 1 on this board");
    expect(container.firstElementChild?.className).toContain("bg-note-teal");
    expect(shown(book, card)).toEqual({ label: "Note: The Belfry at low tide", opens: { path: "note/note_4k8h2c", label: "Open the note" } });
    cleanup();
    expect(face({ ...card, wordsOnly: true }).container.querySelector("img")).toBeNull();
  });

  it("a note's picture: the picture as the note describes it, and which note it's from when the note isn't on the board", () => {
    const bell: BoardCard = { kind: "note-picture", note: "note_4k8h2c", picture: "images/the-bell.jpg", ...at };
    face(bell);
    expect(screen.getByRole("img", { name: "The bell" })).toBeTruthy();
    expect(screen.getByText("From “The Belfry at low tide”")).toBeTruthy();
    cleanup();
    face(bell, [bell, { kind: "note", note: "note_4k8h2c", wordsOnly: false, ...at }]);
    expect(screen.queryByText(/^From /)).toBeNull();
    expect(shown(book, bell).label).toBe("Picture from the note The Belfry at low tide: The bell");
  });

  it("an entry: its picture, type, name and what its card says", () => {
    const card: BoardCard = { kind: "entry", entry: "char_aaaaaa", ...at };
    const { container } = face(card);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/api/novels/nv/images/marta.jpg");
    expect(container.textContent).toBe("CharacterMartaalso the choirmaster");
    expect(shown(book, card)).toEqual({ label: "Character: Marta", opens: { path: "bible/char_aaaaaa", label: "Open Marta" } });
  });

  it("a note or an entry that isn't in the book: said, and opens nothing", () => {
    face({ kind: "entry", entry: "char_zzzzzz", ...at });
    expect(screen.getByText("This entry isn't in the book any more.")).toBeTruthy();
    expect(shown(book, { kind: "note", note: "note_zzzzzz", wordsOnly: false, ...at })).toEqual({ label: "Missing note: note_zzzzzz" });
  });

  it("the Boards page lists the book's boards under it in the sidebar", () => {
    const view = moduleViews(book.kind).find((v) => v.path === "boards");
    expect(view && { label: view.label, group: view.group, items: view.items?.(book) }).toEqual({ label: "Boards", group: "Plan", items: [{ path: "board_be1fry", label: "The Belfry" }] });
  });

  it("Put on a board… is offered on a note's page and an entry's (#208)", () => {
    expect(modulePageActions(book.kind, "note").map((a) => a.label)).toEqual(["Put on a board…"]);
    expect(modulePageActions(book.kind, "entry").map((a) => a.label)).toEqual(["Put on a board…"]);
  });
});
