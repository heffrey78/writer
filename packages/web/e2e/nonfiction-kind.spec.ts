import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { axe, expect, openView, palette, test, type App } from "./fixtures.ts";

/**
 * The Non-fiction kind on screen (#57): the sample book's chapters and sections, its index of
 * sources, people, concepts and claims, its outline and graph, in a non-fiction writer's words, with
 * nothing of the Novel's story modules.
 */

const sample = fileURLToPath(new URL("../../../examples/sample-nonfiction", import.meta.url));
/** No novel's words anywhere on the page (a non-fiction book has chapters and parts of its own). */
const novelWords = /\b(scenes?|manuscript|story bible|novel|characters?|off the page|plotlines?|point of view|drafting board)\b/i;

async function open(page: Page, app: App) {
  await app.restart(app.bookRepo(sample, "nonfiction"));
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused();
}

test("opens in its chapters and sections, in a non-fiction writer's words", async ({ page, app }) => {
  await open(page, app);
  await expect(page.getByRole("heading", { level: 1, name: "Castings" })).toBeVisible();
  const tree = page.getByRole("tree");
  for (const name of ["Castings", "A despised creature", "Ten tons an acre", "Burial", "Stones sink"]) await expect(tree.getByRole("treeitem", { name, exact: false }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(novelWords);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }
});

test("its index and outline say its words too", async ({ page, app }) => {
  await open(page, app);
  await palette(page, "index");
  await expect(page.getByRole("heading", { level: 1, name: "Index" })).toBeVisible();
  for (const type of ["Sources", "People", "Concepts", "Claims"]) await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^${type}`) })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(novelWords);
  await axe(page);

  await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Outline" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Outline" })).toBeVisible();
  // Table and Cards: no drafting board for a non-fiction book.
  await expect(page.getByRole("radiogroup", { name: "Show the outline as" }).getByRole("radio")).toHaveCount(2);
  await expect(page.getByRole("columnheader", { name: /Concepts/ })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(novelWords);
});

test("the graph shows who argues what, and how the ideas build on each other", async ({ page, app }) => {
  await open(page, app);
  await openView(page, "Relationships");
  await expect(page.getByRole("heading", { level: 1, name: "Relationships" })).toBeVisible();
  const edge = (name: string) => page.locator(`.react-flow__edge[aria-label="${name}"]`);
  await expect(edge("Charles Darwin, Argues, Worms make the topsoil")).toHaveCount(1);
  await expect(edge("Burial, Builds on, Castings")).toHaveCount(1);
  await expect(page.locator("main")).not.toContainText(novelWords);
  await axe(page);
});

test("the shelf's New offers a non-fiction book, which starts with a chapter and its first section", async ({ page, app }) => {
  await open(page, app);
  await page.getByRole("link", { name: "Writer: your books" }).click();
  await page.getByRole("list", { name: "Books" }).getByRole("button", { name: "New book" }).click();
  const dialog = page.getByRole("dialog", { name: "New book" });
  await dialog.getByRole("radio", { name: "Non-fiction book" }).check();
  await dialog.getByRole("textbox", { name: "Title" }).fill("Deep Time");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "The First Chapter" })).toBeVisible();
  await expect(page.getByRole("tree").getByRole("treeitem", { name: /Section 1/ })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(novelWords);
});
