import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { NOTE_COLORS as CORE_NOTE_COLORS } from "@writer/core";
import { contrast, derive, luminance, mix, NOTE_COLORS, ownFrom, ownOf, ownTheme, SWATCHES, PAPER, readable, THEMES, themeCss, themesCss, tokensOf, TOKENS, type Mode, type Tokens } from "../src/themes.ts";

const css = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const STYLESHEETS = css("../../editor/src/styles.css") + css("../src/styles.css");

/** The --ghw-* tokens a stylesheet sets for a mode: light on bare :root, dark in its data-theme="dark" rule. */
function stylesheetTokens(mode: Mode): Record<string, string> {
  const selector = mode === "light" ? /^:root \{$/ : /^:root\[data-theme="dark"\] \{$/;
  const out: Record<string, string> = {};
  let inside = false;
  for (const line of STYLESHEETS.split("\n")) {
    if (selector.test(line)) inside = true;
    else if (inside && line === "}") inside = false;
    else if (inside) {
      const m = /^\s*--ghw-([\w-]+): (.+);$/.exec(line);
      if (m && (TOKENS as readonly string[]).includes(m[1]!)) out[m[1]!] = m[2]!;
    }
  }
  return out;
}

/** "#rrggbb" or "rgb(r g b / a)" over `under`, as a solid "#rrggbb". */
function solid(color: string, under: string): string {
  const m = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(color);
  if (!m) return color;
  const [r, g, b, a] = m.slice(1).map(Number) as [number, number, number, number];
  const base = [1, 3, 5].map((i) => parseInt(under.slice(i, i + 2), 16));
  return `#${[r, g, b].map((v, i) => Math.round(base[i]! + (v - base[i]!) * a).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * What text sits on what: every text color on paper, panel and raised; text and links on a selected
 * row's tint, and quiet text on it in a list or the outline (on paper or panel); a warning or an error
 * on its own tint.
 */
function pairs(t: Tokens): [role: keyof Tokens, surface: string][] {
  const grounds = [t.paper, t.panel, t.raised];
  const on = (tint: string) => grounds.map((g) => solid(tint, g));
  return [
    ...(["ink", "muted", "accent", "danger", "ok", "warn"] as const).flatMap((role) => grounds.map((g) => [role, g] as [keyof Tokens, string])),
    ...(["ink", "accent"] as const).flatMap((role) => on(t["accent-soft"]).map((s) => [role, s] as [keyof Tokens, string])),
    ...on(t["accent-soft"]).slice(0, 2).map((s) => ["muted", s] as [keyof Tokens, string]),
    ...on(t["danger-soft"]).map((s) => ["danger", s] as [keyof Tokens, string]),
    ...on(t["warn-soft"]).map((s) => ["warn", s] as [keyof Tokens, string]),
  ];
}

describe("themes (#189)", () => {
  it("keeps Paper as the stylesheets have it, byte for byte, in light and dark", () => {
    for (const mode of ["light", "dark"] as const) expect(stylesheetTokens(mode)).toEqual(PAPER[mode]);
  });

  it("sets every token in every theme, light and dark", () => {
    for (const theme of THEMES) {
      for (const mode of ["light", "dark"] as const) {
        const tokens = tokensOf(theme, mode);
        expect(Object.keys(tokens).sort(), `${theme.name} ${mode}`).toEqual([...TOKENS].sort());
        for (const value of Object.values(tokens)) expect(value).toMatch(/^#[0-9a-f]{6}$|^rgb\(\d+ \d+ \d+ \/ [\d.]+\)$/);
      }
    }
  });

  it("keeps every theme's own paper, text, links and quiet text: none needs a shade to read", () => {
    for (const theme of THEMES) {
      for (const mode of ["light", "dark"] as const) {
        const tokens = tokensOf(theme, mode);
        expect([tokens.paper, tokens.ink, tokens.accent, tokens.muted], `${theme.name} ${mode}`).toEqual([theme[mode].paper, theme[mode].ink, theme[mode].accent, theme[mode].muted]);
      }
    }
  });

  it("reads in every theme: text, quiet text, links and the status colors on every surface, at the theme's minimum", () => {
    const failures: string[] = [];
    for (const theme of THEMES) {
      for (const mode of ["light", "dark"] as const) {
        const t = tokensOf(theme, mode);
        for (const [role, surface] of pairs(t)) {
          const ratio = contrast(t[role], surface);
          if (ratio < theme.minimum) failures.push(`${theme.name} ${mode}: ${role} ${t[role]} on ${surface} is ${ratio.toFixed(2)}`);
        }
        // The paper's color on a link's color: a button's label.
        if (contrast(t.paper, t.accent) < theme.minimum) failures.push(`${theme.name} ${mode}: paper on accent`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("makes readable tokens from any paper not mid-tone, and any text and links, changing a color only when it doesn't read", () => {
    const color = fc.tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 })).map((c) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`);
    // On a mid-tone paper neither black nor white reads at 4.5 everywhere text sits (the picker says so, #191).
    const paper = color.filter((p) => luminance(p) < 0.05 || luminance(p) > 0.3);
    fc.assert(
      fc.property(paper, color, color, (paper, ink, accent) => {
        const t = derive({ paper, ink, accent });
        for (const [role, surface] of pairs(t)) expect(contrast(t[role], surface), `${role} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        // Where the text color reads on everything text sits on, it's kept as it is.
        if (pairs(t).every(([role, surface]) => role !== "ink" || contrast(ink, surface) >= 4.5)) expect(t.ink).toBe(ink);
      }),
      { numRuns: 300 },
    );
  });

  /** A mention's ground in a note of color `c`: the link color's soft tint over the note's color. */
  const mention = (t: Tokens, c: (typeof NOTE_COLORS)[number]) => mix(t[`note-${c}`], t.accent, Number(/\/ ([\d.]+)\)$/.exec(t["accent-soft"])![1]));

  it("draws every note color (D24) in every theme, light and dark, with text, quiet text, links and mentions reading on it", () => {
    const failures: string[] = [];
    for (const theme of THEMES) {
      for (const mode of ["light", "dark"] as const) {
        const t = tokensOf(theme, mode);
        const shades = NOTE_COLORS.map((c) => t[`note-${c}`]);
        // Eight colors a writer can tell apart: no two alike, none the paper itself.
        expect(new Set([...shades, t.paper]).size, `${theme.name} ${mode}`).toBe(NOTE_COLORS.length + 1);
        for (const c of NOTE_COLORS) {
          for (const role of ["ink", "muted", "accent"] as const) {
            const ratio = contrast(t[role], t[`note-${c}`]);
            if (ratio < theme.minimum) failures.push(`${theme.name} ${mode}: ${role} on ${c} ${t[`note-${c}`]} is ${ratio.toFixed(2)}`);
          }
          const ratio = contrast(t.accent, mention(t, c));
          if (ratio < theme.minimum) failures.push(`${theme.name} ${mode}: a mention on ${c} ${t[`note-${c}`]} is ${ratio.toFixed(2)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("makes note colors that read from any of a writer's own colors", () => {
    const color = fc.tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 })).map((c) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`);
    const paper = color.filter((p) => luminance(p) < 0.05 || luminance(p) > 0.3);
    fc.assert(
      fc.property(paper, color, color, (paper, ink, accent) => {
        const t = derive({ paper, ink, accent });
        for (const c of NOTE_COLORS) {
          for (const role of ["ink", "muted", "accent"] as const) expect(contrast(t[role], t[`note-${c}`]), `${role} on ${c}`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(t.accent, mention(t, c)), `a mention on ${c}`).toBeGreaterThanOrEqual(4.5);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("names the same note colors as the book format", () => {
    expect([...NOTE_COLORS]).toEqual([...CORE_NOTE_COLORS]);
  });

  it("finds the nearest readable shade: toward black on light paper, toward white on dark", () => {
    expect(readable("#2c5d8f", ["#faf8f4"], 4.5)).toBe("#2c5d8f");
    const dimmed = readable("#e0b84a", ["#faf8f4"], 4.5);
    expect(contrast(dimmed, "#faf8f4")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(readable("#3451c6", ["#002b36"], 4.5), "#002b36")).toBeGreaterThanOrEqual(4.5);
  });

  it("paints a theme only when <html> names it, light and dark as the stylesheets do, and never Paper", () => {
    const study = themeCss(THEMES.find((t) => t.id === "study")!);
    expect(study).toContain('html:root[data-palette="study"] {\n  --ghw-ink: #33281c;');
    expect(study).toContain('@media (prefers-color-scheme: dark) {\nhtml:root[data-palette="study"]:not([data-theme="light"]) {\n  --ghw-ink: #ecdfc8;');
    expect(study).toContain('html:root[data-palette="study"][data-theme="dark"] {\n  --ghw-ink: #ecdfc8;');
    expect(themesCss()).not.toContain("paper\"]");
    expect(themesCss().match(/  color-scheme: dark;/g)).toHaveLength(8);
  });

  it("reads a writer's own colors from the record only when they're whole: three colors each for light and dark", () => {
    const own = ownFrom(THEMES.find((t) => t.id === "study")!);
    expect(own).toEqual({ from: "study", light: { paper: "#f3ead7", ink: "#33281c", accent: "#8f3a14" }, dark: { paper: "#201a13", ink: "#ecdfc8", accent: "#e6a273" } });
    expect(ownOf(JSON.parse(JSON.stringify(own)))).toEqual(own);
    expect(ownOf({ ...own, from: "nowhere" })?.from).toBe("paper");
    expect(ownOf({ ...own, light: { ...own.light, ink: "black" } })).toBeUndefined();
    expect(ownOf({ light: own.light })).toBeUndefined();
    expect(ownOf("#ffffff")).toBeUndefined();
  });

  it("makes a writer's own colors into a theme's rules, a too-faint link moved to its nearest readable shade", () => {
    const own = { ...ownFrom(THEMES[0]!), light: { paper: "#faf8f4", ink: "#1f1d1a", accent: "#e0b84a" } };
    const css = themeCss(ownTheme(own));
    const accent = derive(own.light)["accent"];
    expect(accent).not.toBe("#e0b84a");
    expect(contrast(accent, "#faf8f4")).toBeGreaterThanOrEqual(4.5);
    expect(css).toContain(`html:root[data-palette="own"] {\n  --ghw-ink: #1f1d1a;\n  --ghw-muted: `);
    expect(css).toContain(`  --ghw-accent: ${accent};\n`);
  });

  it("offers, in every mode, swatches that make readable tokens whichever are picked together", () => {
    for (const mode of ["light", "dark"] as const) {
      for (const paper of SWATCHES[mode].paper) {
        for (const ink of SWATCHES[mode].ink) {
          for (const accent of SWATCHES[mode].accent) {
            const t = derive({ paper, ink, accent });
            for (const [role, surface] of pairs(t)) expect(contrast(t[role], surface), `${mode} ${paper} ${ink} ${accent}: ${role} on ${surface}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });
});
