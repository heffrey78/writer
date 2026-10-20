import { Extension, type Editor } from "@tiptap/core";
import { createStore } from "zustand/vanilla";
import type { EditorCommand } from "./modes.ts";
import type { SearchScope } from "./search.ts";
import type { EditorWords } from "./words.ts";

/*
 * Opening the find panel. The panel belongs to the app, so the editor's shortcuts (and the
 * command palette) only ask for it through this store; the panel opens, takes focus and seeds
 * its query from the selection.
 */

export interface FindPanelState {
  open: boolean;
  scope: SearchScope;
  /** Text to search for when the panel opens (the selection), or "" to keep the last query. */
  seed: string;
  /** Changes on every request to open, so the panel refocuses even if it's already open. */
  request: number;
}

export const findPanel = createStore<FindPanelState>()(() => ({ open: false, scope: "scene", seed: "", request: 0 }));

/** Open the find panel for a scope, seeded with the editor's selected text if it's on one line. */
export function openFind(scope: SearchScope, editor?: Editor | null): void {
  let seed = "";
  if (editor && !editor.isDestroyed) {
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, "\n");
    if (text && !text.includes("\n") && text.length <= 200) seed = text;
  }
  findPanel.setState((s) => ({ open: true, scope, seed, request: s.request + 1 }));
}

export function closeFind(): void {
  findPanel.setState({ open: false });
}

const FINDS: { id: string; scope: SearchScope; keys?: string; title: (w: EditorWords) => string }[] = [
  { id: "editor.findInScene", scope: "scene", keys: "Mod-f", title: (w) => `Find in ${w.piece.one}` },
  { id: "editor.findInChapter", scope: "chapter", title: (w) => `Find in ${w.section.one}` },
  { id: "editor.findInManuscript", scope: "manuscript", keys: "Mod-Shift-h", title: (w) => `Find and replace in ${w.content.one}` },
];

/** The find commands, in the book's words: "Find in scene". */
export function findCommands(words: EditorWords): EditorCommand[] {
  return FINDS.map((f) => ({ id: f.id, title: f.title(words), ...(f.keys ? { keys: f.keys } : {}), run: (editor) => openFind(f.scope, editor) }));
}

/** The find shortcuts, from inside the text. */
export const FindExtension = Extension.create({
  name: "find",
  addKeyboardShortcuts() {
    const shortcuts: Record<string, () => boolean> = {};
    for (const f of FINDS) if (f.keys) shortcuts[f.keys] = () => (openFind(f.scope, this.editor), true);
    return shortcuts;
  },
});
