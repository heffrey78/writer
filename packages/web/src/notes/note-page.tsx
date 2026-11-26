import { isNoteColor, NOTE_COLORS, pieceSections, plural, readFrontMatter, vocabulary, word, type Book, type Note, type NoteColor } from "@writer/core";
import { joinSceneFile } from "@writer/editor";
import { SceneEditor, type SpellService } from "@writer/editor/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { ArrowUpRight, ImagePlus, Palette, Trash2 } from "lucide-react";
import { Dialog, Popover } from "radix-ui";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useStore } from "zustand";
import { api, keys } from "../api.ts";
import { realDay } from "../format.ts";
import { AddButton, EditorButtons, EditorFrame, PencilButton, TextEditor, useInPlace } from "../bible/profile.tsx";
import { chapterTitle } from "@writer/core/diagrams";
import { Chips, Group } from "../novel/scene-details.tsx";
import { Picker } from "../ui/picker.tsx";
import { mentionEntities } from "../bible/types.ts";
import { useCommands } from "../commands.ts";
import { moduleRecordType, moduleRecordTypes } from "../modules.tsx";
import { useNotice } from "../novel/notice.tsx";
import type { Workspace } from "../novel/workspace.ts";
import { ErrorAlert } from "../ui/alert.tsx";
import { Button } from "../ui/button.tsx";
import { Confirm } from "../ui/confirm.tsx";
import { usePictures } from "../novel/use-pictures.tsx";
import { useTextFocused, WritingBar } from "../novel/writing-bar.tsx";
import { DictateButton } from "../dictation/dictation-ui.tsx";
import { useNarrow } from "../narrow.ts";
import { ColorChoice, colorName } from "./note-colors.tsx";
import { PromoteNoteDialog } from "./promote.tsx";
import { SheetHandle } from "../ui/sheet-handle.tsx";

/**
 * A writer's note (heffrey78/gh-writer#205): its title, tags and prose, each edited in place, and what it became if it
 * was promoted. Making it a scene (or what the kind's modules make of a note, an event) turns it into
 * story; Delete takes it away.
 * The prose and tags save to its file as they're made; a new title moves the file.
 */
export function NotePage({
  novelId,
  novel,
  note,
  workspace,
  spell,
  embedded,
}: {
  novelId: string;
  novel: Book;
  note: Note;
  workspace: Workspace;
  spell?: { service: SpellService; onAddWord: (w: string) => void } | undefined;
  /** Shown in a modal over the Notes gallery (heffrey78/gh-writer#235): its title is a level-2 heading with this ID. */
  embedded?: { headingId: string; /** In a modal (heffrey78/gh-writer#233), the dialog's own top heading. */ modal?: boolean };
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const show = useNotice((n) => n.show);
  const file = useStore(workspace.store, (s) => s.files[note.file]);
  const fm = useMemo(() => (file ? (readFrontMatter(joinSceneFile(file)) ?? {}) : {}), [file?.frontMatter]); // eslint-disable-line react-hooks/exhaustive-deps
  const tags = Array.isArray(fm.tags) ? (fm.tags as unknown[]).filter((t): t is string => typeof t === "string") : note.tags;
  // Its color as its file has it now: once the file's open, what it says, or none.
  const color = file ? (isNoteColor(fm.color) ? fm.color : undefined) : note.color;
  const mentions = useMemo(() => mentionEntities(novel), [novel]);
  const w = vocabulary(novel.kind);
  const proseId = useId();
  const place = useInPlace();
  const [promoting, setPromoting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => void workspace.open([note.file]), [workspace, note.file]);
  // What it can become: what the kind's modules make of a note ("an event"), or a piece.
  const into = moduleRecordTypes(novel.kind).flatMap((t) => (t.fromNote ? [word({ label: t.def.noun.short ?? t.def.noun.label, plural: plural(t.def.noun.short ?? t.def.noun.label) })] : []));
  const becomes = [...into.map((x) => x.a), w.piece.a].join(" or ");
  // Pictures, as a scene takes them (#200): dropped, pasted, from Add a picture or the palette.
  const [editor, setEditor] = useState<Editor>();
  const { pictureUrl, picturesFor, ask: askPicture, dialog: pictureDialog } = usePictures(novelId);
  // On a phone, while writing, the bar above the keyboard (#96), with Picture (#203).
  const narrow = useNarrow();
  const inText = useTextFocused();
  const writing = narrow && inText;
  useCommands(
    () => [
      { id: "note.promote", title: `Make “${note.title}” ${becomes}`, group: "Notes", keywords: ["promote", ...into.map((x) => x.one), w.piece.one], run: () => setPromoting(true) },
      { id: "note.insertPicture", title: "Insert a picture…", group: "Notes", keywords: ["image", "map", "handout", "photo"], run: () => askPicture(editor) },
      ...[undefined, ...NOTE_COLORS].map((c) => ({ id: `note.color.${c ?? "none"}`, title: `Note color: ${c ? colorName(c) : "None"}`, group: "Notes", keywords: ["colour"], isActive: () => c === color, run: () => void setColor(c) })),
    ],
    [note.title, w, becomes, editor, color],
  );

  // A note just made: the caret goes into its prose, ready to write (heffrey78/gh-writer#222).
  const { state } = useLocation() as { state: { focusProse?: boolean } | null };
  const prose = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!state?.focusProse || focused.current || !file) return;
    const text = prose.current?.querySelector<HTMLElement>("[contenteditable=true]");
    if (!text) return;
    focused.current = true;
    text.focus();
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
  /** The file's current hash, after anything still being saved. */
  const base = async () => {
    await workspace.autosave.flush();
    return workspace.store.getState().files[note.file]?.hash;
  };
  const rename = async (title: string) => {
    const { file: path } = await api.notes.update(novelId, note.id, { title }, await base());
    await workspace.open([path]);
    await refresh();
  };
  const setTags = async (chosen: string[]) => {
    const list = [...new Set(chosen.map((t) => t.trim()).filter(Boolean))];
    await workspace.editFrontMatter(note.file, [list.length ? { path: ["tags"], value: list } : { path: ["tags"], remove: true }]).catch((e: unknown) => {
      show({ message: `Couldn't change the tags: ${e instanceof Error ? e.message : String(e)}` });
    });
  };
  // Its color (#228): one line of its file, written as any edit is; the gallery's card takes it at once.
  const setColor = async (c: NoteColor | undefined) => {
    const colored = (n: Note): Note => (n.id !== note.id ? n : c ? { ...n, color: c } : (({ color: _, ...rest }) => rest)(n));
    queryClient.setQueryData<{ novel: Book }>(keys.novel(novelId), (data) => data && { ...data, novel: { ...data.novel, notes: data.novel.notes.map(colored) } });
    await workspace.editFrontMatter(note.file, [c ? { path: ["color"], value: c } : { path: ["color"], remove: true }]).catch((e: unknown) => {
      show({ message: `Couldn't change its color: ${e instanceof Error ? e.message : String(e)}` });
      void refresh();
    });
  };
  const bookTags = useMemo(() => [...new Set([...novel.notes, ...novel.entities].flatMap((x) => x.tags))].sort((a, b) => a.localeCompare(b)), [novel]);
  const sceneTitle = (id: string) => novel.allPieces.find((x) => x.id === id)?.title ?? id;
  const setScenes = async (scenes: string[]) => {
    try {
      await api.notes.update(novelId, note.id, { scenes }, await base());
      // The server wrote the file: the open copy follows.
      await workspace.fileChanged({ type: "change", path: note.file, hash: null });
      await refresh();
    } catch (e) {
      show({ message: `Couldn't change its ${w.piece.many}: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
  const remove = useMutation({
    mutationFn: async () => api.notes.delete(novelId, note.id, await base()),
    onSuccess: async () => {
      await refresh();
      void navigate(`/novels/${novelId}/notes`);
    },
  });

  const becameScene = note.became ? novel.allPieces.find((s) => s.id === note.became) : undefined;
  const becameRecord = note.became ? novel.moduleRecords.find((r) => r.id === note.became) : undefined;
  const becameType = becameRecord && moduleRecordType(novel.kind, becameRecord.type);
  const Heading = embedded && !embedded.modal ? "h2" : "h1";
  const iconOnly = narrow ? "size-12 justify-center p-0" : undefined;
  return (
    <div className={embedded ? "grid gap-4" : "mx-auto grid w-full max-w-[calc(var(--ghw-prose-measure)+3rem)] gap-5 px-6 py-6"}>
      <div className="grid gap-1.5">
        <div className={narrow ? "flex items-center gap-1 pr-8" : "flex flex-wrap items-center gap-2 pr-8"}>
          {/* On a phone, the date alone beside the four icons: with "Note", the last went onto a line of its own. */}
          <p className="min-w-0 flex-1 truncate text-sm text-muted">{narrow ? (note.created ? realDay(note.created) : "Note") : `Note${note.created ? ` · ${realDay(note.created)}` : ""}`}</p>
          {/* On a phone, icons alone, each a finger's size: their words squeezed the date onto four lines. */}
          <Button variant="ghost" size="sm" className={iconOnly} aria-label={narrow ? "Add a picture" : undefined} onClick={() => askPicture(editor)} disabled={!editor}>
            <ImagePlus className={narrow ? "size-5" : "size-4"} aria-hidden /> {!narrow && "Add a picture"}
          </Button>
          <Button variant="ghost" size="sm" className={iconOnly} aria-label={narrow ? `Make it ${becomes}` : undefined} onClick={() => setPromoting(true)}>
            <ArrowUpRight className={narrow ? "size-5" : "size-4"} aria-hidden /> {!narrow && `Make it ${becomes}`}
          </Button>
          <NoteColorButton color={color} onChange={(c) => void setColor(c)} narrow={narrow} className={iconOnly} />
          <Button variant="ghost" size="sm" className={iconOnly} aria-label={narrow ? "Delete" : undefined} onClick={() => setDeleting(true)} disabled={remove.isPending}>
            <Trash2 className={narrow ? "size-5" : "size-4"} aria-hidden /> {!narrow && "Delete"}
          </Button>
        </div>
        {place.editing === "title" ? (
          <>
            <Heading id={embedded?.headingId} className="sr-only">
              {note.title}
            </Heading>
            <TextEditor place={place} label="Title" value={note.title} required onSave={rename} />
          </>
        ) : (
          <div className="group flex items-center gap-1">
            <Heading id={embedded?.headingId} className={embedded && !embedded.modal ? "text-xl font-semibold" : "text-2xl font-semibold"}>
              {note.title}
            </Heading>
            <PencilButton place={place} part="title" label="title" />
          </div>
        )}
        {place.editing === "tags" ? (
          // The tags the book already has, to choose from as well as new ones: one tag isn't written two ways.
          <EditorFrame place={place}>
            <Group label="Tags">
              <Chips items={tags.map((t) => ({ id: t, label: t, remove: () => void setTags(tags.filter((x) => x !== t)) }))} />
              <Picker
                label="Add a tag"
                items={bookTags.map((t) => ({ value: t, label: t }))}
                value={undefined}
                chosen={tags}
                onChange={(v) => v && void setTags(tags.includes(v) ? tags.filter((x) => x !== v) : [...tags, v])}
                placeholder="Add a tag…"
                create={{ noun: "tag", create: (name) => name.replace(/,/g, " ").trim() || undefined }}
              />
            </Group>
            <EditorButtons onCancel={() => place.done()} hint="Each change is saved as it's made · Esc returns" />
          </EditorFrame>
        ) : tags.length ? (
          <div className="group flex flex-wrap items-center gap-1.5">
            <ul aria-label="Tags" className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <li key={t} className="rounded-full border border-rule px-2 py-0.5 text-xs">
                  {t}
                </li>
              ))}
            </ul>
            <PencilButton place={place} part="tags" label="tags" />
          </div>
        ) : (
          <AddButton place={place} part="tags">
            Add tags
          </AddButton>
        )}
        {place.editing === "scenes" ? (
          <EditorFrame place={place}>
            <Group label={w.piece.Many}>
              <Chips items={note.scenes.map((id) => ({ id, label: sceneTitle(id), remove: () => void setScenes(note.scenes.filter((x) => x !== id)) }))} />
              <Picker
                label={`Add to ${w.piece.many}`}
                items={pieceSections(novel).flatMap((c) =>
                  c.childIds.filter((id) => !note.scenes.includes(id)).map((id) => ({ value: id, label: sceneTitle(id), group: chapterTitle(novel, c) })),
                )}
                value={undefined}
                onChange={(v) => v && void setScenes([...note.scenes, v])}
                placeholder={`Add ${w.piece.a}…`}
              />
            </Group>
            <EditorButtons onCancel={() => place.done()} hint="Each change is saved as it's made · Esc returns" />
          </EditorFrame>
        ) : note.scenes.length ? (
          <div className="group flex flex-wrap items-center gap-1 text-sm">
            <span className="text-muted">On</span>
            {note.scenes.map((id, i) => (
              <span key={id}>
                {i > 0 && ", "}
                <Link to={`/novels/${novelId}/scene/${id}`} className="text-accent underline decoration-accent/35 underline-offset-[3px] hover:decoration-accent">
                  {sceneTitle(id)}
                </Link>
                {note.pinned.includes(id) && <span className="text-muted"> (pinned)</span>}
              </span>
            ))}
            <PencilButton place={place} part="scenes" label={w.piece.many} />
          </div>
        ) : (
          <AddButton place={place} part="scenes">
            Put it on {w.piece.a}
          </AddButton>
        )}
        {(becameScene || (becameRecord && becameType)) && (
          <p className="text-sm">
            Became {becameScene ? `the ${w.piece.one}` : `the ${word(becameType!.def.noun).one}`}{" "}
            <Link
              to={becameScene ? `/novels/${novelId}/scene/${becameScene.id}` : `/novels/${novelId}/${becameType!.type}/${becameRecord!.id}`}
              className="text-accent underline decoration-accent/35 underline-offset-[3px] hover:decoration-accent"
            >
              “{becameScene?.title ?? becameRecord!.title}”
            </Link>
            .
          </p>
        )}
      </div>

      <section aria-labelledby={proseId} className="grid gap-1">
        <h2 id={proseId} className="sr-only">
          The note
        </h2>
        {file ? (
          <div ref={prose}>
            <SceneEditor
              key={note.file}
              sceneId={note.file}
              label={`Note: ${note.title}`}
              placeholder="What if…"
              markdown={file.body}
              onChange={(md) => workspace.change(note.file, md)}
              entities={mentions}
              pictureUrl={pictureUrl}
              pictures={picturesFor(() => editor)}
              onReady={setEditor}
              className="ghw-notes"
              {...(spell ? { spell } : {})}
            />
          </div>
        ) : (
          <p className="text-sm text-muted">Opening…</p>
        )}
      </section>

      {writing && (
        <div className="sticky bottom-0 z-10 -mx-2 border-t border-rule bg-paper px-2 py-1">
          <WritingBar editor={editor} dictate={<DictateButton editor={editor} bar />} selection={[]} picture={(file) => askPicture(editor, file)} />
        </div>
      )}
      {pictureDialog}
      {promoting && <PromoteNoteDialog novelId={novelId} novel={novel} workspace={workspace} note={note} flush={() => workspace.autosave.flush()} open onOpenChange={setPromoting} />}
      <Confirm open={deleting} onOpenChange={setDeleting} title={`Delete “${note.title}”?`} description={`The note goes from the ${w.book.one}. It stays in the history.`} action="Delete" danger onConfirm={() => remove.mutate()} />
      {remove.isError && <ErrorAlert title="Couldn't delete it">{remove.error.message}</ErrorAlert>}
    </div>
  );
}

/**
 * Color (#228), among the note's icons, named for the color it has ("Color: yellow"): on a phone its
 * choices in a sheet, each a finger's size with its name under it; on the desktop in a popover. A color
 * chosen is written at once; the sheet or popover stays, for another.
 */
function NoteColorButton({ color, onChange, narrow, className }: { color: NoteColor | undefined; onChange: (c: NoteColor | undefined) => void; narrow: boolean; className: string | undefined }) {
  const [open, setOpen] = useState(false);
  const name = `Color: ${color ?? "none"}`;
  const trigger = (
    <Button variant="ghost" size="sm" className={className} aria-label={name} title={name}>
      <Palette className={narrow ? "size-5" : "size-4"} aria-hidden /> {!narrow && "Color"}
    </Button>
  );
  const hint = <p className="text-xs text-muted">Kept with the note, so its card has it on every device. Each theme draws it in its own shade.</p>;
  if (narrow)
    return (
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40" />
          <Dialog.Content aria-describedby={undefined} className="fixed inset-x-0 bottom-0 z-[60] grid gap-3 rounded-t-2xl border-t border-rule bg-raised px-4 pt-0 pb-5 text-ink shadow-xl">
            <SheetHandle edge="bottom" onClose={() => setOpen(false)} />
            <Dialog.Title className="text-lg font-semibold">Color</Dialog.Title>
            <ColorChoice label="Color" value={color} onChange={onChange} />
            {hint}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} aria-label="Color" className="z-[60] grid w-80 gap-3 rounded-xl border border-rule bg-raised p-4 text-sm text-ink shadow-lg">
          <ColorChoice label="Color" value={color} onChange={onChange} />
          {hint}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
