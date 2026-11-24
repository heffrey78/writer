import { create } from "zustand";
import { ownFrom, ownOf, ownTheme, themeById, themeCss, themesCss, type Mode, type Own, type PaletteChoice, type Role } from "./themes.ts";

export type ThemeChoice = "system" | "light" | "dark";

/**
 * How the app looks on this device (D21): one record, read before the page is drawn. `own` and
 * `text` are a writer's own colors (#191) and the writing font and size (#192); a record from a
 * newer app keeps what it holds that this one doesn't know.
 */
export interface Appearance {
  mode: ThemeChoice;
  palette: PaletteChoice;
  own?: Own;
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
    const own = ownOf(record.own);
    const { own: _, ...rest } = record;
    return {
      ...rest,
      mode: record.mode === "light" || record.mode === "dark" ? record.mode : "system",
      palette: (record.palette === "own" && own) || (record.palette && themeById(record.palette)) ? record.palette! : "paper",
      ...(own ? { own } : {}),
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
  /** A theme, or the writer's own colors: started from the theme on screen the first time. */
  setPalette: (p: PaletteChoice) => void;
  /** One of the writer's own colors, in light or dark; their own colors become the theme. */
  setOwn: (mode: Mode, role: Role, color: string) => void;
  /** Back to Paper, following the system, in the writing view's own font and size; a writer's own colors are kept for another time. */
  reset: () => void;
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
    setPalette: (palette) => {
      const now = get().appearance;
      const own = now.own ?? (palette === "own" ? ownFrom(themeById(now.palette) ?? themeById("paper")!) : undefined);
      change({ ...now, palette, ...(own ? { own } : {}) });
    },
    setOwn: (mode, role, color) => {
      const now = get().appearance;
      const own = now.own ?? ownFrom(themeById(now.palette) ?? themeById("paper")!);
      change({ ...now, palette: "own", own: { ...own, [mode]: { ...own[mode], [role]: color } } });
    },
    reset: () => {
      const { own } = get().appearance;
      change({ ...DEFAULT, ...(own ? { own } : {}) });
    },
  };
});

const STYLE_ID = "ghw-themes";
const OWN_STYLE_ID = "ghw-own-theme";

/** The choice on <html>: data-theme for light or dark, data-palette for any theme but Paper, and the themes' rules. */
export function apply(appearance: Appearance = useTheme.getState().appearance): void {
  const root = document.documentElement;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = themesCss();
    document.head.append(style);
  }
  // A writer's own colors, made into a theme's rules like the others.
  let own = document.getElementById(OWN_STYLE_ID);
  if (!own) {
    own = document.createElement("style");
    own.id = OWN_STYLE_ID;
    document.head.append(own);
  }
  own.textContent = appearance.own ? themeCss(ownTheme(appearance.own)) : "";
  if (appearance.mode === "system") delete root.dataset.theme;
  else root.dataset.theme = appearance.mode;
  if (appearance.palette === "paper") delete root.dataset.palette;
  else root.dataset.palette = appearance.palette;
}
