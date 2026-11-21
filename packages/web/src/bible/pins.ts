import { create } from "zustand";

/*
 * Entries pinned beside the text (#156): kept first in the In this scene tab in every piece until
 * unpinned, as the antagonist through a confrontation chapter. Kept on this device, per book, as the
 * sidebar's own state is.
 */

const key = (novelId: string) => `ghw:pinned-entries:${novelId}`;

function read(novelId: string): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(key(novelId)) ?? "[]") as unknown;
    return Array.isArray(saved) ? saved.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const usePins = create<Record<string, string[]>>(() => ({}));

/** The book's pinned entries' IDs, in the order they were pinned. */
export function usePinnedEntries(novelId: string): string[] {
  return usePins((s) => s[novelId]) ?? read(novelId);
}

/** Pin an entry (or a module's record), or unpin it. */
export function setPinned(novelId: string, id: string, pinned: boolean): void {
  const before = usePins.getState()[novelId] ?? read(novelId);
  if (before.includes(id) === pinned) return;
  const next = pinned ? [...before, id] : before.filter((x) => x !== id);
  usePins.setState({ [novelId]: next });
  try {
    localStorage.setItem(key(novelId), JSON.stringify(next));
  } catch {
    // Not kept for next time; pinned for now.
  }
}
