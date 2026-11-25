import type { Editor } from "@tiptap/core";
import { AtSign, Camera, ChevronDown, Command, ImagePlus, Images, Keyboard, MessageSquarePlus, Redo2, Undo2, type LucideIcon } from "lucide-react";
import { useEffect, useReducer, useRef, useState, type MouseEvent, type ReactNode } from "react";
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
 * a picture where pictures can go (#203), and the selected text's actions while there's a selection;
 * last, Hide the keyboard. Every target is at least 48 px, a finger's.
 */
export function WritingBar({ editor, dictate, selection, picture }: { editor: Editor | undefined; dictate?: ReactNode; selection: BarAction[]; picture?: (file: File) => void }) {
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
      {picture && <PictureButton disabled={!live} onPicture={picture} />}
      {/* One in words; more as their icons, or they'd run off a phone's screen. */}
      {selected &&
        selection.map((a) => (
          <BarButton key={a.label} label={a.label} icon={a.icon ?? MessageSquarePlus} onPress={a.run} wide={selection.length === 1} />
        ))}
      {/* The keyboard put away, and the book's bar back (#100): the sign phones' keyboards use for it. */}
      <button
        type="button"
        aria-label="Hide the keyboard"
        title="Hide the keyboard"
        onMouseDown={keepFocus}
        onClick={() => (document.activeElement as HTMLElement | null)?.blur()}
        className="ml-auto grid h-12 w-12 shrink-0 place-items-center content-center rounded-md text-ink hover:bg-panel"
      >
        <Keyboard className="size-5" aria-hidden />
        <ChevronDown className="-mt-1 size-3.5" aria-hidden />
      </button>
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
      className={cn("inline-flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-md text-ink hover:bg-panel disabled:opacity-40", wide ? "px-3 text-sm" : "w-12")}
    >
      <Icon className="size-5" aria-hidden />
      {wide && label}
    </button>
  );
}

/**
 * A picture for the text, on a phone (#203): Picture opens its two choices in the bar, Take a photo
 * (the phone's camera) and Choose from your photos, without taking the focus from the text (a menu
 * would, and the keyboard and the bar would go with it). Either hands the file to `onPicture`, which
 * asks about it as a dropped one is.
 */
function PictureButton({ disabled, onPicture }: { disabled: boolean; onPicture: (file: File) => void }) {
  const [open, setOpen] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const take = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = "";
    if (file) onPicture(file);
  };
  const choose = (input: HTMLInputElement | null) => {
    setOpen(false);
    input?.click();
  };
  return (
    <>
      <button
        type="button"
        aria-label="Picture"
        title="Picture"
        aria-expanded={open}
        disabled={disabled}
        onMouseDown={keepFocus}
        onClick={() => setOpen(!open)}
        className={cn("inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-ink hover:bg-panel disabled:opacity-40", open && "bg-accent-soft")}
      >
        <ImagePlus className="size-5" aria-hidden />
      </button>
      {open && (
        <>
          <BarButton label="Take a photo" icon={Camera} wide onPress={() => choose(camera.current)} />
          <BarButton label="Choose from your photos" icon={Images} wide onPress={() => choose(photos.current)} />
        </>
      )}
      {/* The camera where the phone has one (the app's webview opens it for `capture`); the photos otherwise. */}
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden tabIndex={-1} onChange={(e) => take(e.currentTarget)} />
      <input ref={photos} type="file" accept="image/*" hidden tabIndex={-1} onChange={(e) => take(e.currentTarget)} />
    </>
  );
}
