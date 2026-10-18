import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { axe, expect, test, type App } from "./fixtures.ts";

/** Format 3 (D15): a novel moves to book.yaml only when the writer asks, and reads the same after. */

async function open(page: Page, app: App) {
  const dir = app.novelRepo("varn");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused();
  return dir;
}

async function palette(page: Page, query: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type(query);
  await page.keyboard.press("Enter");
}

test("moves a novel to the new format from the palette, once asked, in one commit; it reads the same after", async ({ page, app }) => {
  const dir = await open(page, app);
  const settings = readFileSync(join(dir, "novel.yaml"), "utf8");
  await palette(page, "move this book to the new format");
  const ask = page.getByRole("alertdialog", { name: "Move this book to the new format?" });
  await expect(ask).toContainText("gh-writer, and copies of Writer from before this one, won't open it afterwards.");
  await axe(page);
  await ask.getByRole("button", { name: "Move it" }).click();
  await expect(page.getByText("Moved to the new format: the book's settings are in book.yaml now.")).toBeVisible();

  expect(existsSync(join(dir, "novel.yaml"))).toBe(false);
  expect(readFileSync(join(dir, "book.yaml"), "utf8")).toBe(settings.replace("schema_version: 2\n", "schema_version: 3\nkind: novel\n"));
  expect(app.git(dir, "log", "-1", "--format=%s").trim()).toBe("Format v3: the book's settings in book.yaml, naming its kind");

  // The book reads as it did, and the move isn't offered again.
  await expect(page.getByRole("tree", { name: "Manuscript" }).getByRole("treeitem", { name: /^The Station/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("move this book to the new format");
  await expect(page.getByRole("option", { name: /Move this book to the new format/ })).toHaveCount(0);
});
