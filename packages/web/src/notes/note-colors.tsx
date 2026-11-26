import { NOTE_COLORS, type NoteColor } from "@writer/core";
import { Check, X } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { useRef, type KeyboardEvent } from "react";
import { cn } from "../ui/cn.ts";

/*
 * A note's color (D24, #222): one of eight names, drawn by each theme in its own shade (themes.ts).
 * The classes are written out whole, so Tailwind finds them.
 */

export const NOTE_BG: Record<NoteColor, string> = {
  red: "bg-note-red",
  orange: "bg-note-orange",
  yellow: "bg-note-yellow",
  green: "bg-note-green",
  teal: "bg-note-teal",
  blue: "bg-note-blue",
  purple: "bg-note-purple",
  gray: "bg-note-gray",
};

/** "Yellow". */
export const colorName = (c: NoteColor) => c.charAt(0).toUpperCase() + c.slice(1);

/** A color's dot, for a chip or a choice: an edge drawn, so a pale one is seen on paper. */
export function Swatch({ color, className }: { color: NoteColor | undefined; className?: string }) {
  return <span aria-hidden className={cn("inline-block shrink-0 rounded-full border", color ? cn(NOTE_BG[color], "border-ink/25") : "border-dashed border-muted", className)} />;
}

const ARROWS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];

/**
 * A radio group whose arrows choose as they move, as a radio group's do: Radix's own does it only while
 * the key is still down when the focus arrives, which it moves a moment later, and a quick press is up by then.
 * Spread `root` on the group and call `item(value)` for each choice's props.
 */
export function useArrowsChoose(onChoose: (value: string) => void) {
  const arrow = useRef(false);
  return {
    root: { onKeyDownCapture: (e: KeyboardEvent) => void (arrow.current = ARROWS.includes(e.key)) },
    item: (value: string) => ({
      onFocus: () => {
        if (!arrow.current) return;
        arrow.current = false;
        onChoose(value);
      },
    }),
  };
}

/**
 * Choosing a note's color (#228): None and the eight, one radio group (the arrows move through it). On a
 * phone, each a finger's size with its name under it; `compact`, the dots alone, named for a screen
 * reader and on hover.
 */
export function ColorChoice({ value, onChange, label, compact, none = "None" }: { value: NoteColor | undefined; onChange: (c: NoteColor | undefined) => void; label: string; compact?: boolean; none?: string }) {
  const choose = (v: string) => onChange(v === "none" ? undefined : (v as NoteColor));
  const arrows = useArrowsChoose(choose);
  const choices: { value: string; color: NoteColor | undefined; name: string }[] = [{ value: "none", color: undefined, name: none }, ...NOTE_COLORS.map((c) => ({ value: c, color: c, name: colorName(c) }))];
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value ?? "none"}
      onValueChange={choose}
      {...arrows.root}
      orientation="horizontal"
      loop
      className={compact ? "flex flex-wrap gap-1.5" : "grid grid-cols-5 gap-x-1 gap-y-3"}
    >
      {choices.map((c) => {
        const on = (value ?? "none") === c.value;
        return (
          <RadioGroup.Item
            key={c.value}
            value={c.value}
            {...arrows.item(c.value)}
            aria-label={compact ? c.name : undefined}
            title={compact ? c.name : undefined}
            className={cn(
              "group grid cursor-pointer justify-items-center rounded-full focus-visible:outline-none",
              compact ? "size-8 place-items-center focus-visible:ring-2 focus-visible:ring-accent" : "min-h-12 gap-1 rounded-lg py-1 text-xs focus-visible:ring-2 focus-visible:ring-accent",
            )}
          >
            <span className={cn("relative grid place-items-center rounded-full", compact ? "size-8" : "size-11", on && "ring-2 ring-accent ring-offset-2 ring-offset-raised")}>
              <Swatch color={c.color} className="absolute inset-0 size-full" />
              {on ? <Check className="relative size-4 text-ink" aria-hidden /> : !c.color && <X className="relative size-4 text-muted" aria-hidden />}
            </span>
            {!compact && <span className={cn(on ? "font-semibold text-ink" : "text-muted")}>{c.name}</span>}
          </RadioGroup.Item>
        );
      })}
    </RadioGroup.Root>
  );
}
