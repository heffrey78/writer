import type { Editor } from "@tiptap/core";
import { AtSign, Command, MessageSquarePlus, Redo2, Undo2, type LucideIcon } from "lucide-react";
import { useEffect, useReducer, useState, type MouseEvent, type ReactNode } from "react";
import { openOverlay } from "../palette.tsx";
import { cn } from "../ui/cn.ts";

/** One of the selected text's actions in the bar: Raise an issue…. */
export interface BarAction {
  label: string;
  icon?: LucideIcon;
  run: () => void;
}

/** Whether the writing view's text has the focus: the bar is for writing in it. */
export function useTextFocused(): boolean {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const check = () => setFocused(!!document.activeElement?.closest(".ghw-prose"));
    check();
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", check);
    return () => {
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", check);
    };
  }, []);
  return focused;
}

/** Follow `editor` as it changes: for Undo and Redo's state and the selection's actions. */
function useEditorChanges(editor: Editor | undefined): void {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!editor) return;
    editor.on("transaction", bump);
    return () => void editor.off("transaction", bump);
  }, [editor]);
}

/** "@" at the caret, after a space if it follows a word: the mention menu opens for what's typed next. */
function mention(editor: Editor): void {
  const { $from } = editor.state.selection;
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, undefined, "\ufffc");
  editor.chain().focus().insertContent(before && !/[\s(\u201c"\u2018'\u2014\u2013-]$/u.test(before) ? " @" : "@").run();
}

// A press here leaves the focus, and the keyboard, with the text.
const keepFocus = (e: MouseEvent) => e.preventDefault();

/**
 * On a phone, while writing (#96): what's wanted at hand, on top of the keyboard, without leaving the
 * text. Commands (the palette), then `dictate` where the device can hear, Undo, Redo, @ to mention,
 * and the selected text's actions while there's a selection.
 */
export function WritingBar({ editor, dictate, selection }: { editor: Editor | undefined; dictate?: ReactNode; selection: BarAction[] }) {
  useEditorChanges(editor);
  const live = editor && !editor.isDestroyed ? editor : undefined;
  const selected = !!live && !live.state.selection.empty;
  return (
    <div role="toolbar" aria-label="Writing" className="flex w-full items-center gap-1 overflow-x-auto">
      <BarButton label="Commands" icon={Command} onPress={() => openOverlay("palette")} />
      {dictate}
      <BarButton label="Undo" icon={Undo2} disabled={!live?.can().undo()} onPress={() => live?.commands.undo()} />
      <BarButton label="Redo" icon={Redo2} disabled={!live?.can().redo()} onPress={() => live?.commands.redo()} />
      <BarButton label="Mention" icon={AtSign} disabled={!live} onPress={() => live && mention(live)} />
      {selected &&
        selection.map((a) => (
          <BarButton key={a.label} label={a.label} icon={a.icon ?? MessageSquarePlus} onPress={a.run} wide />
        ))}
    </div>
  );
}

function BarButton({ label, icon: Icon, onPress, disabled, wide }: { label: string; icon: LucideIcon; onPress: () => void; disabled?: boolean; wide?: boolean }) {
  return (
    <button
      type="button"
      aria-label={wide ? undefined : label}
      title={label}
      disabled={disabled}
      onMouseDown={keepFocus}
      onClick={onPress}
      className={cn("inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md text-ink hover:bg-panel disabled:opacity-40", wide ? "px-2.5 text-sm" : "w-10")}
    >
      <Icon className="size-5" aria-hidden />
      {wide && label}
    </button>
  );
}
