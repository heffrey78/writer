import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { axe, expect, palette, test, type App } from "./fixtures.ts";

/**
 * The Journal kind on screen (#36): the sample journal's months and entries, its index of people,
 * places, events and values, its outline and story map, in a journal's words, with nothing of the
 * Novel's story-only modules.
 */

const sample = fileURLToPath(new URL("../../../examples/sample-journal", import.meta.url));
/** No novel's words anywhere on the page. */
const novelWords = /\b(scenes?|chapters?|manuscript|story bible|novel|off the page|plotlines?|point of view|drafting board)\b/i;

async function open(page: Page, app: App) {
  await app.restart(app.bookRepo(sample, "journal"));
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Month text" })).toBeFocused();
}

test("opens in its months and entries, in a journal's words", async ({ page, app }) => {
  await open(page, app);
  await expect(page.getByRole("heading", { level: 1, name: "September" })).toBeVisible();
  const tree = page.getByRole("tree");
  for (const name of ["2026", "September", "October", "Monday, 28 September", "Thursday, 1 October"]) await expect(tree.getByRole("treeitem", { name, exact: false }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(novelWords);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }
});

test("its index, outline and story map say its words too", async ({ page, app }) => {
  await open(page, app);
  await palette(page, "index");
  await expect(page.getByRole("heading", { level: 1, name: "Index" })).toBeVisible();
  for (const type of ["People", "Places", "Events", "Values"]) await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^${type}`) })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(novelWords);

  await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Outline" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Outline" })).toBeVisible();
  // Table and Cards: no drafting board for a journal.
  await expect(page.getByRole("radiogroup", { name: "Show the outline as" }).getByRole("radio")).toHaveCount(2);
  await expect(page.locator("main")).not.toContainText(novelWords);

  await palette(page, "story map: timeline");
  await expect(page.getByRole("tabpanel", { name: "Timeline" }).getByRole("link", { name: "Thursday, 1 October" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(novelWords);
});
