/*
 * The themes (D21, #185): colors only, chosen per device. Paper is today's look and stays the
 * stylesheets' own (packages/editor/src/styles.css and ./styles.css); the others are data here, each a
 * few colors per mode from which every --ghw-* token is made by the rules below, which a writer's own
 * colors (#186) go through too. A color too faint to read is replaced by its nearest readable shade.
 */

export type Mode = "light" | "dark";

/** Every color token the app and the editor paint with. */
export const TOKENS = [
  "ink",
  "muted",
  "accent",
  "accent-soft",
  "raw-bg",
  "selection",
  "rule",
  "paper",
  "panel",
  "raised",
  "danger",
  "danger-soft",
  "ok",
  "warn",
  "warn-soft",
  "shelf",
  "shelf-edge",
  "series-1",
  "series-2",
  "series-3",
  "series-4",
  "series-5",
  "series-6",
  "series-7",
  "series-8",
] as const;
export type Token = (typeof TOKENS)[number];
export type Tokens = Record<Token, string>;

/** What a theme names for a mode: paper, text and links, and optionally the quieter colors made from them. */
export interface Colors {
  paper: string;
  ink: string;
  accent: string;
  muted?: string;
  panel?: string;
  rule?: string;
}

export type PaletteId = "paper" | "study" | "slate" | "moss" | "contrast";

export interface Theme {
  id: PaletteId;
  name: string;
  /** What it looks like, in a few words. */
  line: string;
  /** The contrast every text color keeps on every surface: 4.5 (WCAG AA), or 7 (AAA) for Contrast. */
  minimum: number;
  light: Colors;
  dark: Colors;
}

/** Paper's tokens, as the stylesheets set them (a test holds the two together). */
export const PAPER: Record<Mode, Tokens> = {
  light: {
    ink: "#1f1d1a",
    muted: "#5f5a52",
    accent: "#2c5d8f",
    "accent-soft": "rgb(44 93 143 / 0.1)",
    "raw-bg": "rgb(31 29 26 / 0.05)",
    selection: "rgb(44 93 143 / 0.22)",
    rule: "#ddd6ca",
    paper: "#faf8f4",
    panel: "#f1ede5",
    raised: "#ffffff",
    danger: "#a3271d",
    "danger-soft": "rgb(163 39 29 / 0.09)",
    ok: "#2f6b3a",
    warn: "#8a5300",
    "warn-soft": "rgb(138 83 0 / 0.1)",
    shelf: "#dccfb8",
    "shelf-edge": "#c2b294",
    "series-1": "#2a78d6",
    "series-2": "#eb6834",
    "series-3": "#1baf7a",
    "series-4": "#eda100",
    "series-5": "#e87ba4",
    "series-6": "#008300",
    "series-7": "#6250d6",
    "series-8": "#e34948",
  },
  dark: {
    ink: "#e8e4dc",
    muted: "#a9a399",
    accent: "#8cb8e6",
    "accent-soft": "rgb(140 184 230 / 0.14)",
    "raw-bg": "rgb(232 228 220 / 0.07)",
    selection: "rgb(140 184 230 / 0.3)",
    rule: "#3a3732",
    paper: "#1b1a18",
    panel: "#24221f",
    raised: "#2b2925",
    danger: "#f2978e",
    "danger-soft": "rgb(242 151 142 / 0.12)",
    ok: "#8fd19e",
    warn: "#f0bf6c",
    "warn-soft": "rgb(240 191 108 / 0.12)",
    shelf: "#3a342c",
    "shelf-edge": "#4a4238",
    "series-1": "#3987e5",
    "series-2": "#d95926",
    "series-3": "#199e70",
    "series-4": "#c98500",
    "series-5": "#d55181",
    "series-6": "#008300",
    "series-7": "#9085e9",
    "series-8": "#e66767",
  },
};

/** The five themes, as the mock-ups agreed them (#185). */
export const THEMES: readonly Theme[] = [
  {
    id: "paper",
    name: "Paper",
    line: "Today's look, and the default",
    minimum: 4.5,
    light: { paper: "#faf8f4", ink: "#1f1d1a", accent: "#2c5d8f", muted: "#5f5a52", panel: "#f1ede5", rule: "#ddd6ca" },
    dark: { paper: "#1b1a18", ink: "#e8e4dc", accent: "#8cb8e6", muted: "#a9a399", panel: "#24221f", rule: "#3a3732" },
  },
  {
    id: "study",
    name: "Study",
    line: "Sepia and rust",
    minimum: 4.5,
    // Quiet text a shade darker than the mock-up's #6b5a45, which read at 4.3 on a selected row.
    light: { paper: "#f3ead7", ink: "#33281c", accent: "#8f3a14", muted: "#685743", panel: "#e9dec5", rule: "#d6c7a8" },
    dark: { paper: "#201a13", ink: "#ecdfc8", accent: "#e6a273", muted: "#b3a58d", panel: "#2a231a", rule: "#3d3326" },
  },
  {
    id: "slate",
    name: "Slate",
    line: "Cool grey and blue",
    minimum: 4.5,
    light: { paper: "#f7f8fa", ink: "#1b2130", accent: "#3451c6", muted: "#545d6e", panel: "#eceff4", rule: "#d5dae3" },
    dark: { paper: "#13161c", ink: "#dde2ea", accent: "#9fb3f7", muted: "#9aa3b2", panel: "#1b1f27", rule: "#2c323d" },
  },
  {
    id: "moss",
    name: "Moss",
    line: "Grey-green and leaf-green",
    minimum: 4.5,
    light: { paper: "#f4f5ee", ink: "#1e271c", accent: "#3a6a2c", muted: "#56604f", panel: "#e8eadf", rule: "#d3d7c6" },
    dark: { paper: "#151912", ink: "#dfe5d6", accent: "#a5d18e", muted: "#9ea896", panel: "#1d2219", rule: "#2f362a" },
  },
  {
    id: "contrast",
    name: "Contrast",
    line: "Strongest contrast, for low vision",
    minimum: 7,
    light: { paper: "#ffffff", ink: "#000000", accent: "#0033b3", muted: "#333333", panel: "#f0f0f0", rule: "#767676" },
    dark: { paper: "#000000", ink: "#ffffff", accent: "#ffd23f", muted: "#d0d0d0", panel: "#141414", rule: "#8a8a8a" },
  },
];

export const themeById = (id: string): Theme | undefined => THEMES.find((t) => t.id === id);

// Colors as numbers: "#rrggbb" ⇄ [r, g, b].

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const hex = (c: readonly number[]) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;

/** `a` moved `w` of the way to `b` (0 is `a`, 1 is `b`). */
export function mix(a: string, b: string, w: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return hex(x.map((v, i) => v + (y[i]! - v) * w));
}

/** `color` at `alpha`, as CSS writes it. */
const alpha = (color: string, a: number) => `rgb(${rgb(color).join(" ")} / ${a})`;

/** WCAG's relative luminance. */
export function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG's contrast ratio of two colors, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Whether a paper is dark: text on it is light. */
export const isDark = (paper: string) => luminance(paper) < 0.2;

/**
 * The nearest shade of `color` that reads at `minimum` on every one of `surfaces`: the color itself
 * if it does, else moved a step at a time toward black on light paper, toward white on dark.
 */
export function readable(color: string, surfaces: readonly string[], minimum: number): string {
  const worst = (c: string) => Math.min(...surfaces.map((s) => contrast(c, s)));
  // A mid-tone paper may read better the other way; failing both, the end that reads best.
  const ends = isDark(surfaces[0]!) ? ["#ffffff", "#000000"] : ["#000000", "#ffffff"];
  for (const to of ends) {
    for (let step = 0; step <= 100; step++) {
      const shade = mix(color, to, step / 100);
      if (worst(shade) >= minimum) return shade;
    }
  }
  return worst(ends[0]!) >= worst(ends[1]!) ? ends[0]! : ends[1]!;
}

/** `color` at `a` over `surface`, as the eye sees it. */
const over = (color: string, a: number, surface: string) => mix(surface, color, a);

/**
 * Every token from a theme's few colors. Text, links and quiet text keep `minimum` on paper, panel
 * and raised; the status colors are Paper's, moved to their nearest readable shade; the chart series
 * stay Paper's, which were checked for color blindness on light and dark surfaces. Whether the
 * result is light or dark goes by the paper, whichever mode it's for.
 */
export function derive(colors: Colors, minimum = 4.5): Tokens {
  const { paper } = colors;
  const dark = isDark(paper);
  const mode: Mode = dark ? "dark" : "light";
  const panel = colors.panel ?? mix(paper, colors.ink, 0.05);
  const raised = dark ? mix(paper, colors.ink, 0.08) : mix(paper, "#ffffff", 0.75);
  const surfaces = [paper, panel, raised];
  const ink = readable(colors.ink, surfaces, minimum);
  const accent = readable(colors.accent, surfaces, minimum);
  // Quiet text sits on a selected row's tint too (a chapter's word count in the outline).
  const selected = [paper, panel].map((s) => over(accent, dark ? 0.14 : 0.1, s));
  const muted = readable(colors.muted ?? mix(ink, paper, 0.4), [...surfaces, ...selected], minimum);
  const base = PAPER[mode];
  // A status color's text sits on its own soft tint too (a warning's box, a failed field).
  const soft = { danger: dark ? 0.12 : 0.09, warn: dark ? 0.12 : 0.1 };
  // The tint is made from the shade chosen, so check again until the shade reads on its own tint.
  const status = (color: string, tint?: number) => {
    let shade = readable(color, surfaces, minimum);
    for (let i = 0; tint && i < 10; i++) {
      const next = readable(shade, [...surfaces, ...surfaces.map((s) => over(shade, tint, s))], minimum);
      if (next === shade) break;
      shade = next;
    }
    return shade;
  };
  const danger = status(base.danger, soft.danger);
  const warn = status(base.warn, soft.warn);
  const ground = dark ? paper : panel;
  return {
    ink,
    muted,
    accent,
    "accent-soft": alpha(accent, dark ? 0.14 : 0.1),
    "raw-bg": alpha(ink, dark ? 0.07 : 0.05),
    selection: alpha(accent, dark ? 0.3 : 0.22),
    rule: colors.rule ?? mix(paper, ink, 0.15),
    paper,
    panel,
    raised,
    danger,
    "danger-soft": alpha(danger, soft.danger),
    ok: status(base.ok),
    warn,
    "warn-soft": alpha(warn, soft.warn),
    shelf: mix(ground, ink, 0.12),
    "shelf-edge": mix(ground, ink, dark ? 0.2 : 0.24),
    "series-1": base["series-1"],
    "series-2": base["series-2"],
    "series-3": base["series-3"],
    "series-4": base["series-4"],
    "series-5": base["series-5"],
    "series-6": base["series-6"],
    "series-7": base["series-7"],
    "series-8": base["series-8"],
  };
}

/** A theme's tokens in a mode: Paper's as the stylesheets set them, the others made by derive(). */
export const tokensOf = (theme: Theme, mode: Mode): Tokens => (theme.id === "paper" ? PAPER[mode] : derive(theme[mode], theme.minimum));

const block = (selector: string, tokens: Tokens) =>
  `${selector} {\n${TOKENS.map((t) => `  --ghw-${t}: ${tokens[t]};\n`).join("")}  color-scheme: ${isDark(tokens.paper) ? "dark" : "light"};\n}\n`;

/**
 * The rules that paint a theme when <html data-palette> names it, in the stylesheets' three places:
 * light; dark when the system is and the writer hasn't chosen light; dark when the writer has chosen
 * it. `html:root` outweighs the stylesheets' `:root` rules whatever their order.
 */
export function themeCss(theme: Theme): string {
  const at = `html:root[data-palette="${theme.id}"]`;
  const dark = tokensOf(theme, "dark");
  return [
    block(at, tokensOf(theme, "light")),
    `@media (prefers-color-scheme: dark) {\n${block(`${at}:not([data-theme="light"])`, dark)}}\n`,
    block(`${at}[data-theme="dark"]`, dark),
  ].join("");
}

/** Every theme's rules but Paper's, which the stylesheets hold. */
export const themesCss = () => THEMES.filter((t) => t.id !== "paper").map(themeCss).join("");
