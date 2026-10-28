import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, keys } from "../api.ts";
import { onAndroid } from "../platform.ts";
import { Confirm } from "../ui/confirm.tsx";

const DEVICE = onAndroid ? "phone" : "computer";
const many = (n: number, one: string, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;

/**
 * Delete the book in `path` (#98), on the shelf or a stray, once the writer has been told what isn't
 * on GitHub: everything, for a book that isn't there; else its changes and versions not synced.
 * The copy on GitHub is never touched.
 */
export function DeleteBook({ path, title, open, onOpenChange, onDone }: { path: string; title: string; open: boolean; onOpenChange: (open: boolean) => void; onDone: (said: string) => void }) {
  const queryClient = useQueryClient();
  const loss = useQuery({ queryKey: ["unsynced", path], queryFn: () => api.unsynced(path), enabled: open, staleTime: 0 });
  const remove = useMutation({
    mutationFn: () => api.deleteBook(path),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.library });
      onDone(`Deleted “${title}” from this ${DEVICE}.`);
    },
    onError: (e) => onDone(`Couldn't delete “${title}”: ${e instanceof Error ? e.message : String(e)}`),
  });
  const l = loss.data;
  const description = loss.isError
    ? `Couldn't tell what of it isn't on GitHub (${loss.error.message}). Deleting it may lose words that are only here.`
    : !l
      ? "Checking what of it isn't on GitHub…"
      : !l.onGitHub
        ? `“${title}” isn't on GitHub: deleting it deletes every word of it, and its history, for good.`
        : l.changes || l.versions
          ? `${[l.changes ? many(l.changes, "change") : "", l.versions ? many(l.versions, "version") : ""].filter(Boolean).join(" and ")} ${l.changes + l.versions === 1 ? "isn't" : "aren't"} on GitHub yet, and will be gone. Sync first to keep ${l.changes + l.versions === 1 ? "it" : "them"}. The copy on GitHub stays.`
          : `Its folder is deleted from this ${DEVICE}. The copy on GitHub stays, and can be cloned again.`;
  return (
    <Confirm
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete “${title}”?`}
      description={description}
      action="Delete the book"
      danger
      busy={!l && !loss.isError}
      onConfirm={() => remove.mutate()}
    />
  );
}
