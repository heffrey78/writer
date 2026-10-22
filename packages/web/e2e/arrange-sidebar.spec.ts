import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { axe, expect, palette, test } from "./fixtures.ts";

/**
 * Arrange the sidebar (#63): a journal's pages moved, hidden and shown by keyboard, saved in
 * book.yaml in one commit with the rest of it as it was, and back to the journal's; a novel in
 * gh-writer's format is asked to move to the new format first.
 */

const sample = fileURLToPath(new URL("../../../examples/sample-journal", import.meta.url));
const arrange = (page: Page) => page.getByRole("dialog", { name: "Arrange the sidebar" });
const links = (page: Page, group: string) => page.getByRole("navigation", { name: "Views" }).getByRole("group", { name: group }).getByRole("link");
/** Press a button as the keyboard does: focus it, then Enter. */
async function press(page: Page, name: string) {
  await arrange(page).getByRole("button", { name, exact: true }).focus();
  await page.keyboard.press("Enter");
}

test("a journal's sidebar arranged by keyboard: kept in book.yaml in one commit, and back to the journal's", async ({ page, app }) => {
  const dir = app.bookRepo(sample, "journal");
  const before = readFileSync(join(dir, "book.yaml"), "utf8");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Month text" })).toBeFocused();

  await palette(page, "arrange the sidebar");
  const dialog = arrange(page);
  await expect(dialog).toBeVisible();
  // Issues too, where it will be once the journal is on GitHub.
  await expect(dialog.getByRole("region", { name: "Look back" }).getByRole("listitem")).toHaveText(["Calendar", "Read", "Notes", "Issues (once the book is on GitHub)"]);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }

  // Notes to the top: focus stays on it, and each move is said.
  await press(page, "Move “Notes” up");
  await expect(dialog.getByRole("button", { name: "Move “Notes” up" })).toBeFocused();
  await expect(dialog.getByText("“Notes” moved up: 2 of 4 in Look back.")).toBeAttached();
  await page.keyboard.press("Enter");
  // First of all now: up can't go further, so the focus is on down.
  await expect(dialog.getByRole("button", { name: "Move “Notes” up" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Move “Notes” down" })).toBeFocused();

  // Index up into the group above, past the top of People and places.
  await press(page, "Move “Index” up");
  await expect(dialog.getByText("“Index” moved to Look back.")).toBeAttached();

  // Story map hidden; Outline, which a journal leaves out, shown.
  await press(page, "Hide “Story map”");
  await expect(dialog.getByRole("button", { name: "Show “Story map”" })).toBeFocused();
  await press(page, "Show “Outline”");
  await expect(dialog.getByRole("button", { name: "Hide “Outline”" })).toBeFocused();

  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(links(page, "Look back")).toHaveText(["Notes", "Calendar", "Read", "Index", "Outline"]);
  await expect(links(page, "People and places")).toHaveText(["Relationships", "Progress"]);
  // In book.yaml, after what was there, as one commit.
  expect(readFileSync(join(dir, "book.yaml"), "utf8")).toBe(
    `${before}sidebar:\n  groups:\n    look-back:\n      - notes\n      - calendar\n      - read\n      - issues\n      - index\n      - outline\n    people-and-places:\n      - relationships\n      - progress\n  hidden:\n    - story-map\n`,
  );
  expect(app.git(dir, "log", "-1", "--format=%s").trim()).toBe("Arrange the sidebar");

  // Kept: the same after the app starts again.
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(links(page, "Look back")).toHaveText(["Notes", "Calendar", "Read", "Index", "Outline"]);

  // Back to the journal's, from the sidebar's own button: book.yaml as it was.
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Arrange the sidebar…" }).click();
  await arrange(page).getByRole("button", { name: "Back to the journal's" }).click();
  await arrange(page).getByRole("button", { name: "Save" }).click();
  await expect(arrange(page)).toHaveCount(0);
  await expect(links(page, "Look back")).toHaveText(["Calendar", "Read", "Notes"]);
  await expect.poll(() => readFileSync(join(dir, "book.yaml"), "utf8")).toBe(before);
});

test("a novel in gh-writer's format is asked to move to the new format before its sidebar is arranged", async ({ page, app }) => {
  const dir = app.novelRepo("varn");
  const before = readFileSync(join(dir, "novel.yaml"), "utf8");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused();

  await page.getByRole("banner").getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Arrange the sidebar…" }).click();
  await expect(arrange(page)).toContainText("Move it to the new format first.");
  await axe(page);
  await arrange(page).getByRole("button", { name: "Move to the new format…" }).click();
  await expect(page.getByRole("alertdialog", { name: "Move this book to the new format?" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(readFileSync(join(dir, "novel.yaml"), "utf8")).toBe(before);
});
