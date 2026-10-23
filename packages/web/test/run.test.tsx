// @vitest-environment jsdom
import "../../editor/test/dom.ts";
import { act, cleanup, render, screen } from "@testing-library/react";
import { loadBook, type Book, type Piece } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import type { Editor } from "@tiptap/core";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { RunPieces, type Run } from "../src/novel/run.tsx";
import type { Workspace, WorkspaceState } from "../src/novel/workspace.ts";

/** A run of pieces in the writing view (#64): each in its own editor, saving to its own file. */

const sample = join(import.meta.dirname, "../../../examples/sample-journal");
let book: Book;
beforeAll(async () => void (book = await loadBook(nodeSource(sample))));
beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A workspace that opens a piece's file from the book, and records what's changed. */
function workspace() {
  const store = createStore<WorkspaceState>(() => ({ files: {}, conflicts: [], error: undefined }));
  const change = vi.fn((path: string, body: string) => store.setState((s) => ({ files: { ...s.files, [path]: { ...s.files[path]!, body } } })));
  const open = vi.fn(async (paths: string[]) => {
    for (const path of paths) {
      const piece = book.allPieces.find((p) => p.file === path)!;
      store.setState((s) => ({ files: { ...s.files, [path]: { path, frontMatter: "", body: piece.body, disk: piece.body, hash: "h" } } }));
    }
  });
  return { store, open, change, live: () => () => {} } as unknown as Workspace & { change: typeof change; open: typeof open };
}

function mount(pieces: readonly Piece[], more: Partial<Run> = {}) {
  const ws = workspace();
  const editors = new Map<string, Editor>();
  const onFocus = vi.fn((editor: Editor, piece: Piece) => void editors.set(piece.id, editor));
  const run: Run = {
    key: "test",
    heading: "Entries",
    pieces,
    header: (piece) => <h2>{piece.title}</h2>,
    preview: (_piece, body) => <p data-testid="preview">{body}</p>,
    more: "Earlier entries",
    ...more,
  };
  const view = render(<RunPieces run={run} workspace={ws} piece="entry" label={(p) => `Entry text: ${p.title}`} tools={() => ({})} onFocus={onFocus} />);
  return { ws, onFocus, view, rerender: (next: Partial<Run>) => view.rerender(<RunPieces run={{ ...run, ...next }} workspace={ws} piece="entry" label={(p) => `Entry text: ${p.title}`} tools={() => ({})} onFocus={onFocus} />) };
}

describe("a run of pieces", () => {
  it("writes each piece in its own editor, in the order given, saving each to its own file", async () => {
    const pieces = [...book.allPieces].reverse();
    const { ws } = mount(pieces);
    const boxes = await screen.findAllByRole("textbox");
    expect(boxes.map((b) => b.getAttribute("aria-label"))).toEqual(pieces.map((p) => `Entry text: ${p.title}`));
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(pieces.map((p) => p.title));
    expect(ws.open.mock.calls.flat(2).sort()).toEqual(pieces.map((p) => p.file).sort());

    // Typing in the second saves the second's file, and no other.
    const second = pieces[1]!;
    const box = screen.getByRole("textbox", { name: `Entry text: ${second.title}` });
    box.focus();
    act(() => void box.dispatchEvent(new FocusEvent("focus")));
    const editor = (box as unknown as { editor: Editor }).editor;
    act(() => void editor.chain().focus("end").insertContent(" Later.").run());
    act(() => void vi.advanceTimersByTime(400));
    expect(ws.change.mock.calls.map(([path]) => path)).toEqual([second.file]);
    expect(ws.change.mock.calls[0]![1]).toContain("Later.");
  });

  it("tells the writing view which editor the caret is in", async () => {
    const pieces = [...book.allPieces].reverse();
    const { onFocus } = mount(pieces);
    const box = (await screen.findAllByRole("textbox"))[2]!;
    const editor = (box as unknown as { editor: Editor }).editor;
    act(() => void editor.commands.focus("end"));
    act(() => void editor.view.dom.dispatchEvent(new FocusEvent("focus")));
    expect(onFocus).toHaveBeenLastCalledWith(editor, pieces[2]);
  });

  it("only shows the text while reading", async () => {
    const { ws, rerender } = mount(book.allPieces, { reading: true });
    expect(screen.queryAllByRole("textbox")).toEqual([]);
    expect(screen.getAllByTestId("preview")).toHaveLength(book.allPieces.length);
    expect(ws.open).not.toHaveBeenCalled();
    rerender({ reading: false });
    expect(await screen.findAllByRole("textbox")).toHaveLength(book.allPieces.length);
  });

  it("shows a batch at first, and more on asking", async () => {
    const many = Array.from({ length: 12 }, (_, i) => book.allPieces[i % book.allPieces.length]!).map((p, i) => ({ ...p, id: `ent_${i}` }));
    mount(many, { reading: true });
    expect(screen.getAllByRole("article")).toHaveLength(10);
    act(() => screen.getByRole("button", { name: "Earlier entries" }).click());
    expect(screen.getAllByRole("article")).toHaveLength(12);
    expect(screen.queryByRole("button", { name: "Earlier entries" })).toBeNull();
  });
});
