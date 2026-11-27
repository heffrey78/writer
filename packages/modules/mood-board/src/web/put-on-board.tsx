import { useQueryClient } from "@tanstack/react-query";
import { imageUrl } from "@writer/client";
import { shownPictures, vocabulary, type Book } from "@writer/core";
import { keys } from "@writer/web/api.ts";
import { entityItems } from "@writer/web/bible/pickers.ts";
import type { PageSubject } from "@writer/web/modules.tsx";
import { useNotice } from "@writer/web/novel/notice.tsx";
import { ErrorAlert } from "@writer/web/ui/alert.tsx";
import { Button } from "@writer/web/ui/button.tsx";
import { Modal } from "@writer/web/ui/dialog.tsx";
import { Field } from "@writer/web/ui/field.tsx";
import { Picker } from "@writer/web/ui/picker.tsx";
import { useId, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { addCards, besideAll, boardsOf, ENTRY_SIZE, noteCards, PICTURE_SIZE, pictureSize, readBoardText, type Board, type BoardCard, type Pair } from "../core/index.ts";
import { boards, changeBoard } from "./client.ts";

/*
 * Putting things on a board (#208): a note as a card and which of its pictures become cards of their
 * own, tethered to it, or an entry. From a note's or an entry's page (Put on a board…), the board is
 * chosen, or made; from a board, the note or the entry is.
 */

/** A picture's card on a board, from the picture's own shape. */
export function measure(novelId: string, path: string): Promise<Pair> {
  const src = imageUrl(novelId, path);
  if (!src) return Promise.resolve(PICTURE_SIZE);
  return new Promise((done) => {
    const img = new Image();
    img.onload = () => done(pictureSize(img.naturalWidth, img.naturalHeight));
    img.onerror = () => done(PICTURE_SIZE);
    img.src = src;
  });
}

/** Cards added to a board's file, at `at` or else beside everything on it. Returns the file as written. */
export async function putCards(novelId: string, board: Board, cards: (at: Pair) => BoardCard[], at?: Pair): Promise<string> {
  const written = await changeBoard(novelId, board.file, (t) => addCards(t, cards(at ?? besideAll(readBoardText(t)?.cards ?? []))));
  return written;
}

const NEW = "";

export function PutOnBoard({
  novelId,
  book,
  subject,
  choose,
  board: fixed,
  at,
  onClose,
}: {
  novelId: string;
  book: Book;
  /** From a note's or an entry's page: what goes on the board, which is chosen. */
  subject?: PageSubject;
  /** From a board: what's chosen to put on it. */
  choose?: "note" | "entry";
  board?: Board;
  /** Where on the board the cards go; beside everything on it if not given. */
  at?: Pair;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const show = useNotice((s) => s.show);
  const id = useId();
  const words = vocabulary(book.kind);
  const all = boardsOf(book);
  const [boardId, setBoardId] = useState(fixed?.id ?? all[0]?.id ?? NEW);
  const [newTitle, setNewTitle] = useState("");
  const [noteId, setNoteId] = useState(subject && "note" in subject ? subject.note.id : undefined);
  const [entityId, setEntityId] = useState(subject && "entity" in subject ? subject.entity.id : undefined);
  const note = book.notes.find((n) => n.id === noteId);
  const entity = book.entities.find((e) => e.id === entityId);
  const pictures = useMemo(() => [...new Map((note ? shownPictures(note.body) : []).map((p) => [p.path, p])).values()], [note]);
  const [withNote, setWithNote] = useState(true);
  // The first picture is on the note's card already: the others are cards of their own unless unticked.
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(pictures.slice(1).map((p) => p.path)));
  const [noteFor, setNoteFor] = useState(noteId);
  if (noteFor !== noteId) {
    setNoteFor(noteId);
    setPicked(new Set(pictures.slice(1).map((p) => p.path)));
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const kind = subject ? ("note" in subject ? "note" : "entry") : choose!;
  const count = kind === "note" ? (note ? (withNote ? 1 : 0) + pictures.filter((p) => picked.has(p.path)).length : 0) : entity ? 1 : 0;
  const newBoard = !fixed && boardId === NEW;
  const ready = count > 0 && (!newBoard || !!newTitle.trim()) && !busy;
  const title = subject ? `Put “${"note" in subject ? subject.note.title : subject.entity.name}” on a board` : kind === "note" ? "Add a note" : `Add from the ${words.codex.one}`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      let board = fixed ?? all.find((b) => b.id === boardId);
      if (!board) {
        const made = await boards.create(novelId, newTitle.trim());
        board = { id: made.id, file: made.file, title: newTitle.trim(), cards: [] };
      }
      let cards: (at: Pair) => BoardCard[];
      if (kind === "note" && note) {
        const sized = await Promise.all(pictures.filter((p) => picked.has(p.path)).map(async (p) => ({ path: p.path, size: await measure(novelId, p.path) })));
        cards = (at) => noteCards(note.id, at, withNote, sized);
      } else cards = (at) => [{ kind: "entry", entry: entity!.id, at, size: ENTRY_SIZE }];
      await putCards(novelId, board, cards, at);
      await queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
      onClose();
      if (!fixed) {
        const to = board;
        show({ message: `${count === 1 ? "1 card" : `${count} cards`} put on “${to.title}”.`, action: { label: "Open the board", run: () => (show(undefined), navigate(`/novels/${novelId}/boards/${to.id}`)) } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose} className="w-[min(36rem,calc(100vw-2rem))]">
      <form className="grid gap-4 text-sm" onSubmit={(e) => void submit(e)}>
        {!fixed && (
          <div className="grid gap-2">
            <label className="flex items-center gap-3">
              <span className="font-medium">Board</span>
              <select value={boardId} onChange={(e) => setBoardId(e.target.value)} data-autofocus className="h-9 min-w-0 flex-1 rounded-md border border-rule-strong bg-paper px-2">
                {all.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
                <option value={NEW}>New board…</option>
              </select>
            </label>
            {newBoard && <Field label="The new board's title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="The Belfry" required />}
          </div>
        )}
        {choose === "note" && <Picker label="Note" items={book.notes.map((n) => ({ value: n.id, label: n.title }))} value={noteId} onChange={setNoteId} placeholder="Choose a note…" />}
        {choose === "entry" && <Picker label={words.entity.One} items={entityItems(book)} value={entityId} onChange={setEntityId} placeholder={`Choose ${words.entity.a}…`} />}
        {kind === "note" && note && (
          <>
            <label className="flex items-center gap-2.5">
              <input type="checkbox" checked={withNote} onChange={(e) => setWithNote(e.target.checked)} className="size-4" /> The note, as a card
            </label>
            {pictures.length > 0 && (
              <fieldset className="grid gap-2">
                <legend className="font-medium">Its pictures, each a card of its own</legend>
                <p id={`${id}-hint`} className="text-muted">
                  Tethered to the note's card, and placed and sized on their own.
                </p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2.5">
                  {pictures.map((p, i) => (
                    <label key={p.path} className="flex flex-col gap-1.5 rounded-lg border border-rule p-1.5 has-[:checked]:border-accent has-[:checked]:ring-1 has-[:checked]:ring-accent">
                      <img src={imageUrl(novelId, p.path)} alt="" className="h-24 w-full rounded object-cover" />
                      <span className="flex items-start gap-1.5">
                        <input
                          type="checkbox"
                          checked={picked.has(p.path)}
                          aria-describedby={`${id}-hint`}
                          onChange={(e) =>
                            setPicked((was) => {
                              const next = new Set(was);
                              if (e.target.checked) next.add(p.path);
                              else next.delete(p.path);
                              return next;
                            })
                          }
                          className="mt-0.5 size-4 shrink-0"
                        />
                        <span>
                          {p.alt || p.path.replace(/^images\//, "")}
                          {i === 0 && withNote && <span className="text-muted"> (on the note's card)</span>}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </>
        )}
        {error && <ErrorAlert title="Couldn't put it on the board" detail={error} />}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!ready}>
            {busy ? "Putting it on…" : count === 1 ? "Put 1 card on the board" : `Put ${count} cards on the board`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** The picture of this book a URL dropped on the board points at (one dragged out of a note), as a repository path; none for anything else. */
export function droppedPicture(novelId: string, url: string): string | undefined {
  let path: string;
  try {
    path = new URL(url, location.href).pathname;
  } catch {
    return undefined;
  }
  const prefix = `/api/novels/${encodeURIComponent(novelId)}/images/`;
  if (!path.startsWith(prefix)) return undefined;
  const picture = `images/${path.slice(prefix.length).split("/").map(decodeURIComponent).join("/")}`;
  return imageUrl(novelId, picture) ? picture : undefined;
}
