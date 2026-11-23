import type { Book, NotName, Passage } from "@writer/core";
import { useQueryClient } from "@tanstack/react-query";
import { api, keys } from "../api.ts";
import { useNotice } from "../novel/notice.tsx";

/*
 * "Not a name here" (D19, #171): a word in a piece that looks like an entry's name but isn't it there,
 * kept in the index's not-names.yaml so every device and the CLI stop offering it. The same from an
 * entry's Appears in, a piece's Not linked here and the underlined word in the text; the notice says
 * what was kept and offers Undo.
 */

/** What "Not a name here" keeps of a plain passage: undefined for a mention. */
export function judgementOf(passage: Passage, entry: string): NotName | undefined {
  return passage.notName && { entry, piece: passage.piece.id, ...passage.notName };
}

/** Keep a judgement, then read the book again; resolves once it's kept, throws to say why it couldn't be. */
export function useNotAName(novelId: string, novel: Book) {
  const queryClient = useQueryClient();
  const show = useNotice((n) => n.show);
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
  return async (judgement: NotName, words: string) => {
    const entry = novel.entities.find((e) => e.id === judgement.entry)?.name ?? judgement.entry;
    const piece = novel.allPieces.find((p) => p.id === judgement.piece)?.title ?? "";
    try {
      await api.bible.notAName(novelId, judgement);
      await refresh();
      show({
        message: `“${words}” in “${piece}” isn't ${entry}: it won't be offered for linking there again.`,
        action: {
          label: "Undo",
          run: () =>
            void api.bible.forgetNotAName(novelId, judgement).then(
              () => refresh(),
              (e: unknown) => show({ message: `It couldn't be undone: ${e instanceof Error ? e.message : String(e)}` }),
            ),
        },
      });
    } catch (e) {
      show({ message: `It couldn't be kept: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
}

/**
 * The editor's side: the judgements with each piece named by its file (as the editor knows its pieces),
 * and a new one from the text turned back to the piece's ID.
 */
export function editorNotNames(novel: Book, keep: (judgement: NotName, words: string) => void) {
  const fileOf = new Map(novel.allPieces.map((p) => [p.id, p.file]));
  return {
    judgements: novel.notNames.map((n) => ({ ...n, piece: fileOf.get(n.piece) ?? n.piece })),
    onNotName: (j: NotName) => {
      const piece = novel.allPieces.find((p) => p.file === j.piece);
      const entry = novel.entities.find((e) => e.id === j.entry);
      if (piece && entry) keep({ ...j, piece: piece.id }, entry.name);
    },
  };
}
