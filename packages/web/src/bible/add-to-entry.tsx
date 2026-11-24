import type { Editor } from "@tiptap/core";
import { useQueryClient } from "@tanstack/react-query";
import { appendQuote, entriesInPiece, mentionOf, noteAbout, vocabulary, type Book, type Entity } from "@writer/core";
import { joinSceneFile } from "@writer/editor";
import { Command as Cmdk } from "cmdk";
import { Dialog } from "radix-ui";
import { useId, useState } from "react";
import { create } from "zustand";
import { api, keys } from "../api.ts";
import type { Passage as Selected } from "../issues/raise.tsx";
import { useNotice } from "../novel/notice.tsx";
import type { Workspace } from "../novel/workspace.ts";
import { Button } from "../ui/button.tsx";
import { typeOf } from "./types.ts";

/*
 * Add to an entry (#157): words just written, put into an entry without leaving the sentence. Into
 * a note about it as a quote naming the piece (core's appendQuote: the profile finds the sentence again
 * by it), or as a field's value. An entry has no notes of its own (D20): the note is the one the move
 * made, or one this made before (noteAbout), else a new one titled after it that mentions it first.
 * From the right-click menu, Android's selection toolbar and the palette.
 */

export const useAddToEntry = create<{ passage: Selected | undefined; editor: Editor | undefined; open: (passage: Selected, editor: Editor) => void; close: () => void }>((set) => ({
  passage: undefined,
  editor: undefined,
  open: (passage, editor) => set({ passage, editor }),
  // The editor stays, for the focus to go back to as the dialog closes.
  close: () => set({ passage: undefined }),
}));

const GROUP = "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted";

export function AddToEntryDialog({ novelId, novel, workspace }: { novelId: string; novel: Book; workspace: Workspace }) {
  const { passage, editor, close } = useAddToEntry();
  const [entry, setEntry] = useState<Entity>();
  const w = vocabulary(novel.kind);
  const done = () => {
    setEntry(undefined);
    close();
  };
  return (
    <Dialog.Root open={!!passage} onOpenChange={(o) => !o && done()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/30" />
        <Dialog.Content
          // Back to the words, still selected.
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (editor && !editor.isDestroyed) editor.commands.focus(null, { scrollIntoView: false });
          }}
          // Not closed by the focus going elsewhere: on a phone, Android's selection toolbar gives the
          // text its focus back as it closes, just after the dialog opens. Escape or a tap outside does.
          onFocusOutside={(e) => e.preventDefault()}
          aria-describedby={undefined}
          className="fixed top-[12vh] left-1/2 z-[70] grid w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 gap-3 overflow-hidden rounded-lg border border-rule bg-raised p-4 text-ink shadow-2xl"
        >
          <Dialog.Title className="text-base font-semibold">{entry ? `Add to ${entry.name}` : `Add to ${w.entity.a}`}</Dialog.Title>
          {passage && (
            <blockquote className="line-clamp-3 border-l-2 border-accent/50 pl-3 font-prose text-[15px] leading-snug text-muted">
              {passage.quote}
            </blockquote>
          )}
          {passage && !entry && <Pick novel={novel} piece={passage.scene} onPick={setEntry} />}
          {passage && entry && <Into novelId={novelId} novel={novel} workspace={workspace} passage={passage} entity={entry} onBack={() => setEntry(undefined)} onDone={done} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Choosing the entry: those in this piece first, then all of them, found by name or other name. */
function Pick({ novel, piece, onPick }: { novel: Book; piece: string; onPick: (e: Entity) => void }) {
  const w = vocabulary(novel.kind);
  const here = entriesInPiece(novel, piece).flatMap((x) => novel.entities.filter((e) => e.id === x.id));
  const title = novel.allPieces.find((p) => p.id === piece)?.title ?? "";
  const item = (e: Entity, group: string) => (
    <Cmdk.Item
      key={`${group}:${e.id}`}
      value={`${group}:${e.id}`}
      keywords={[e.name, ...e.aliases]}
      onSelect={() => onPick(e)}
      className="group flex items-baseline gap-2 rounded-md px-3 py-1.5 text-sm data-[selected=true]:bg-accent-soft"
    >
      <span className="font-medium">{e.name}</span>
      <span className="text-xs text-muted group-data-[selected=true]:text-ink">{typeOf(novel, e)?.label}</span>
    </Cmdk.Item>
  );
  return (
    <Cmdk label={`Choose ${w.entity.a}`} loop className="-mx-4 -mb-4 border-t border-rule">
      <Cmdk.Input autoFocus placeholder={`Find ${w.entity.a}…`} className="h-11 w-full border-b border-rule bg-transparent px-4 text-sm outline-none placeholder:text-muted" />
      <Cmdk.List className="max-h-[min(50vh,22rem)] overflow-y-auto p-2" label={`${w.entity.Many}`}>
        <Cmdk.Empty className="px-3 py-6 text-center text-sm text-muted">No {w.entity.one} by that name</Cmdk.Empty>
        {here.length > 0 && (
          <Cmdk.Group heading={`In “${title}”`} className={GROUP}>
            {here.map((e) => item(e, "here"))}
          </Cmdk.Group>
        )}
        <Cmdk.Group heading={`All ${w.entity.many}`} className={GROUP}>
          {[...novel.entities].sort((a, b) => a.name.localeCompare(b.name)).map((e) => item(e, "all"))}
        </Cmdk.Group>
      </Cmdk.List>
    </Cmdk>
  );
}

/** Where in the entry: its notes, or a field (one of its own, or a new one). */
function Into({ novelId, novel, workspace, passage, entity, onBack, onDone }: { novelId: string; novel: Book; workspace: Workspace; passage: Selected; entity: Entity; onBack: () => void; onDone: () => void }) {
  const queryClient = useQueryClient();
  const show = useNotice((n) => n.show);
  const w = vocabulary(novel.kind);
  const [field, setField] = useState("");
  const [problem, setProblem] = useState<string>();
  const [saving, setSaving] = useState(false);
  const ids = { field: useId(), list: useId() };
  const fields = Object.keys(entity.fields);
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
  const path = entity.file;
  // A field holds one line.
  const value = passage.quote.replace(/\s+/g, " ").trim();

  const toNotes = async () => {
    const about = noteAbout(novel, entity.id);
    const said = `Added to your notes on ${entity.name}, from “${passage.sceneTitle}”.`;
    if (about) {
      await workspace.open([about.file]);
      const f = workspace.store.getState().files[about.file];
      const body = workspace.current(about.file);
      if (!f || body === undefined) return setProblem(`Couldn't open the note “${about.title}”.`);
      const was = joinSceneFile({ ...f, body });
      workspace.change(about.file, appendQuote(body, passage.quote, passage.sceneTitle));
      onDone();
      return show({ message: said, action: { label: "Undo", run: () => workspace.replace(about.file, was) } });
    }
    setSaving(true);
    try {
      const made = await api.notes.create(novelId, { title: entity.name, note: `${mentionOf(entity)}\n\n${appendQuote("", passage.quote, passage.sceneTitle)}` });
      await refresh();
      onDone();
      show({
        message: said,
        action: {
          label: "Undo",
          run: () =>
            void api.notes
              .delete(novelId, made.id)
              .then(refresh)
              .catch((e: unknown) => show({ message: `Couldn't undo it: ${e instanceof Error ? e.message : String(e)}` })),
        },
      });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const toField = async () => {
    const key = field.trim();
    if (!key) return setProblem("A field needs a name.");
    setSaving(true);
    try {
      await workspace.autosave.flush();
      const before = await api.readFile(novelId, path);
      await api.bible.updateEntity(novelId, entity.id, before.hash, { fields: { ...entity.fields, [key]: value } });
      await workspace.fileChanged({ type: "change", path, hash: null });
      await refresh();
      onDone();
      show({
        message: `Set ${entity.name}'s ${key.replace(/_/g, " ")} to “${value.length > 40 ? `${value.slice(0, 39)}…` : value}”.`,
        action: {
          label: "Undo",
          run: () =>
            void (async () => {
              const now = await api.readFile(novelId, path);
              const put = await api.writeFile(novelId, path, before.content, now.hash);
              if (!put.ok) return show({ message: `${entity.name} changed since, so it wasn't undone.` });
              await workspace.fileChanged({ type: "change", path, hash: null });
              await refresh();
            })(),
        },
      });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-3">
      <Button variant="primary" autoFocus onClick={() => void toNotes()} disabled={saving} className="justify-self-start">
        Add to your notes on {entity.name}
      </Button>
      <form
        className="grid gap-2 border-t border-rule pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void toField();
        }}
      >
        <label htmlFor={ids.field} className="text-xs font-medium">
          Or as a field: its name
        </label>
        <div className="flex gap-2">
          <input
            id={ids.field}
            list={ids.list}
            value={field}
            onChange={(e) => setField(e.target.value)}
            placeholder={fields[0] ?? "eyes"}
            className="h-8 min-w-0 flex-1 rounded-md border border-rule bg-paper px-2 text-sm"
          />
          <datalist id={ids.list}>
            {fields.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
          <Button type="submit" size="sm" disabled={saving}>
            Set the field
          </Button>
        </div>
        {problem && <p className="text-xs text-danger">{problem}</p>}
      </form>
      <button type="button" onClick={onBack} className="justify-self-start text-xs text-muted underline-offset-2 hover:underline">
        ← Another {w.entity.one}
      </button>
    </div>
  );
}
