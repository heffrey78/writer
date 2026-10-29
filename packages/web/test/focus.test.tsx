// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { markFocus, returnFocus } from "../src/ui/focus.ts";

/** A dialog's focus goes back where it was when it opened, unless something has taken it since. */

afterEach(() => document.body.replaceChildren());

function page() {
  document.body.innerHTML = `<div class="text" contenteditable="true"><p>One two three.</p></div><button>Drafts</button><div role="dialog"><input aria-label="Search"></div>`;
  return { text: document.querySelector<HTMLElement>(".text")!, button: document.querySelector("button")!, input: document.querySelector("input")!, dialog: document.querySelector<HTMLElement>('[role="dialog"]')! };
}

describe("returnFocus", () => {
  // The caret is the e2e's (palette.spec.ts): jsdom has no isContentEditable.
  it("goes back to the text", () => {
    const { text, input } = page();
    text.focus();
    const mark = markFocus();
    input.focus();
    input.remove(); // the dialog closes, and the focus falls to the page
    returnFocus(mark);
    expect(document.activeElement).toBe(text);
  });

  it("leaves the focus with another dialog that opened before it ran", () => {
    const { text, input } = page();
    text.focus();
    const mark = markFocus();
    // The palette, opened again before the last one's focus came back: what's typed in it stays.
    input.focus();
    input.value = "you";
    returnFocus(mark);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("you");
  });

  it("leaves the focus where the writer has put it since", () => {
    const { text, button, dialog } = page();
    text.focus();
    const mark = markFocus();
    dialog.remove();
    button.focus();
    returnFocus(mark);
    expect(document.activeElement).toBe(button);
  });

  it("goes to the fallback when what had the focus is gone, and nowhere without one", () => {
    const { button, input, dialog } = page();
    input.focus();
    const mark = markFocus();
    dialog.remove();
    returnFocus(mark, () => button);
    expect(document.activeElement).toBe(button);
    button.blur();
    returnFocus(mark);
    expect(document.activeElement).toBe(document.body);
  });
});
