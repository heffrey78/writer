import { useEffect, useRef } from "react";
import { onAndroid } from "./platform.ts";

/*
 * Writer's actions on selected text in Android's own selection toolbar (#95), beside its Cut, Copy
 * and Paste: on a phone, a menu of Writer's own would take the focus from the text and the keyboard
 * with it, and show alongside Android's. The page says which actions it offers; the app's plugin
 * adds them to the toolbar Android shows, and a tap comes back as a `writer-selection-action` event.
 */

export interface SelectionAction {
  id: string;
  label: string;
  run: () => void;
}

const offered = new Map<string, SelectionAction>();
let listening = false;

function send(): void {
  const items = [...offered.values()].map(({ id, label }) => ({ id, label }));
  void import("@tauri-apps/api/core").then(({ invoke }) => invoke("selection_actions", { items })).catch(() => {});
}

/** Offer `actions` in Android's selection toolbar while the caller is mounted (nothing elsewhere). */
export function useSelectionToolbar(actions: SelectionAction[]): void {
  const latest = useRef(actions);
  latest.current = actions;
  const key = actions.map((a) => `${a.id}:${a.label}`).join("\n");
  useEffect(() => {
    if (!onAndroid || !key) return;
    if (!listening) {
      listening = true;
      window.addEventListener("writer-selection-action", (e) => offered.get((e as CustomEvent<string>).detail)?.run());
    }
    // Each runs the caller's latest: the editor and the passage as they are when it's tapped.
    const ids = latest.current.map((a) => a.id);
    for (const a of latest.current) offered.set(a.id, { ...a, run: () => latest.current.find((b) => b.id === a.id)?.run() });
    send();
    return () => {
      for (const id of ids) offered.delete(id);
      send();
    };
  }, [key]);
}
