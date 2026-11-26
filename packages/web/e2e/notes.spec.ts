import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { axe, caretAtEnd, expect, palette, proseOnItsGround, test, type App } from "./fixtures.ts";

/** The writer's notes (heffrey78/gh-writer#205). */

const IDEA = "notes/what-if-ben-never-sold.md";

async function openNovel(page: Page, app: App) {
  const dir = app.novelRepo("varn");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused();
  return dir;
}

test("a note's page: its title, tags and prose edited in place, mentions included", async ({ page, app }) => {
  const dir = await openNovel(page, app);
  await palette(page, "note: what if ben");
  await expect(page.getByRole("heading", { level: 1, name: "What if Ben never sold the plans?" })).toBeVisible();
  await expect(page.getByText("Note · Oct 15, 2026")).toBeVisible();
  await expect(page.getByRole("list", { name: "Tags" }).getByRole("listitem")).toHaveText(["ending", "ben"]);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }

  // Tags, by keyboard: a new one added from the list of the book's.
  await page.getByRole("button", { name: "Edit tags" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /^Add a tag/ }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.type("bridge");
  await page.keyboard.press("Enter");
  await expect.poll(() => readFileSync(join(dir, IDEA), "utf8")).toContain("\ntags: [ending, ben, bridge]\n");
  await page.keyboard.press("Escape");

  // The prose, with a mention.
  const prose = page.getByRole("textbox", { name: "Note: What if Ben never sold the plans?" });
  // On the modal's own ground, the caret in it or not: no box appears around the words (#127).
  await proseOnItsGround(page, prose, page.getByRole("dialog"), page.getByRole("button", { name: "Edit title" }));
  await caretAtEnd(page, prose);
  await page.keyboard.type(" Ask @tomas");
  await expect(page.getByRole("listbox", { name: "Mention suggestions" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect.poll(() => readFileSync(join(dir, IDEA), "utf8")).toMatch(/goes back to \[the flood\]\(#evt_9ab3kd\)\. Ask \[Tomas[^\]]*\]\(#char_t0ma5h\)/);

  // A new title moves the file.
  await page.getByRole("button", { name: "Edit title" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Ben keeps the plans");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Ben keeps the plans" })).toBeVisible();
  await expect.poll(() => existsSync(join(dir, "notes/ben-keeps-the-plans.md"))).toBe(true);
  expect(existsSync(join(dir, IDEA))).toBe(false);
});

test("notes are made from the palette, made into an event or a scene, and deleted", async ({ page, app }) => {
  const dir = await openNovel(page, app);
  await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Outline" }).click();
  await palette(page, "new note");
  await page.getByRole("dialog", { name: "New note" }).getByRole("textbox", { name: "Title" }).fill("A toll on the bridge");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "A toll on the bridge" })).toBeVisible();
  expect(existsSync(join(dir, "notes/a-toll-on-the-bridge.md"))).toBe(true);

  // An event, the note kept and pointing at it.
  await palette(page, "note: what if ben");
  await page.getByRole("button", { name: "Make it an event or a scene" }).click();
  const dialog = page.getByRole("dialog", { name: "Make “What if Ben never sold the plans?” part of the manuscript" });
  await axe(page);
  await dialog.getByRole("button", { name: "Make the event" }).click();
  // The event, beside the Story bible's list (#134).
  const event = page.getByRole("region", { name: "What if Ben never sold the plans?" });
  await expect(event.getByRole("heading", { level: 2, name: "What if Ben never sold the plans?" })).toBeVisible();
  await expect(event.getByText("Story bible · Off the page")).toBeVisible();
  await palette(page, "note: what if ben");
  await expect(page.getByText("Became the off-page event “What if Ben never sold the plans?”.")).toBeVisible();

  // A scene, the note removed.
  await palette(page, "note: a toll");
  await page.getByRole("button", { name: "Make it an event or a scene" }).click();
  await page.getByRole("radio", { name: /^A scene at the end of a chapter/ }).check();
  await page.getByRole("combobox", { name: "Chapter" }).selectOption("ch_01dde6");
  await page.getByRole("radio", { name: "Remove it" }).check();
  await page.getByRole("button", { name: "Write the scene" }).click();
  await expect(page.getByRole("textbox", { name: "Scene text" })).toBeVisible();
  expect(existsSync(join(dir, "notes/a-toll-on-the-bridge.md"))).toBe(false);
  expect(existsSync(join(dir, "manuscript/01-return/02-old-debts/03-a-toll-on-the-bridge.md"))).toBe(true);

  // Deleted, once confirmed.
  await palette(page, "note: what if ben");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Delete “What if Ben never sold the plans?”?" }).getByRole("button", { name: "Delete" }).click();
  await expect.poll(() => existsSync(join(dir, IDEA))).toBe(false);
  await expect.poll(() => app.git(dir, "log", "-1", "--format=%s").trim()).toBe("Notes: remove “What if Ben never sold the plans?”");
});

test("a new note, from the palette while writing, opens on its page ready to write", async ({ page, app }) => {
  await openNovel(page, app);
  await palette(page, "new note");
  await page.getByRole("dialog", { name: "New note" }).getByRole("textbox", { name: "Title" }).fill("A toll on the bridge");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "A toll on the bridge" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Note: A toll on the bridge" })).toBeFocused();
});

test("an entry's and an event's profiles list the notes that mention them", async ({ page, app }) => {
  await openNovel(page, app);
  await palette(page, "character: ada");
  const section = page.getByRole("region", { name: "In your notes" });
  // The note about her (her notes, moved there from her file: D20), then the idea that names her.
  await expect(section.getByRole("link")).toHaveText(["Ada Varn", "What if Ben never sold the plans?"]);
  await expect(section).toContainText("ending, ben");
  await axe(page);
  await palette(page, "off the page: the flood");
  await expect(page.getByRole("region", { name: "The flood of '09" })).toBeVisible();
  await expect(page.getByRole("region", { name: "In your notes" }).getByRole("link")).toHaveText(["What if Ben never sold the plans?"]);
  await palette(page, "character: tomas");
  await expect(page.getByRole("heading", { level: 2, name: "Tomas Hale" })).toBeVisible();
  await expect(page.getByRole("region", { name: "In your notes" }).getByRole("link")).toHaveText(["Tomas Hale"]);
  await palette(page, "location: varn station");
  await expect(page.getByRole("heading", { level: 2, name: "Varn Station" })).toBeVisible();
  await expect(page.getByRole("region", { name: "In your notes" })).toHaveCount(0);
  await palette(page, "character: ada");
  await page.getByRole("region", { name: "In your notes" }).getByRole("link", { name: "What if Ben never sold the plans?" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What if Ben never sold the plans?" })).toBeVisible();
});

test("the note just written is found by its words in the gallery, and its mentions list it on the profile", async ({ page, app }) => {
  await openNovel(page, app);
  await palette(page, "new note");
  await page.getByRole("dialog", { name: "New note" }).getByRole("textbox", { name: "Title" }).fill("A toll on the bridge");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Note: A toll on the bridge" })).toBeFocused();
  await page.keyboard.type("Who collects it? Maybe @mirela");
  await page.keyboard.press("Enter");

  // Closed, the Notes gallery (heffrey78/gh-writer#235); once saved, the note is found there by its words, the previous note by its own.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const cards = page.getByRole("list", { name: "Notes" }).getByRole("listitem");
  await page.getByRole("searchbox", { name: "Search the notes" }).fill("collects");
  await expect(cards.locator("span.font-semibold")).toHaveText(["A toll on the bridge"], { timeout: 10_000 });
  await page.getByRole("searchbox", { name: "Search the notes" }).fill("flood");
  await expect(cards.locator("span.font-semibold")).toHaveText(["What if Ben never sold the plans?"]);

  // Mirela's profile lists it.
  await palette(page, "character: mirela");
  await expect(page.getByRole("region", { name: "In your notes" }).getByRole("link")).toHaveText(["A toll on the bridge", "Mirela Kost"]);
});

test("the Notes gallery: every note as a card, by tag and words, newest or by title", async ({ page, app }) => {
  await openNovel(page, app);
  await palette(page, "new note");
  await page.getByRole("dialog", { name: "New note" }).getByRole("textbox", { name: "Title" }).fill("A toll on the bridge");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "A toll on the bridge" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { level: 1, name: /^Notes/ })).toBeVisible();
  const cards = page.getByRole("list", { name: "Notes" }).getByRole("listitem");
  // Newest first: the one just written, the entries' notes moved from their files (D20), then the idea.
  await expect(cards.locator("span.font-semibold")).toHaveText(["A toll on the bridge", "Ada Varn", "Ben Varn", "Mirela Kost", "The Varn Bridge", "Tomas Hale", "What if Ben never sold the plans?"]);
  // Its tags as chips, and no stripe: a plain card is the raised surface with a rule.
  await expect(cards.nth(6).locator("span.rounded-full")).toHaveText(["ending", "ben"]);
  await expect(cards.nth(6).getByRole("link")).toHaveCSS("border-left-width", "1px");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }
  await page.getByRole("combobox", { name: "Sort" }).selectOption("title");
  await expect(cards.locator("span.font-semibold")).toHaveText(["A toll on the bridge", "Ada Varn", "Ben Varn", "Mirela Kost", "The Varn Bridge", "Tomas Hale", "What if Ben never sold the plans?"]);
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("radiogroup", { name: "Tag" }).getByRole("radio", { name: "ben" }).click();
  await expect(cards).toHaveCount(1);
  await expect(page.getByRole("status").filter({ hasText: "note matches" })).toHaveText("1 note matches");
  await page.getByRole("radiogroup", { name: "Tag" }).getByRole("radio", { name: "Any tag" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("searchbox", { name: "Search the notes" }).fill("flood");
  await expect(cards).toHaveCount(1);
  await cards.getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1, name: "What if Ben never sold the plans?" })).toBeVisible();

});

test("a note's color, chosen on the note by keyboard or from the palette, fills its page and its card, one line of its file (#228); the gallery filtered by it from Filter (#227)", async ({ page, app }) => {
  const dir = await openNovel(page, app);
  const before = readFileSync(join(dir, IDEA), "utf8");
  await palette(page, "note: what if ben");
  const note = page.getByRole("dialog", { name: "What if Ben never sold the plans?" });
  await expect(note.getByRole("textbox", { name: "Note: What if Ben never sold the plans?" })).toBeVisible();

  // By keyboard: Color, then the arrows through None and the eight.
  await note.getByRole("button", { name: "Color: none" }).focus();
  await page.keyboard.press("Enter");
  const colors = page.getByRole("radiogroup", { name: "Color" });
  await expect(colors.getByRole("radio", { name: "None" })).toBeFocused();
  await expect(colors.getByRole("radio")).toHaveCount(9);
  // Held a moment, as a finger holds a key: Radix moves the focus after the key's down, and chooses only while it's down.
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight", { delay: 50 });
  await expect(colors.getByRole("radio", { name: "Yellow" })).toBeChecked();
  await expect(note).toHaveClass(/bg-note-yellow/);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.keyboard.press("Escape");
  await expect(note.getByRole("button", { name: "Color: yellow" })).toBeFocused();
  // In the file, the one line.
  const lines = (text: string) => text.split("\n");
  await expect.poll(() => readFileSync(join(dir, IDEA), "utf8")).not.toBe(before);
  const after = lines(readFileSync(join(dir, IDEA), "utf8"));
  expect(after.filter((l) => !lines(before).includes(l))).toEqual(["color: yellow"]);
  expect(after.filter((l) => l !== "color: yellow")).toEqual(lines(before));

  // The gallery: its card in the color, read with its color's name.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const cards = page.getByRole("list", { name: "Notes" }).getByRole("listitem");
  const idea = cards.getByRole("link", { name: /^What if Ben never sold the plans\? ?, yellow\. Then Ada/ });
  await expect(idea).toHaveClass(/bg-note-yellow/);

  // / searches; Filter, by keyboard alone, keeps the yellow ones; Escape gives the focus back to Filter.
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox", { name: "Search the notes" })).toBeFocused();
  await page.getByRole("button", { name: "Filter", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("radio", { name: "Any color" })).toBeFocused();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight", { delay: 50 });
  await expect(cards).toHaveCount(1);
  await expect(page).toHaveURL(/[?&]color=yellow/);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Filter · 1" })).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "note matches" })).toHaveText("1 note matches");
  await page.getByRole("button", { name: "Remove the filter: Yellow" }).click();
  await expect(cards).toHaveCount(6);
  // Cards of their own heights, in columns: each spans its height's worth of the grid's rows, after a
  // search that matched nothing is cleared too.
  await page.getByRole("searchbox", { name: "Search the notes" }).fill("nothing is called this");
  await expect(page.getByText("No note matches.")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search the notes" }).fill("");
  await expect(cards).toHaveCount(6);
  for (const card of await cards.all()) await expect.poll(() => card.evaluate((li) => (li as HTMLElement).style.gridRowEnd)).toMatch(/^span \d+$/);
  // None over another.
  const boxes = await Promise.all((await cards.getByRole("link").all()).map(async (card) => (await card.boundingBox())!));
  for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);

  // From the palette, with the note open: Note color: None takes it off, and the file is as it was.
  await idea.click();
  await expect(note.getByRole("button", { name: "Color: yellow" })).toBeVisible();
  await palette(page, "note color: none");
  await expect(note.getByRole("button", { name: "Color: none" })).toBeVisible();
  await expect(note).not.toHaveClass(/bg-note-/);
  await expect.poll(() => readFileSync(join(dir, IDEA), "utf8")).toBe(before);
});
