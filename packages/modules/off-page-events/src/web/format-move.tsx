import { EVENT_FILES_FORMAT, NOVEL_MANIFEST, type Book } from "@writer/core";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, keys } from "@writer/web/api.ts";
import { useNotice } from "@writer/web/novel/notice.tsx";
import { Confirm } from "@writer/web/ui/confirm.tsx";

/** What moving a novel to format v2 means, said where the writer is asked (D11). */
export const FORMAT_MOVE = "Writer now keeps each off-page event in a file of its own. The novel moves to the new format in one commit: every event, and its GitHub tools. Copies of Writer from before this one won't open it afterwards.";

/** Whether a novel is in a format older than events as files (v2): an event change moves it first, that far. */
export const needsFormatMove = (novel: Book) => novel.manifest === NOVEL_MANIFEST && (novel.config?.schema_version ?? 1) < EVENT_FILES_FORMAT;

/**
 * Moving a novel in format v1 to v2 before an event is changed (D11). `ensure(then)` runs `then` at once
 * in a novel already moved; otherwise it asks, once, and runs it after the move. Cancelling changes nothing.
 * Show `dialog` somewhere on the page.
 */
export function useFormatMove(novelId: string, novel: Book) {
  const queryClient = useQueryClient();
  const show = useNotice((n) => n.show);
  const [waiting, setWaiting] = useState<(() => void) | null>(null);
  const move = async (then: () => void) => {
    try {
      await api.migrate(novelId, EVENT_FILES_FORMAT);
      await queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
      then();
    } catch (e) {
      show({ message: `Couldn't move the novel to the new format: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
  const ensure = (then: () => void) => (needsFormatMove(novel) ? setWaiting(() => then) : then());
  const dialog = (
    <Confirm
      open={waiting !== null}
      onOpenChange={(o) => !o && setWaiting(null)}
      title="Move this novel to the new format?"
      description={FORMAT_MOVE}
      action="Move it"
      onConfirm={() => waiting && void move(waiting)}
    />
  );
  return { ensure, dialog };
}
