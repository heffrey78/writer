import { create } from "zustand";
import { themeById, themesCss, type Mode, type PaletteId } from "./themes.ts";

export type ThemeChoice = "system" | "light" | "dark";

/**
 * How the app looks on this device (D21): one record, read before the page is drawn. `own` and
 * `text` are a writer's own colors (#191) and the writing font and size (#192); a record from a
 * newer app keeps what it holds that this one doesn't know.
 */
export interface Appearance {
  mode: ThemeChoice;
  palette: PaletteId;
  own?: Record<Mode, { paper: string; ink: string; accent: string }>;
  text?: { font?: string; size?: number };
}

const KEY = "ghw:appearance";
/** Before themes, only light or dark was kept, under this key. */
const OLD_KEY = "ghw:theme";

const DEFAULT: Appearance = { mode: "system", palette: "paper" };

function stored(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) {
      const old = localStorage.getItem(OLD_KEY);
      return { ...DEFAULT, mode: old === "light" || old === "dark" ? old : "system" };
    }
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return DEFAULT;
    const record = value as Partial<Appearance>;
    return {
      ...record,
      mode: record.mode === "light" || record.mode === "dark" ? record.mode : "system",
      palette: record.palette && themeById(record.palette) ? record.palette : "paper",
    };
  } catch {
    return DEFAULT;
  }
}

function store(appearance: Appearance): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(appearance));
    localStorage.removeItem(OLD_KEY);
  } catch {
    // Storage blocked: the choice lasts this page.
  }
}

interface ThemeState {
  appearance: Appearance;
  /** Light or dark, or following the system. */
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
  setPalette: (p: PaletteId) => void;
}

/** Light or dark follows the OS unless the writer picks one, in the theme they pick; the choice is this device's own. */
export const useTheme = create<ThemeState>((set, get) => {
  const change = (next: Appearance) => {
    store(next);
    apply(next);
    set({ appearance: next, theme: next.mode });
  };
  const appearance = stored();
  return {
    appearance,
    theme: appearance.mode,
    setTheme: (mode) => change({ ...get().appearance, mode }),
    setPalette: (palette) => change({ ...get().appearance, palette }),
  };
});

const STYLE_ID = "ghw-themes";

/** The choice on <html>: data-theme for light or dark, data-palette for any theme but Paper, and the themes' rules. */
export function apply(appearance: Appearance = useTheme.getState().appearance): void {
  const root = document.documentElement;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = themesCss();
    document.head.append(style);
  }
  if (appearance.mode === "system") delete root.dataset.theme;
  else root.dataset.theme = appearance.mode;
  if (appearance.palette === "paper") delete root.dataset.palette;
  else root.dataset.palette = appearance.palette;
}
