import { create } from "zustand";

/*
 * The entries last opened in a book (#134), newest first: the sidebar lists them under the index, so
 * the few being worked with are a click away. Kept on this device, per book.
 */

const MAX = 5;
const key = (novelId: string) => `ghw:recent-entries:${novelId}`;

function read(novelId: string): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(key(novelId)) ?? "[]") as unknown;
    return Array.isArray(saved) ? saved.filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

const useRecent = create<Record<string, string[]>>(() => ({}));

/** The book's recent entries' IDs, newest first. */
export function useRecentEntries(novelId: string): string[] {
  return useRecent((s) => s[novelId]) ?? read(novelId);
}

/** Note an entry (or a module's record) as just opened. */
export function opened(novelId: string, id: string): void {
  const before = useRecent.getState()[novelId] ?? read(novelId);
  if (before[0] === id) return;
  const next = [id, ...before.filter((x) => x !== id)].slice(0, MAX);
  useRecent.setState({ [novelId]: next });
  try {
    localStorage.setItem(key(novelId), JSON.stringify(next));
  } catch {
    // Not kept for next time; still listed now.
  }
}
