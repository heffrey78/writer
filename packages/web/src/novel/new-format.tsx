import { MANIFEST, NOVEL_MANIFEST, pluralPossessive, SCHEMA_VERSION, vocabulary, type Book } from "@writer/core";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, keys } from "../api.ts";
import { Confirm } from "../ui/confirm.tsx";
import { useNotice } from "./notice.tsx";

/** What moving a book to format v3 means (D15), said where the writer is asked. */
export const NEW_FORMAT = `Writer keeps a book's settings in ${MANIFEST}, which says what kind of book it is. The novel moves there in one commit, with its GitHub tools; nothing else in it changes. gh-writer, and copies of Writer from before this one, won't open it afterwards.`;

/** What moving entries' notes into the book's notes means (D20), said where the writer is asked. */
export const entryNotesMove = (book: Book) => {
  const w = vocabulary(book.kind).entity;
  return `Writer keeps what you write about ${w.a} in your notes now. Each ${w.one}'s own notes become a note that mentions it, titled with its name and listed under In your notes on its page. Every word is kept, in one commit; nothing else changes.`;
};

/**
 * Moving a novel in format v1 or v2 to v3 (D15), when the writer asks: a palette command for a book
 * still in ${NOVEL_MANIFEST}, and the dialog that asks first. And moving entries' own notes into the
 * book's notes (D20), for a book with an entry that still has some. Show `dialog` somewhere on the page.
 */
export function useNewFormat(novelId: string, novel: Book | undefined) {
  const queryClient = useQueryClient();
  const show = useNotice((n) => n.show);
  const [asking, setAsking] = useState<"format" | "notes" | false>(false);
  const notesLeft = !!novel?.entities.some((e) => e.body.trim());
  const theirs = pluralPossessive(novel ? vocabulary(novel.kind).entity.many : "entries");
  const commands = [
    ...(novel?.manifest === NOVEL_MANIFEST ? [{ id: "novel.newFormat", title: "Move this book to the new format…", group: "Book", run: () => setAsking("format") }] : []),
    ...(notesLeft ? [{ id: "novel.entryNotes", title: `Move ${theirs} notes into your notes…`, group: "Book", run: () => setAsking("notes") }] : []),
  ];
  const moveNotes = async () => {
    try {
      await api.migrate(novelId, SCHEMA_VERSION, { entryNotes: true });
      await queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
      show({ message: `Moved: the ${theirs} notes are in your notes now, each in a note that mentions it.` });
    } catch (e) {
      show({ message: `Couldn't move the ${theirs} notes: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
  const move = async () => {
    try {
      await api.migrate(novelId, SCHEMA_VERSION);
      await queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
      show({ message: `Moved to the new format: the book's settings are in ${MANIFEST} now.` });
    } catch (e) {
      show({ message: `Couldn't move the book to the new format: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
  const dialog = (
    <>
      <Confirm open={asking === "format"} onOpenChange={(open) => setAsking(open && "format")} title="Move this book to the new format?" description={NEW_FORMAT} action="Move it" onConfirm={() => void move()} />
      {novel && (
        <Confirm
          open={asking === "notes"}
          onOpenChange={(open) => setAsking(open && "notes")}
          title={`Move ${theirs} notes into your notes?`}
          description={entryNotesMove(novel)}
          action="Move them"
          onConfirm={() => void moveNotes()}
        />
      )}
    </>
  );
  return { commands, dialog, askEntryNotes: () => setAsking("notes") };
}
