import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { entriesInPiece, loadBook, type Book, type Piece } from "../src/index.ts";
import { nodeSource } from "../src/node.ts";

const sample = (name: string) => loadBook(nodeSource(fileURLToPath(new URL(`../../../examples/sample-${name}/`, import.meta.url))));
const novel = await sample("novel");
const campaign = await sample("campaign");

/** A piece's entries by name, with their roles. */
const inPiece = (book: Book, title: string) => {
  const piece = book.pieces.find((p) => p.title === title)!;
  return entriesInPiece(book, piece.id).map((x) => [book.entities.find((e) => e.id === x.id)?.name ?? book.moduleRecords.find((r) => r.id === x.id)?.title, x.role]);
};

describe("entriesInPiece", () => {
  it("lists everyone and everything in a scene once, with its role, in the bible's type order", () => {
    expect(inPiece(novel, "The Station")).toEqual([
      ["Ada Varn", "point of view"],
      ["Varn Station", "set here"],
      ["The Sale", "plotline"],
      ["Inheritance", "theme"],
    ]);
    // Ada is the point of view and among the characters, and mentioned: once, as the point of view.
    expect(inPiece(novel, "Walking the Span")).toEqual([
      ["Ada Varn", "point of view"],
      ["Ben Varn", "present"],
      ["The Varn Bridge", "set here"],
      ["The Sale", "plotline"],
      ["Ben's Debt", "plotline"],
      ["Trust", "theme"],
    ]);
  });

  it("adds what the prose only mentions, an off-page event among them, after the entries", () => {
    const piece = novel.pieces[0]!;
    const event = novel.moduleRecords.find((r) => r.type === "event")!;
    const changed = { ...piece, body: `[Tomas](#char_t0ma5h) and [the flood](#${event.id}) and [nobody](#char_n0b0dy).\n` } as Piece;
    const book: Book = { ...novel, pieces: [changed, ...novel.pieces.slice(1)], allPieces: novel.allPieces.map((p) => (p.id === piece.id ? changed : p)) };
    const listed = inPiece(book, piece.title);
    expect(listed).toContainEqual(["Tomas Hale", "mentioned"]);
    expect(listed.at(-1)).toEqual([event.title, "mentioned"]);
    // A link to an ID the book doesn't have names nothing.
    expect(listed.map(([name]) => name)).not.toContain(undefined);
  });

  it("says a session's people in a campaign's words", () => {
    expect(inPiece(campaign, "Session 1")).toEqual([
      ["Marta Hollin", "in it"],
      ["Kith", "playing"],
      ["Aya", "playing"],
      ["Saltmere", "visited"],
      ["Why the Bell Rings", "advanced"],
    ]);
  });

  it("is empty for a piece the book doesn't have", () => {
    expect(entriesInPiece(novel, "sc_n0ne00")).toEqual([]);
  });
});
