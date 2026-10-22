import { exit, onBackButtonPress } from "@tauri-apps/api/app";

/** What's open over the page and closed by Escape: a dialog, a menu, a popover (Radix marks each). */
const OPEN_LAYER = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [data-radix-popper-content-wrapper]';

/**
 * Android's back, the gesture or the button: what's open over the page closes first, as Escape closes
 * it. Left to the webview, back went to the previous page with the dialog still open over it, and a
 * dialog without a close button couldn't be closed at all. With nothing open, back goes back a page,
 * and from the first page leaves the app, as Android's back does.
 */
export function onBack(canGoBack: boolean, { back, leave }: { back: () => void; leave: () => void }): void {
  if (document.querySelector(OPEN_LAYER)) {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  } else if (canGoBack) back();
  else leave();
}

/** Take Android's back from the webview, in the Android app. */
export function handleBack(): void {
  void onBackButtonPress(({ canGoBack }) => onBack(canGoBack, { back: () => history.back(), leave: () => void exit(0) }));
}
