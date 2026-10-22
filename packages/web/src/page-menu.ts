import { create } from "zustand";

/** What the page in view adds to the ⋯ menu for a moment: a label and what it does. */
export interface PageMenuItem {
  id: string;
  label: string;
  run: () => void;
}

/**
 * Items the page in view puts first in the ⋯ menu, beside the page's own (layout.tsx): the writing
 * view's right sidebar, say, on a screen too narrow for its strip of buttons, where a touch has no
 * other way in.
 */
export const usePageMenu = create<{ items: PageMenuItem[]; set: (items: PageMenuItem[]) => void }>((set) => ({
  items: [],
  set: (items) => set({ items }),
}));
