import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { ResolvedPos } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { appContextMenu, contributeMenuItems } from "./context-menu.ts";
import { spokenPhrase, type SpokenName } from "./spoken.ts";

/*
 * Dictation's part in the editor (#79, D17). While a phrase is being heard its words show at the
 * caret, greyed, as a decoration: not in the document, so they're never saved, counted, found or
 * undone. When the recognizer settles the phrase it's inserted at the caret as one change, spaced and
 * capitalised for where it lands, with the book's names spelled as its index has them; "new
 * paragraph" or "new line" said alone makes one (spoken.ts, #81). The app hears, through its host; the editor only shows and writes,
 * and offers the app's Dictate on its key and in its right-click menu once the app says it can hear.
 */

/** What the app gives the editors once its host can hear. */
export interface DictationOffer {
  /** Whether it's listening into `editor`. */
  listening(editor: Editor): boolean;
  /** Dictate into `editor`, or stop. */
  toggle(editor: Editor): void;
  /** `editor` took the caret: a phrase being heard follows it there. */
  focused(editor: Editor): void;
  /** `editor` is going (its page left, the app hidden): it has written the words heard so far. */
  left(editor: Editor): void;
}

let offer: DictationOffer | undefined;

/** Offer dictation in every editor, or (undefined) stop offering it. */
export function offerDictation(next: DictationOffer | undefined): void {
  offer = next;
}

/** Dictate's shortcut, TipTap style. */
export const DICTATE_KEYS = "Mod-Shift-d";

const key = new PluginKey<string>("ghwDictation");

/** The words being heard in `state`, not yet settled. */
export function heardText(state: EditorState): string {
  return key.getState(state) ?? "";
}

/** Show `text` at the caret as the phrase being heard, in place of what was shown before. */
export function showHeard(editor: Editor, text: string): void {
  if (editor.isDestroyed || heardText(editor.state) === text) return;
  editor.view.dispatch(editor.state.tr.setMeta(key, text).setMeta("addToHistory", false));
}

/**
 * Write `text` at the caret as one change (replacing a selection, as typing does), and stop showing
 * what was heard. An empty phrase only clears it.
 */
export function settleHeard(editor: Editor, text: string): void {
  if (editor.isDestroyed) return;
  const spoken = spokenPhrase(text, bookNames(editor));
  if (spoken.kind !== "text") {
    // Its own undo step too, in place of a selection.
    const chain = editor.chain().command(({ tr }) => {
      closeHistory(tr.setMeta(key, ""));
      if (!tr.selection.empty) tr.deleteSelection();
      return true;
    });
    (spoken.kind === "paragraph" ? chain.splitBlock() : chain.insertContent({ type: "hard_break" })).scrollIntoView().run();
    return;
  }
  const { state } = editor;
  const { from, to, $from, $to } = state.selection;
  const words = joinPhrase(textBefore($from), spoken.text, $to.parent.isTextblock ? $to.parent.textBetween($to.parentOffset, $to.parent.content.size, undefined, "￼") : "");
  const tr = state.tr.setMeta(key, "");
  // Its own undo step, never merged with the typing before it.
  if (words) closeHistory(tr).insertText(words, from, to).scrollIntoView();
  editor.view.dispatch(tr);
}

/** The book's names, as the editor's @ menu has them: none in an editor without it. */
function bookNames(editor: Editor): readonly SpokenName[] {
  const suggest = editor.extensionManager.extensions.find((e) => e.name === "mentionSuggest");
  return (suggest?.options as { entities?: () => readonly SpokenName[] } | undefined)?.entities?.() ?? [];
}

/** Write the words heard so far and say the editor is going, before it's flushed for the last time. */
export function leaveDictation(editor: Editor): void {
  if (editor.isDestroyed) return;
  const heard = heardText(editor.state);
  if (heard) settleHeard(editor, heard);
  if (offer?.listening(editor)) offer.left(editor);
}

/** The paragraph's text before `$pos`; a mention or a picture as one character that's no word's. */
function textBefore($pos: ResolvedPos): string {
  return $pos.parent.isTextblock ? $pos.parent.textBetween(0, $pos.parentOffset, undefined, "￼") : "";
}

// Sentence-ending punctuation, then any closing quotes or brackets.
const SENTENCE_END = /[.!?…]["”’)\]]*\s*$/;
const NO_SPACE_BEFORE = /^[.,;:!?…)\]}”’%]/;
const NO_SPACE_AFTER = /[(\[{“‘\s]$/;
const WORD_NEXT = /^[\p{L}\p{N}“‘(]/u;

/**
 * The text to insert for a settled phrase between `before` and `after` (the paragraph's text either
 * side of the caret): a space before it after a word, none before punctuation or after an opening
 * quote or bracket; a capital at a sentence's start; a space after it before a word. Mid-sentence a
 * capital is left as heard, since a name or "I" may be meant.
 */
export function joinPhrase(before: string, phrase: string, after: string): string {
  let text = phrase.trim().replace(/\s+/g, " ");
  if (!text) return "";
  if (before.trim() === "" || SENTENCE_END.test(before)) text = text.charAt(0).toLocaleUpperCase("en") + text.slice(1);
  if (before !== "" && !NO_SPACE_AFTER.test(before) && !NO_SPACE_BEFORE.test(text)) text = ` ${text}`;
  if (WORD_NEXT.test(after)) text = `${text} `;
  return text;
}

/** The phrase being heard, greyed at the caret; Dictate on its key and in the right-click menu. */
export const DictationExtension = Extension.create({
  name: "ghwDictation",
  addKeyboardShortcuts() {
    return {
      [DICTATE_KEYS]: ({ editor }) => {
        if (!offer) return false;
        offer.toggle(editor);
        return true;
      },
    };
  },
  onFocus({ editor }) {
    offer?.focused(editor);
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<string>({
        key,
        state: {
          init: () => "",
          apply: (tr, heard) => (tr.getMeta(key) as string | undefined) ?? heard,
        },
        props: {
          decorations(state) {
            const heard = key.getState(state);
            if (!heard) return null;
            const at = state.selection.to;
            return DecorationSet.create(state.doc, [
              Decoration.widget(
                at,
                () => {
                  const span = document.createElement("span");
                  span.className = "ghw-heard";
                  // Announced as a whole once settled, not word by word as it's heard.
                  span.setAttribute("aria-hidden", "true");
                  span.textContent = joinPhrase(textBefore(state.selection.$from), heard, "");
                  return span;
                },
                { side: 1, key: `heard:${heard}`, ignoreSelection: true },
              ),
            ]);
          },
          handleDOMEvents: {
            contextmenu: (_view, event) => {
              if (!offer || !appContextMenu() || event.defaultPrevented) return false;
              const on = offer.listening(editor);
              const current = offer;
              contributeMenuItems(event, { items: [{ label: on ? "Stop dictating" : "Dictate", run: () => current.toggle(editor) }] });
              return false;
            },
          },
        },
      }),
    ];
  },
});
