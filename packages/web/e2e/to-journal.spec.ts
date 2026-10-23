import { readFileSync } from "node:fs";
import { join } from "node:path";
import { journalAsNovel } from "../../modules/to-journal/test/fixture.ts";
import { axe, expect, palette, test } from "./fixtures.ts";

/** A journal kept as a novel, made a Journal in the app (#39): asked first, one commit, then open as a journal. */

test("Make this book a journal…: asked, done in one commit, and the book opens as a journal, saying what it dated", async ({ page, app }) => {
  const dir = journalAsNovel(join(app.home, "novels", "journal"));
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused();

  await palette(page, "make this book a journal");
  const dialog = page.getByRole("alertdialog", { name: "Make this book a journal?" });
  await expect(dialog).toContainText("Every ID, mention, relationship and note stays.");
  await axe(page);
  await dialog.getByRole("button", { name: "Do it" }).click();

  // On its journal page (#64), as a journal opens.
  await expect(page.getByRole("heading", { level: 1, name: "Day by day" })).toBeVisible();
  await expect(page.getByText("It's a journal now. “Tuesday, 10/20/2026” dated 2026-10-20 from its title.")).toBeVisible();
  await expect(page.getByRole("tree").getByRole("treeitem", { name: /October 2026/ }).first()).toBeVisible();
  expect(app.git(dir, "log", "-1", "--format=%s").trim()).toBe("Make this book a journal");
  expect(readFileSync(join(dir, "book.yaml"), "utf8")).toMatch(/^kind: journal$/m);
  // A journal has no such command.
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("make this book a journal");
  await expect(page.getByRole("dialog", { name: "Command palette" }).getByRole("option", { name: /Make this book a journal/ })).toHaveCount(0);
});
