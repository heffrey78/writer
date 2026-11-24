/*
 * The text settings (#192, D21): the writing font and size, the interface font and size, kept on the
 * device with the theme. The fonts ship in the app (fonts/fonts.css); the first of each list is
 * today's, set by the stylesheets, so a device that chooses nothing looks as it always has.
 */

export interface Font {
  id: string;
  name: string;
  /** The font-family to use, ending in what stands in while the font loads, or where it can't. */
  family: string;
}

export const WRITING_FONTS: readonly Font[] = [
  { id: "book", name: "Book serif", family: '"Iowan Old Style", "Palatino Linotype", Palatino, "Source Serif 4", Georgia, serif' },
  { id: "literata", name: "Literata", family: '"Literata", Georgia, serif' },
  { id: "garamond", name: "EB Garamond", family: '"EB Garamond", Georgia, serif' },
  { id: "atkinson", name: "Atkinson Hyperlegible", family: '"Atkinson Hyperlegible", system-ui, sans-serif' },
  { id: "plex", name: "IBM Plex Mono", family: '"IBM Plex Mono", ui-monospace, monospace' },
];

export const UI_FONTS: readonly Font[] = [
  { id: "system", name: "The system's", family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { id: "inter", name: "Inter", family: '"Inter", system-ui, sans-serif' },
  { id: "atkinson", name: "Atkinson Hyperlegible", family: '"Atkinson Hyperlegible", system-ui, sans-serif' },
];

/** The writing size, in CSS pixels: Medium is today's 1.1875rem. */
export const WRITING_SIZES: readonly { px: number; name: string }[] = [
  { px: 17, name: "Small" },
  { px: 19, name: "Medium" },
  { px: 21, name: "Large" },
  { px: 24, name: "Larger" },
];

/** The interface size, as the root font size: everything sized in rem follows. Not on a phone, which has Android's own. */
export const UI_SIZES: readonly { percent: number; name: string }[] = [
  { percent: 100, name: "Standard" },
  { percent: 112, name: "Larger" },
  { percent: 125, name: "Largest" },
];

/** What the device chose; what's absent is today's. */
export interface TextSettings {
  font?: string;
  size?: number;
  ui?: string;
  uiSize?: number;
}

/** A record's text settings, keeping only what this app knows. */
export function textOf(value: unknown): TextSettings | undefined {
  if (!value || typeof value !== "object") return undefined;
  const t = value as Record<string, unknown>;
  const out: TextSettings = {
    ...(WRITING_FONTS.some((f) => f.id === t.font) ? { font: t.font as string } : {}),
    ...(WRITING_SIZES.some((s) => s.px === t.size) ? { size: t.size as number } : {}),
    ...(UI_FONTS.some((f) => f.id === t.ui) ? { ui: t.ui as string } : {}),
    ...(UI_SIZES.some((s) => s.percent === t.uiSize) ? { uiSize: t.uiSize as number } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/**
 * The custom properties and root font size that make the settings so, for <html>'s style; each
 * undefined where it's today's, so the stylesheets' own holds. The writing size is in pixels once
 * either size is chosen, so the interface's size doesn't also change the writing's.
 */
export function textStyle(text: TextSettings | undefined, phone: boolean): Record<"--ghw-prose-font" | "--ghw-prose-size" | "--ghw-ui-font" | "font-size", string | undefined> {
  const t = text ?? {};
  const uiSize = phone ? undefined : t.uiSize;
  const font = t.font && t.font !== "book" ? WRITING_FONTS.find((f) => f.id === t.font)?.family : undefined;
  const ui = t.ui && t.ui !== "system" ? UI_FONTS.find((f) => f.id === t.ui)?.family : undefined;
  const sized = (t.size && t.size !== 19) || (uiSize && uiSize !== 100);
  return {
    "--ghw-prose-font": font,
    "--ghw-prose-size": sized ? `${t.size ?? 19}px` : undefined,
    "--ghw-ui-font": ui,
    "font-size": uiSize && uiSize !== 100 ? `${uiSize}%` : undefined,
  };
}
