import { create } from "zustand";

/** What the page in view adds to the ⋯ menu for a moment: a label and what it does. */
export interface PageMenuItem {
  id: string;
  label: string;
  /** Its name on a phone's More sheet, under the heading the page gives (#100): "Details". */
  short?: string;
  run: () => void;
}

/**
 * Items the page in view puts first in the ⋯ menu, beside the page's own (layout.tsx): the writing
 * view's right sidebar, say, on a screen too narrow for its strip of buttons, where a touch has no
 * other way in.
 */
export const usePageMenu = create<{ items: PageMenuItem[]; heading?: string; set: (items: PageMenuItem[], heading?: string) => void }>((set) => ({
  items: [],
  set: (items, heading) => set({ items, heading }),
}));
