// @vitest-environment jsdom
import "../../editor/test/dom.ts";
import { act, cleanup, render, screen } from "@testing-library/react";
import { loadBook, type Book, type Piece } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import type { Editor } from "@tiptap/core";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { useNotice } from "../src/novel/notice.tsx";
import { BEGIN, RunPieces, type Run } from "../src/novel/run.tsx";
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
    // As the workspace's: a file open already stays as it is.
    for (const path of paths.filter((p) => !store.getState().files[p])) {
      // A piece just made is empty.
      const body = book.allPieces.find((p) => p.file === path)?.body ?? "";
      store.setState((s) => ({ files: { ...s.files, [path]: { path, frontMatter: "", body, disk: body, hash: "h" } } }));
    }
  });
  return { store, open, change, live: () => () => {} } as unknown as Workspace & { change: typeof change; open: typeof open };
}

function mount(pieces: readonly Piece[], more: Partial<Run> = {}) {
  const ws = workspace();
  const editors = new Map<string, Editor>();
  const onFocus = vi.fn((editor: Editor, piece: Piece | undefined) => void editors.set(piece?.id ?? BEGIN, editor));
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

describe("the place to begin a piece", () => {
  const today = () => ({ ...book.allPieces[0]!, id: "ent_today", title: "Friday, 23 October", file: "entries/01-2026/01-october/04-friday-23-october.md", body: "" });
  const begin = (make: () => Promise<string>) => ({ label: "Write today's entry", header: <h2>Today</h2>, make, keep: "test:begin" });
  beforeEach(() => sessionStorage.clear());
  const typeIn = (editor: Editor, text: string) => {
    act(() => void editor.chain().focus("end").insertContent(text).run());
    act(() => void vi.advanceTimersByTime(400));
  };

  it("makes the piece on its first words, and the same editor goes on as the piece's, every word kept", async () => {
    const make = vi.fn(async () => "ent_today");
    const { ws, rerender } = mount(book.allPieces, { begin: begin(make) });
    const box = await screen.findByRole("textbox", { name: "Write today's entry" });
    const editor = (box as unknown as { editor: Editor }).editor;
    typeIn(editor, "Rain");
    expect(make).toHaveBeenCalledTimes(1);
    // Typing goes on while it's made.
    typeIn(editor, " at dawn");
    expect(make).toHaveBeenCalledTimes(1);
    await act(async () => {});

    // The book has it: the run's caller gives it first, with no place to begin one.
    const made = today();
    rerender({ pieces: [made, ...book.allPieces], begin: undefined });
    await act(async () => {});
    expect(screen.getAllByRole("article")[0]!.getAttribute("aria-label")).toBe(made.title);
    expect(screen.getAllByRole("textbox")[0]).toBe(box);
    // Still the place's name: renaming the text box under the writer restarts Android's keyboard.
    expect(box.getAttribute("aria-label")).toBe("Write today's entry");
    expect(ws.store.getState().files[made.file]?.body).toBe("Rain at dawn\n");
    typeIn(editor, ".");
    expect(ws.store.getState().files[made.file]?.body).toBe("Rain at dawn.\n");
    expect(editor.getText()).toBe("Rain at dawn.");
    // Kept in the tab only until the file had them.
    expect(sessionStorage.getItem("test:begin")).toBeNull();
  });

  it("words reported as the piece's file opens, before the place has caught up, go into the file (#79)", async () => {
    const make = vi.fn(async () => "ent_today");
    const { ws, rerender } = mount(book.allPieces, { begin: begin(make) });
    const editor = ((await screen.findByRole("textbox", { name: "Write today's entry" })) as unknown as { editor: Editor }).editor;
    // A whole phrase at once, as dictation writes it: one change, and one report of it.
    act(() => void editor.chain().focus("end").insertContent("Fog on the water.").run());
    await act(async () => {});
    expect(make).toHaveBeenCalledTimes(1);
    // The made piece's file opens when the test says.
    let opened!: () => void;
    const gate = new Promise<void>((resolve) => (opened = resolve));
    const open = ws.open.getMockImplementation()!;
    ws.open.mockImplementation(async (paths) => {
      await gate;
      await open(paths);
    });
    const made = today();
    rerender({ pieces: [made, ...book.allPieces], begin: undefined });
    await act(async () => {
      opened();
      for (let i = 0; i < 5; i++) await Promise.resolve();
      // The report comes now, before the place renders as the piece's.
      vi.advanceTimersByTime(400);
    });
    expect(ws.store.getState().files[made.file]?.body).toBe("Fog on the water.\n");
  });

  it("the book has the piece before make() answers: the same editor goes on, with the words not yet reported (CI, under load)", async () => {
    let answer!: (id: string) => void;
    const make = vi.fn(() => new Promise<string>((resolve) => (answer = resolve)));
    const { ws, rerender } = mount(book.allPieces, { begin: begin(make) });
    const box = await screen.findByRole("textbox", { name: "Write today's entry" });
    const editor = (box as unknown as { editor: Editor }).editor;
    // The first keystroke makes it, before the editor's pause has reported anything.
    act(() => void editor.chain().focus("end").insertContent("W").run());
    expect(make).toHaveBeenCalledTimes(1);
    // The file's arrival reloads the book: the run has the piece, says it's the one begun, and
    // no longer offers the place, all before make() has answered.
    const made = today();
    rerender({ pieces: [made, ...book.allPieces], begin: undefined, begun: { id: made.id, keep: "test:begin" } });
    await act(async () => {});
    expect(screen.getAllByRole("textbox")[0]).toBe(box);
    act(() => void editor.chain().focus("end").insertContent("ritten without a pause.").run());
    await act(async () => void answer(made.id));
    act(() => void vi.advanceTimersByTime(400));
    await act(async () => {});
    expect(screen.getAllByRole("textbox")[0]).toBe(box);
    expect(ws.store.getState().files[made.file]?.body).toBe("Written without a pause.\n");
  });

  it("the next day's place is its own, not the piece the last one made", async () => {
    const make = vi.fn(async () => "ent_today");
    const { rerender } = mount(book.allPieces, { begin: begin(make) });
    const editor = ((await screen.findByRole("textbox", { name: "Write today's entry" })) as unknown as { editor: Editor }).editor;
    typeIn(editor, "Rain");
    await act(async () => {});
    const made = today();
    rerender({ pieces: [made, ...book.allPieces], begin: undefined, begun: { id: made.id, keep: "test:begin" } });
    await act(async () => {});
    // Midnight: a place for the new day, and yesterday's piece is a piece.
    rerender({ pieces: [made, ...book.allPieces], begin: { ...begin(make), keep: "test:tomorrow" } });
    await act(async () => {});
    expect(screen.getAllByRole("article")[0]!.getAttribute("aria-label")).toBe("Write today's entry");
    expect(screen.getAllByRole("article")[1]!.getAttribute("aria-label")).toBe(made.title);
  });

  it("a letter typed into yesterday's piece as the new day's place comes is kept in yesterday's file", async () => {
    const make = vi.fn(async () => "ent_today");
    const { ws, rerender } = mount(book.allPieces, { begin: begin(make) });
    const editor = ((await screen.findByRole("textbox", { name: "Write today's entry" })) as unknown as { editor: Editor }).editor;
    typeIn(editor, "Rain");
    await act(async () => {});
    const made = today();
    rerender({ pieces: [made, ...book.allPieces], begin: undefined, begun: { id: made.id, keep: "test:begin" } });
    await act(async () => {});
    // Not reported yet when midnight's render comes.
    act(() => void editor.chain().focus("end").insertContent("W").run());
    rerender({ pieces: [made, ...book.allPieces], begin: { ...begin(make), keep: "test:tomorrow" } });
    await act(async () => {});
    act(() => void vi.advanceTimersByTime(400));
    expect(ws.store.getState().files[made.file]?.body).toBe("RainW\n");
  });

  it("made, but the next day came before the book had it: the piece takes the words its place kept", async () => {
    const make = vi.fn(async () => "ent_today");
    const { ws, rerender } = mount(book.allPieces, { begin: begin(make) });
    const editor = ((await screen.findByRole("textbox", { name: "Write today's entry" })) as unknown as { editor: Editor }).editor;
    typeIn(editor, "Rain, then wind.");
    await act(async () => {});
    expect(make).toHaveBeenCalledTimes(1);
    // Midnight before the reload: the next day's place, then the book with yesterday's piece in it.
    rerender({ pieces: book.allPieces, begin: { ...begin(make), keep: "test:tomorrow" } });
    await act(async () => {});
    const made = today();
    rerender({ pieces: [made, ...book.allPieces], begin: { ...begin(make), keep: "test:tomorrow" } });
    await act(async () => {});
    await act(async () => {});
    expect(ws.store.getState().files[made.file]?.body).toBe("Rain, then wind.\n");
    expect(sessionStorage.getItem("test:begin")).toBeNull();
  });

  it("the next day's place starts making its own before the book has yesterday's: yesterday's still takes its words", async () => {
    const make = vi.fn(async () => "ent_today");
    const { ws, rerender } = mount(book.allPieces, { begin: begin(make) });
    const editor = ((await screen.findByRole("textbox", { name: "Write today's entry" })) as unknown as { editor: Editor }).editor;
    typeIn(editor, "Rain, then wind.");
    await act(async () => {});
    rerender({ pieces: book.allPieces, begin: { ...begin(vi.fn(async () => "ent_tomorrow")), keep: "test:tomorrow" } });
    const next = ((await screen.findByRole("textbox", { name: "Write today's entry" })) as unknown as { editor: Editor }).editor;
    typeIn(next, "Frost.");
    await act(async () => {});
    const made = today();
    rerender({ pieces: [made, ...book.allPieces], begin: { ...begin(vi.fn(async () => "ent_tomorrow")), keep: "test:tomorrow" } });
    await act(async () => {});
    await act(async () => {});
    expect(ws.store.getState().files[made.file]?.body).toBe("Rain, then wind.\n");
  });

  it("the page left before the book had today's piece, and come back to: the piece takes the words its place kept", async () => {
    sessionStorage.setItem("test:begin", "Fog till noon.\n");
    const made = today();
    const { ws } = mount([made, ...book.allPieces], { begun: { id: made.id, keep: "test:begin" } });
    await act(async () => {});
    await act(async () => {});
    expect(ws.store.getState().files[made.file]?.body).toBe("Fog till noon.\n");
  });

  it("keeps the words typed before the piece is made, and after a reload makes it for them", async () => {
    const make = vi.fn(() => new Promise<string>(() => {}));
    const first = mount(book.allPieces, { begin: begin(make) });
    typeIn(((await screen.findByRole("textbox", { name: "Write today's entry" })) as unknown as { editor: Editor }).editor, "Rain");
    expect(sessionStorage.getItem("test:begin")).toBe("Rain\n");
    first.view.unmount();

    const again = vi.fn(async () => "ent_today");
    mount(book.allPieces, { begin: begin(again) });
    const box = await screen.findByRole("textbox", { name: "Write today's entry" });
    expect(box.textContent).toBe("Rain");
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("makes nothing if nothing is typed", async () => {
    const make = vi.fn(async () => "ent_today");
    mount(book.allPieces, { begin: begin(make) });
    const box = await screen.findByRole("textbox", { name: "Write today's entry" });
    const editor = (box as unknown as { editor: Editor }).editor;
    act(() => void editor.commands.focus());
    act(() => void editor.view.dom.dispatchEvent(new FocusEvent("blur")));
    act(() => void vi.advanceTimersByTime(1000));
    expect(make).not.toHaveBeenCalled();
  });

  it("keeps the words if the piece can't be made, and tries again as typing goes on", async () => {
    const make = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error("The disk is full")).mockResolvedValue("ent_today");
    mount(book.allPieces, { begin: begin(make) });
    const editor = ((await screen.findByRole("textbox", { name: "Write today's entry" })) as unknown as { editor: Editor }).editor;
    typeIn(editor, "Rain");
    await act(async () => {});
    expect(useNotice.getState().notice?.message).toMatch(/^Couldn't start the entry: The disk is full\. Your words are kept here/);
    expect(editor.getText()).toBe("Rain");
    typeIn(editor, ".");
    expect(make).toHaveBeenCalledTimes(2);
  });
});
