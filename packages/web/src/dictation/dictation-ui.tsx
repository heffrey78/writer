import type { Editor } from "@tiptap/core";
import { DICTATE_KEYS } from "@writer/editor";
import { Mic } from "lucide-react";
import { useEffect, type MouseEvent } from "react";
import { useCommands } from "../commands.ts";
import { offerDictationInMenu } from "../desktop.ts";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { initDictation, stop, toggle, useDictation } from "./dictation.ts";

/**
 * Dictation's controls on a book's pages, wherever there's an editor: Dictate in the palette, Escape
 * to stop, the Listening indicator with its Stop button, and what a screen reader is told.
 */
export function DictationControls() {
  const { available, state, last, announcement } = useDictation();
  const listening = state !== "off";
  useEffect(() => void initDictation(), []);
  // The desktop app's Edit menu offers Start Dictation while this page has an editor.
  const offered = available && !!last && !last.isDestroyed;
  useEffect(() => {
    if (!available) return;
    offerDictationInMenu(offered);
    return () => offerDictationInMenu(false);
  }, [available, offered]);

  useCommands(
    () =>
      available && last && !last.isDestroyed
        ? [{ id: "writing.dictate", title: listening ? "Stop dictating" : "Dictate", group: "Writing", keys: DICTATE_KEYS, keywords: ["voice", "speak", "microphone", "speech"], run: () => toggle(last) }]
        : [],
    [available, last, listening],
  );

  // Escape stops it, from the text it's going into: before what Escape does there otherwise.
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      const into = useDictation.getState().editor;
      if (e.key !== "Escape" || !into || into.isDestroyed || !into.view.dom.contains(document.activeElement)) return;
      e.preventDefault();
      e.stopPropagation();
      void stop();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening]);

  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {listening && (
        <div role="group" aria-label="Dictation" className="fixed right-4 bottom-12 z-[60] flex items-center gap-3 rounded-lg border border-rule bg-raised py-1.5 pr-1.5 pl-3 text-sm shadow-lg">
          <span className="size-2.5 animate-pulse rounded-full bg-danger motion-reduce:animate-none" aria-hidden />
          <span>{state === "stopping" ? "Stopping…" : state === "starting" ? "Starting…" : "Listening…"}</span>
          {/* The caret stays in the text: a press here doesn't take the focus. */}
          <Button size="sm" onMouseDown={keepFocus} onClick={() => void stop()} disabled={state === "stopping"}>
            Stop dictating
          </Button>
        </div>
      )}
    </>
  );
}

const keepFocus = (e: MouseEvent) => e.preventDefault();

/** The microphone in the writing view's bar: Dictate into `editor` (or the one last written in), or stop. */
export function DictateButton({ editor }: { editor: Editor | undefined }) {
  const { available, state, last } = useDictation();
  const into = editor && !editor.isDestroyed ? editor : last;
  if (!available || !into) return null;
  const listening = state !== "off";
  return (
    <button
      type="button"
      aria-pressed={listening}
      title={listening ? "Stop dictating" : "Dictate"}
      onMouseDown={keepFocus}
      onClick={() => {
        // From the keyboard the focus is here: back to the text, where the words will go.
        if (!into.isFocused) into.commands.focus(null, { scrollIntoView: false });
        toggle(into);
      }}
      className={cn("mr-auto inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:text-ink", listening && "text-ink")}
    >
      <Mic className={cn("size-3.5", listening && "text-danger")} aria-hidden />
      {listening ? "Stop dictating" : "Dictate"}
    </button>
  );
}
