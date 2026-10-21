import type { StorageLike } from "@writer/client";

/**
 * Unsaved text, kept by the engine's host when the engine runs in the page (#54). There, the page
 * closing is the app stopping, Android killing it included, so the text autosave hasn't saved yet
 * must outlive the page. The browser's own storage doesn't promise that: Chromium writes it to disk
 * some seconds later, and a killed app loses the rest. Kept here in memory for autosave's synchronous
 * reads, each change handed to the host, which writes it to disk at once, and in the tab's session
 * too, for when the host is the one that went (the tests' Node bridge, killed).
 */
let kept: StorageLike | undefined;

/** The store, once the engine has started with one. */
export const keptText = (): StorageLike | undefined => kept;

/** autosave's keys (@writer/client): only its entries are kept. */
const AUTOSAVE = "ghw:autosave:";

/**
 * Start the store with what the host kept last time, and then what this tab kept (newer, where it has
 * any); `save` writes all of it to the host, one save after another.
 */
export function keepTextWith(initial: Record<string, string>, save: (all: Record<string, string>) => Promise<void>): void {
  const items = new Map(Object.entries(initial));
  const tab = session();
  for (let i = 0; i < (tab?.length ?? 0); i++) {
    const k = tab!.key(i);
    const v = k?.startsWith(AUTOSAVE) ? tab!.getItem(k) : null;
    if (k && v !== null) items.set(k, v);
  }
  let saving = Promise.resolve();
  const persist = () => {
    const all = Object.fromEntries(items);
    saving = saving.then(() => save(all)).catch(() => {});
  };
  kept = {
    get length() {
      return items.size;
    },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => {
      items.set(k, v);
      tried(() => tab?.setItem(k, v));
      persist();
    },
    removeItem: (k) => {
      tried(() => tab?.removeItem(k));
      if (items.delete(k)) persist();
    },
  };
}

function session(): Storage | undefined {
  try {
    return sessionStorage;
  } catch {
    return undefined; // blocked by the browser's privacy settings
  }
}

function tried(write: () => void): void {
  try {
    write();
  } catch {
    // Full or blocked: the host's copy and the one in memory still hold the text.
  }
}
