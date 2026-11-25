// @vitest-environment jsdom
import "./dom.ts";
import type { Editor } from "@tiptap/core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SceneEditor } from "../src/react.tsx";

let editor: Editor;
const onChange = vi.fn<(markdown: string) => void>();

beforeEach(() => {
  vi.useFakeTimers();
  onChange.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount(markdown: string, props: Partial<Parameters<typeof SceneEditor>[0]> = {}) {
  const view = render(<SceneEditor markdown={markdown} label="Scene text" onChange={onChange} onReady={(e) => (editor = e)} {...props} />);
  return {
    ...view,
    update: (next: string) => view.rerender(<SceneEditor markdown={next} label="Scene text" onChange={onChange} onReady={(e) => (editor = e)} {...props} />),
  };
}

const typeAtEnd = (text: string) => act(() => void editor.chain().focus("end").insertContent(text).run());

describe("SceneEditor", () => {
  test("renders the scene as an accessible text area", () => {
    const { getByRole } = mount("[Ada](#char_7f3k2q) *waited*.\n");
    const box = getByRole("textbox", { name: "Scene text" });
    expect(box.getAttribute("aria-multiline")).toBe("true");
    expect(box.textContent).toBe("Ada waited.");
    expect(box.querySelector("em")?.textContent).toBe("waited");
  });

  test("reports changes once typing pauses", () => {
    mount("One.\n", { changeDelay: 300 });
    typeAtEnd(" Two.");
    typeAtEnd(" Three.");
    expect(onChange).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(300));
    expect(onChange.mock.calls).toEqual([["One. Two. Three.\n"]]);
  });

  test("doesn't report edits that end where they started", () => {
    mount("One.\n");
    typeAtEnd("x");
    act(() => void editor.commands.undo());
    act(() => void vi.advanceTimersByTime(1000));
    expect(onChange).not.toHaveBeenCalled();
  });

  test("reports pending changes straight away on blur and unmount", () => {
    const { unmount } = mount("One.\n");
    typeAtEnd("!");
    // jsdom doesn't move focus off a contenteditable; send the event TipTap listens for.
    act(() => void editor.view.dom.dispatchEvent(new FocusEvent("blur")));
    expect(onChange.mock.calls).toEqual([["One.!\n"]]);
    typeAtEnd("?");
    unmount();
    expect(onChange.mock.calls.at(-1)).toEqual(["One.!?\n"]);
  });

  test("its own output coming back as markdown doesn't reload the document", () => {
    const { update } = mount("One.\n");
    typeAtEnd("!");
    act(() => void vi.advanceTimersByTime(300));
    const doc = editor.state.doc;
    update("One.!\n");
    expect(editor.state.doc).toBe(doc);
  });

  test("a new markdown value loads as a new document without reporting a change", () => {
    const { update } = mount("One.\n");
    update("Changed on disk.\n");
    expect(editor.getText()).toBe("Changed on disk.");
    expect(editor.can().undo()).toBe(false);
    act(() => void vi.advanceTimersByTime(1000));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("autofocus", () => {
  test("a new editor takes the focus, unless a dialog opened meanwhile has it", () => {
    mount("One.\n", { autofocus: true });
    act(() => void vi.runAllTimers());
    expect(editor.isFocused).toBe(true);
    cleanup();

    // The palette, opened while the scene was still loading: what's typed in it stays there.
    const dialog = document.body.appendChild(document.createElement("div"));
    dialog.setAttribute("role", "dialog");
    const input = dialog.appendChild(document.createElement("input"));
    input.focus();
    mount("One.\n", { autofocus: true });
    act(() => void vi.runAllTimers());
    expect(document.activeElement).toBe(input);
    expect(editor.isFocused).toBe(false);
    cleanup();

    // One closing, though the focus is still in it (a phone's Go to, as the new scene it made opens): the text takes it.
    dialog.setAttribute("data-state", "closed");
    input.focus();
    mount("One.\n", { autofocus: true });
    act(() => void vi.runAllTimers());
    expect(editor.isFocused).toBe(true);
    dialog.remove();
    cleanup();

    // Made before it's shown (React rendering the next page ahead of showing it): focused once it's on
    // the page, not while the page before it still has a dialog in focus.
    const page = document.createElement("div");
    const leaving = document.body.appendChild(document.createElement("div"));
    leaving.setAttribute("role", "dialog");
    const button = leaving.appendChild(document.createElement("button"));
    button.focus();
    render(<SceneEditor markdown={"One.\n"} label="Scene text" onReady={(e) => (editor = e)} autofocus />, { container: page });
    act(() => void vi.advanceTimersByTime(50));
    expect(editor.isFocused).toBe(false);
    leaving.remove();
    document.body.append(page);
    act(() => void vi.advanceTimersByTime(100));
    expect(editor.isFocused).toBe(true);
    page.remove();
  });
});

