import { MANIFEST, NOVEL_MANIFEST, SCHEMA_VERSION, type Book } from "@writer/core";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, keys } from "../api.ts";
import { Confirm } from "../ui/confirm.tsx";
import { useNotice } from "./notice.tsx";

/** What moving a book to format v3 means (D15), said where the writer is asked. */
export const NEW_FORMAT = `Writer keeps a book's settings in ${MANIFEST}, which says what kind of book it is. The novel moves there in one commit, with its GitHub tools; nothing else in it changes. gh-writer, and copies of Writer from before this one, won't open it afterwards.`;

/**
 * Moving a novel in format v1 or v2 to v3 (D15), when the writer asks: a palette command for a book
 * still in ${NOVEL_MANIFEST}, and the dialog that asks first. Show `dialog` somewhere on the page.
 */
export function useNewFormat(novelId: string, novel: Book | undefined) {
  const queryClient = useQueryClient();
  const show = useNotice((n) => n.show);
  const [asking, setAsking] = useState(false);
  const commands = novel?.manifest === NOVEL_MANIFEST ? [{ id: "novel.newFormat", title: "Move this book to the new format…", group: "Book", run: () => setAsking(true) }] : [];
  const move = async () => {
    try {
      await api.migrate(novelId, SCHEMA_VERSION);
      await queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
      show({ message: `Moved to the new format: the book's settings are in ${MANIFEST} now.` });
    } catch (e) {
      show({ message: `Couldn't move the book to the new format: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
  const dialog = <Confirm open={asking} onOpenChange={setAsking} title="Move this book to the new format?" description={NEW_FORMAT} action="Move it" onConfirm={() => void move()} />;
  return { commands, dialog };
}
