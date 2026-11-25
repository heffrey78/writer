// @vitest-environment jsdom
import "../../editor/test/dom.ts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proseContent } from "@writer/editor";
import { WritingBar } from "../src/novel/writing-bar.tsx";

/** The bar above a phone's keyboard (#96), with Picture where pictures can go (#203). */

afterEach(() => cleanup());
const editor = () => new Editor({ element: document.createElement("div"), extensions: [...proseContent, UndoRedo] });

describe("the writing bar", () => {
  it("has no Picture where pictures can't go", () => {
    render(<WritingBar editor={editor()} selection={[]} />);
    expect(screen.queryByRole("button", { name: "Picture" })).toBeNull();
  });

  it("shows Picture where they can, whose two choices hand the file chosen on", () => {
    const picture = vi.fn();
    render(<WritingBar editor={editor()} selection={[]} picture={picture} />);
    const button = screen.getByRole("button", { name: "Picture" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    // A press keeps the focus, and the keyboard, with the text.
    expect(fireEvent.mouseDown(button)).toBe(false);
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const camera = document.querySelector<HTMLInputElement>('input[type="file"][capture="environment"]')!;
    const clicked = vi.spyOn(camera, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Take a photo" }));
    expect(clicked).toHaveBeenCalled();
    // The choices close once one is made.
    expect(screen.queryByRole("button", { name: "Take a photo" })).toBeNull();
    const photo = new File([new Uint8Array(4)], "sketch.jpg", { type: "image/jpeg" });
    fireEvent.change(camera, { target: { files: [photo] } });
    expect(picture).toHaveBeenCalledWith(photo);

    fireEvent.click(button);
    const photos = document.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')!;
    const chose = vi.spyOn(photos, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Choose from your photos" }));
    expect(chose).toHaveBeenCalled();
  });

  it("makes every target a finger's size, 48 px", () => {
    render(<WritingBar editor={editor()} selection={[]} picture={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Picture" }));
    for (const b of screen.getAllByRole("button")) expect(b.className).toMatch(/\bh-12\b/);
  });

  it("with a selection, puts its actions in place of Mention and Picture, so the bar fits a phone", () => {
    const e = editor();
    e.commands.setContent("<p>The ford floods.</p>");
    e.commands.setTextSelection({ from: 1, to: 4 });
    render(<WritingBar editor={e} selection={[{ label: "Raise an issue…", run: () => {} }, { label: "Add to an entry…", run: () => {} }]} picture={() => {}} />);
    expect(screen.queryByRole("button", { name: "Mention" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Picture" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add to an entry…" })).toBeTruthy();
  });
});
