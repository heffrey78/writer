import { vocabulary, type Book, type Section } from "@writer/core";
import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNarrow } from "../narrow.ts";
import { Button } from "../ui/button.tsx";
import { chapterTitle } from "./navigation.tsx";
import { newSectionAtEnd, usableLevels, type Structure } from "./structure.ts";

/**
 * New, in a list of what it adds to (#117): a button that becomes a title field. Enter adds it and
 * leaves the field empty for the next, with the focus still there. Titles typed quickly are added in
 * the order they were typed, and one that can't be added comes back to the field. A title is always
 * needed: Enter on an empty field adds nothing.
 */
function AddInPlace({ label, name, add, opened }: { label: string; name: string; add: (title: string) => Promise<boolean>; opened?: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [said, setSaid] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const backToButton = useRef(false);
  const queue = useRef(Promise.resolve());
  const narrow = useNarrow();

  useEffect(() => {
    if (opened) setOpen(true);
  }, [opened]);
  useEffect(() => {
    if (open) field.current?.focus();
    else if (backToButton.current) {
      backToButton.current = false;
      button.current?.focus();
    }
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const title = value.trim();
    if (!title) return;
    setValue("");
    queue.current = queue.current.then(async () => {
      if (await add(title)) {
        setSaid(`Added “${title}”.`);
        // What was added pushes the field down the page, and on a phone toward the keyboard.
        field.current?.scrollIntoView({ block: narrow ? "center" : "nearest" });
      } else {
        setValue((typed) => typed || title);
        setOpen(true);
      }
    });
  };
  const close = () => {
    backToButton.current = true;
    setValue("");
    setOpen(false);
  };

  return (
    // Beside a table wider than a phone, it stays where it can be seen.
    <div className="sticky left-0 w-fit max-w-[calc(100vw-2rem)]">
      {open ? (
        <form
          onSubmit={submit}
          onBlur={(e) => {
            if (!value.trim() && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
          }}
          className="flex items-center gap-1"
        >
          <input
            ref={field}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
            }}
            aria-label={`Title: ${name}`}
            placeholder={`${label}: its title`}
            enterKeyHint="enter"
            className="h-11 w-72 max-w-full min-w-0 rounded-md border border-rule bg-paper px-2 text-sm max-md:text-base"
          />
          {/* Tapped, these leave the focus in the field, and the keyboard up. */}
          <Button type="submit" size="sm" variant="primary" onMouseDown={(e) => e.preventDefault()}>
            Add
          </Button>
          <Button size="sm" variant="ghost" aria-label={`Stop adding: ${name}`} onMouseDown={(e) => e.preventDefault()} onClick={close}>
            <X className="size-4" aria-hidden />
          </Button>
        </form>
      ) : (
        <button ref={button} type="button" aria-label={name} onClick={() => setOpen(true)} className="flex min-h-11 items-center gap-1.5 rounded-md px-1 text-sm text-accent hover:underline md:min-h-8">
          <Plus className="size-4 shrink-0" aria-hidden /> {label}
        </button>
      )}
      {/* Only while it's open: an outline has one of these for every section. */}
      {open && (
        <p role="status" className="sr-only">
          {said}
        </p>
      )}
    </div>
  );
}

/**
 * The outline's New: for a section's pieces, and for the sections at the end. A new section that holds
 * pieces takes the focus to its own New, to go on outlining in it. None where the kind's pieces come
 * from their dates.
 */
export function useAddInPlace(novel: Book, structure: Structure, onPiece?: (id: string, title: string) => void): { piece: (section: Section) => ReactNode; sections: () => ReactNode } {
  const w = vocabulary(novel.kind);
  const [opening, setOpening] = useState<string>();
  if (novel.kind.piece.madeByDate) return { piece: () => null, sections: () => null };
  const inner = novel.kind.levels.at(-1)?.key;
  return {
    piece: (section) => (
      <AddInPlace
        label={`New ${w.piece.one}`}
        name={`New ${w.piece.one} in ${chapterTitle(novel, section)}`}
        opened={opening === section.id}
        add={async (title) => {
          const made = await structure.createScene(section.id, title, undefined, { stay: true });
          if (made) onPiece?.(made.id, title);
          return !!made;
        }}
      />
    ),
    sections: () =>
      usableLevels(novel)
        .filter(({ disabled }) => !disabled)
        .map(({ level }) => (
          <AddInPlace
            key={level.key}
            label={`New ${w.level(level.key).one}`}
            name={`New ${w.level(level.key).one}`}
            add={async (title) => {
              // No `after`: at the end of the section above when it's added, whatever was typed before it.
              const made = await structure.createSection(level.key, newSectionAtEnd(novel, level).parent, title, undefined, { stay: true });
              if (made && level.key === inner) setOpening(made.id);
              return !!made;
            }}
          />
        )),
  };
}
