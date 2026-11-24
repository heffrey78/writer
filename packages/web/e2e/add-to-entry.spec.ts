import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { axe, expect, selectionSettled, test } from "./fixtures.ts";

/*
 * Add to an entry (#157): words just written, into a note about the entry (D20) as a quote that finds
 * its sentence again, or into a field; from the keys, the palette and the right-click menu.
 */

const ADA = "bible/characters/ada.md";
/** The note about Ada: her notes, moved there from her file (D20). */
const ABOUT_ADA = "notes/ada-varn.md";
const WORDS = "counted them twice, the way you count stitches in a wound";

/** Select these words in the text, as a drag would. */
async function select(page: Page, box: Locator, words: string) {
  await box.focus();
  await box.evaluate((el, words) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf(words);
      if (i >= 0) return void getSelection()!.setBaseAndExtent(n, i, n, i + words.length);
    }
    throw new Error(`“${words}” isn't in the text`);
  }, words);
  await selectionSettled(page);
}

test("selected words go into a note about an entry as a quote that opens its sentence again, or into a field; Undo puts the file back (#157)", async ({ page, app }) => {
  const dir = app.novelRepo("varn");
  await app.restart(dir);
  const read = (path: string) => readFileSync(join(dir, path), "utf8");
  const was = read(ABOUT_ADA);
  await page.goto(app.launchUrl);
  const text = page.getByRole("textbox", { name: "Chapter text" });
  await expect(text).toBeFocused();

  // By its keys: the entries in the scene first, then all; found by name.
  await select(page, text, WORDS);
  await page.keyboard.press("ControlOrMeta+Shift+E");
  const dialog = page.getByRole("dialog", { name: "Add to an entry" });
  await expect(dialog).toContainText(WORDS);
  await expect(dialog.getByRole("option").first()).toHaveText(/^Ada VarnCharacter/);
  await axe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.keyboard.type("ada");
  await page.keyboard.press("Enter");
  const into = page.getByRole("dialog", { name: "Add to Ada Varn" });
  await expect(into.getByRole("button", { name: "Add to your notes on Ada Varn" })).toBeFocused();
  await page.keyboard.press("Enter");

  // The quote and the scene it's from, at the end of the note about her, and nothing else changed; the words still selected.
  await expect(into).toHaveCount(0);
  await expect(text).toBeFocused();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(WORDS);
  await expect(page.getByRole("status").filter({ hasText: "Added to your notes on Ada Varn, from “The Station”." })).toBeVisible();
  const quoted = `${was}\n> ${WORDS}\n\n— *The Station*\n`;
  await expect.poll(() => read(ABOUT_ADA)).toBe(quoted);
  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => read(ABOUT_ADA)).toBe(was);

  // From the right-click menu, the whole paragraph; her profile opens the scene at it.
  const paragraph = text.getByText(/the way you count stitches in a wound\./);
  await paragraph.click({ clickCount: 3 });
  await paragraph.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Selected text" });
  await expect(menu.getByRole("menuitem")).toHaveText(["Add to an entry…"]);
  await expect(menu.getByRole("menuitem", { name: "Add to an entry…" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.type("ada");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  const sentence = `She stood with her bag at her feet and ${WORDS}.`;
  await expect.poll(() => read(ABOUT_ADA)).toBe(`${was}\n> ${sentence}\n\n— *The Station*\n`);
  const base = new URL(app.launchUrl).pathname.replace(/\/chapter.*$/, "");
  await page.goto(`${app.url}${base}/bible/char_7f3k2q/page`);
  const back = page.getByRole("list", { name: "Quoted from the text" }).getByRole("button", { name: /^Open “The Station” at “She stood with her bag/ });
  await back.click();
  await expect(page).toHaveURL(/\/scene\/sc_5tat1n$/);
  await expect(page.getByRole("textbox", { name: "Scene text" })).toBeFocused();
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe(sentence);

  // As a field, from the palette: that field and nothing else.
  const now = read(ADA);
  const scene = page.getByRole("textbox", { name: "Scene text" });
  await select(page, scene, "counted them twice");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("selected words to an entry");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.type("ada");
  await page.keyboard.press("Enter");
  await into.getByRole("combobox", { name: "Or as a field: its name" }).fill("habit");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Set Ada Varn's habit to “counted them twice”." })).toBeVisible();
  await expect.poll(() => read(ADA)).toBe(now.replace("  eyes: grey\n", "  eyes: grey\n  habit: counted them twice\n"));
  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => read(ADA)).toBe(now);
});

test("words added to an entry no note is about yet: a new note titled after it, mentioning it first, listed on its profile; Undo removes it (D20)", async ({ page, app }) => {
  const dir = app.novelRepo("varn");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  const text = page.getByRole("textbox", { name: "Chapter text" });
  await expect(text).toBeFocused();
  await select(page, text, "Twelve years had not moved the station clock");
  await page.keyboard.press("ControlOrMeta+Shift+E");
  await page.keyboard.type("varn station");
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "Add to Varn Station" }).getByRole("button", { name: "Add to your notes on Varn Station" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added to your notes on Varn Station, from “The Station”." })).toBeVisible();
  const made = join(dir, "notes/varn-station.md");
  await expect.poll(() => existsSync(made)).toBe(true);
  expect(readFileSync(made, "utf8")).toMatch(/^---\nid: note_[0-9a-z]{6}\ntitle: Varn Station\ncreated: [0-9T:-]+\n---\n\n\[Varn Station\]\(#loc_5tat10\)\n\n> Twelve years had not moved the station clock\n\n— \*The Station\*\n$/);
  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => existsSync(made)).toBe(false);
});
