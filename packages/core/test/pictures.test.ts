import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBook, picturesShown, shownPictures } from "../src/index.ts";
import { nodeSource } from "../src/node.ts";

/** Reading the pictures a book shows (#200, #202). */

describe("shownPictures", () => {
  it("reads a note's pictures under images/, in order, with their descriptions and captions", () => {
    const body = ["Words first.", '![The ford](/images/ford.jpg "Drawn by Hale")', "Then ![a small one](/images/inline.png) in a line.", "![Elsewhere](https://example.com/x.jpg)", "![Outside](/map.png)", "![The bank](/images/bank%20north.jpg)"].join("\n\n");
    expect(shownPictures(body)).toEqual([
      { path: "images/ford.jpg", alt: "The ford", caption: "Drawn by Hale" },
      { path: "images/inline.png", alt: "a small one" },
      { path: "images/bank north.jpg", alt: "The bank" },
    ]);
    expect(shownPictures("No pictures.")).toEqual([]);
  });
});

describe("picturesShown", () => {
  it("is every picture the book shows: its cover, entries', and those in pieces, notes and records", async () => {
    const book = await loadBook(nodeSource(join(import.meta.dirname, "../../../examples/sample-novel")));
    const note = book.notes[0]!;
    const withNote = { ...book, notes: [{ ...note, body: `${note.body}\n\n![The plans](/images/plans.jpg)\n` }, ...book.notes.slice(1)] };
    expect(picturesShown(withNote).has("images/plans.jpg")).toBe(true);
    expect(picturesShown(book).has("images/plans.jpg")).toBe(false);
    const entry = { ...book.entities[0]!, image: "images/ada.jpg" };
    const withEntry = { ...book, entities: [entry, ...book.entities.slice(1)] };
    expect(picturesShown(withEntry).has("images/ada.jpg")).toBe(true);
    expect(picturesShown(withEntry, { except: entry.id }).has("images/ada.jpg")).toBe(false);
  });
});
