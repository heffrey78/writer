import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { textOf, textStyle, UI_FONTS, WRITING_FONTS } from "../src/text-settings.ts";

const FONTS = new URL("../src/fonts/", import.meta.url);

describe("text settings (#192)", () => {
  it("keeps from a record only the settings this app knows", () => {
    expect(textOf({ font: "literata", size: 21, ui: "inter", uiSize: 125 })).toEqual({ font: "literata", size: 21, ui: "inter", uiSize: 125 });
    expect(textOf({ font: "comic", size: 20, ui: 3, uiSize: "big" })).toBeUndefined();
    expect(textOf({ font: "plex", size: 18 })).toEqual({ font: "plex" });
    expect(textOf(null)).toBeUndefined();
  });

  it("changes nothing the stylesheets set when nothing is chosen, or today's is", () => {
    const none = { "--ghw-prose-font": undefined, "--ghw-prose-size": undefined, "--ghw-ui-font": undefined, "font-size": undefined };
    expect(textStyle(undefined, false)).toEqual(none);
    expect(textStyle({ font: "book", size: 19, ui: "system", uiSize: 100 }, false)).toEqual(none);
  });

  it("sets the writing size in pixels once either size is chosen, so the interface's doesn't change the writing's", () => {
    expect(textStyle({ font: "literata", size: 21 }, false)).toMatchObject({ "--ghw-prose-font": '"Literata", Georgia, serif', "--ghw-prose-size": "21px", "font-size": undefined });
    expect(textStyle({ uiSize: 125 }, false)).toMatchObject({ "--ghw-prose-size": "19px", "font-size": "125%" });
    // On a phone, Android's own font size: the interface size isn't the app's to set.
    expect(textStyle({ uiSize: 125, ui: "atkinson" }, true)).toMatchObject({ "--ghw-prose-size": undefined, "font-size": undefined, "--ghw-ui-font": '"Atkinson Hyperlegible", system-ui, sans-serif' });
  });

  it("ships every font it offers, each face in its stylesheet, with its licence, under 2 MB together", () => {
    const css = readFileSync(new URL("fonts.css", FONTS), "utf8");
    for (const font of [...WRITING_FONTS, ...UI_FONTS].filter((f) => f.id !== "book" && f.id !== "system")) {
      const family = /^"([^"]+)"/.exec(font.family)![1]!;
      expect(css, family).toContain(`font-family: "${family}";`);
    }
    let bytes = 0;
    for (const dir of readdirSync(FONTS, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const files = readdirSync(new URL(`${dir.name}/`, FONTS));
      expect(files, dir.name).toContain("OFL.txt");
      expect(readFileSync(new URL(`${dir.name}/OFL.txt`, FONTS), "utf8"), dir.name).toContain("SIL Open Font License, Version 1.1");
      for (const f of files.filter((f) => f.endsWith(".woff2"))) {
        expect(css, f).toContain(`url("./${dir.name}/${f}")`);
        bytes += statSync(new URL(`${dir.name}/${f}`, FONTS)).size;
      }
    }
    for (const [, url] of css.matchAll(/url\("\.\/([^"]+)"\)/g)) expect(statSync(new URL(url!, FONTS)).isFile(), url).toBe(true);
    expect(bytes).toBeLessThan(2 * 1024 * 1024);
  });
});
