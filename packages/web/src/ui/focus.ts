/** Where the focus and the caret were when a dialog opened, to go back to when it closes. */
export type FocusMark = { element: HTMLElement | null; range: Range | null };

/** The focus and caret now. The caret is kept since focusing a contenteditable again puts it at the start. */
export function markFocus(): FocusMark {
  const element = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  const sel = window.getSelection();
  return { element, range: element?.isContentEditable && sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null };
}

/**
 * Focus back where the mark says, or on `fallback` if that's gone (the view changed) or was nowhere.
 * Radix calls this a moment after the dialog has gone, when the focus has fallen to the page. If it's
 * somewhere by then, it was put there since, and stays: another dialog's, taken back, would be returned
 * by its focus trap with its input's text selected, so the next key replaced it (CI, under load: "your
 * books" became "r books"); the text's, with its caret moved, would have the caret put back.
 */
export function returnFocus(mark: FocusMark, fallback?: () => HTMLElement | null): void {
  if (document.activeElement && document.activeElement !== document.body) return;
  const back = mark.element?.isConnected ?? false;
  const target = back ? mark.element : (fallback?.() ?? null);
  target?.focus({ preventScroll: true });
  // The caret as it was, in the same frame, before the editor reads the selection.
  if (back && mark.range && target?.contains(mark.range.startContainer)) {
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(mark.range);
  }
}
