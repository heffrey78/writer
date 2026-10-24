import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { asDesktop, axe, caretAtEnd, expect, hear, launch, palette, selectionSettled, test, type App } from "./fixtures.ts";

/**
 * Dictation's page side (#79), with a stand-in shell that hears what the test says: the phrase being
 * heard greyed at the caret, each settled phrase written and saved as typing is, from the palette,
 * Mod-Shift-D, the right-click menu and the bar's button; stopped by Escape and the Stop button. The
 * shell's own hearing is #83's and #86's.
 */

const journal = fileURLToPath(new URL("../../../examples/sample-journal", import.meta.url));
const novelWords = /\b(scenes?|chapters?|manuscript|story bible|novel)\b/i;

/** The book in `dir`, opened in a page whose shell can hear. */
async function open(page: Page, app: App, dir: string): Promise<string> {
  await app.restart(dir);
  // The book's address, from a browser tab: the desktop app's library would open it in a window of its own.
  const tab = await page.context().newPage();
  await tab.goto(app.launchUrl);
  await expect(tab).toHaveURL(/\/novels\/[^/]+/);
  const id = new URL(tab.url()).pathname.split("/")[2]!;
  await tab.close();
  await asDesktop(page, { dictation: true });
  await launch(page, app, `/novels/${id}`);
  return id;
}

const listening = (page: Page) => page.getByRole("group", { name: "Dictation" });
const said = (page: Page, text: string) => expect(page.getByRole("status").filter({ hasText: new RegExp(`^${text}$`) })).toHaveCount(1);
const heard = (box: Locator) => box.locator(".ghw-heard");

test("a scene dictated from the palette, the key and the right-click menu: heard greyed, settled into the file once, stopped by Escape and Stop", async ({ page, app }) => {
  const dir = app.novelRepo("varn");
  await open(page, app, dir);
  const text = page.getByRole("textbox", { name: "Chapter text" });
  await caretAtEnd(page, text);
  const file = join(dir, "manuscript/01-return/01-arrival/02-the-bridge.md");

  await palette(page, "dictate");
  await expect(listening(page)).toContainText("Listening…");
  await said(page, "Listening");
  await expect(text).toBeFocused();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }

  await hear(page, { kind: "heard", text: "the clock" });
  await expect(heard(text)).toHaveText(/clock$/);
  await hear(page, { kind: "heard", text: "the clock was right" });
  await expect(heard(text)).toHaveText(/the clock was right$/i);
  await hear(page, { kind: "settled", text: "the clock was right for once." });
  await expect(heard(text)).toHaveCount(0);
  await expect(text).toContainText("he clock was right for once.");
  await expect.poll(() => readFileSync(file, "utf8"), { timeout: 10_000 }).toContain("clock was right for once.\n");
  expect(readFileSync(file, "utf8").split("clock was right for once.").length).toBe(2);
  // Typing goes on beside it; one undo takes back the phrase, not the typing.
  await page.keyboard.type(" Ada");
  await hear(page, { kind: "settled", text: "nodded." });
  await expect(text).toContainText("for once. Ada nodded.");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(text).toContainText("for once. Ada");
  await expect(text).not.toContainText("nodded");

  await page.keyboard.press("Escape");
  await expect(listening(page)).toHaveCount(0);
  await said(page, "Dictation stopped");
  await expect(text).toBeFocused();

  // Mod-Shift-D, and the Stop button: the phrase still being heard is written before it stops.
  await page.keyboard.press("ControlOrMeta+Shift+D");
  await expect(listening(page)).toContainText("Listening…");
  await hear(page, { kind: "heard", text: "it always" });
  await page.evaluate(() => void ((window as unknown as { __lastPhrase: string }).__lastPhrase = "it always had."));
  await listening(page).getByRole("button", { name: "Stop dictating" }).click();
  await expect(listening(page)).toHaveCount(0);
  await expect(text).toContainText("for once. Ada it always had.");
  await expect(text).toBeFocused();

  // The right-click menu, from the text.
  await text.getByText(/it always had\./).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Dictate" }).click();
  await expect(listening(page)).toContainText("Listening…");
  await text.getByText(/it always had\./).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Stop dictating" }).click();
  await expect(listening(page)).toHaveCount(0);

  await expect.poll(() => readFileSync(file, "utf8"), { timeout: 10_000 }).toContain("for once. Ada it always had.\n");
});

test("today's entry spoken into its place: made with its first settled words, in one commit, from the bar's button, in a journal's words", async ({ page, app }) => {
  const dir = app.bookRepo(journal, "journal");
  await page.clock.setFixedTime(new Date("2026-10-23T09:00:00"));
  await open(page, app, dir);
  const place = page.getByRole("textbox", { name: "Write today's entry" });
  await expect(place).toBeFocused();
  await selectionSettled(page);
  const commits = Number(app.git(dir, "rev-list", "--count", "HEAD"));

  const button = page.getByRole("button", { name: "Dictate", exact: true });
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();
  await expect(listening(page)).toContainText("Listening…");
  await expect(place).toBeFocused();
  await expect(page.getByRole("button", { name: "Stop dictating" }).first()).toBeVisible();
  await hear(page, { kind: "heard", text: "fog on" });
  await hear(page, { kind: "settled", text: "fog on the water till noon." });
  await hear(page, { kind: "settled", text: "then sun." });
  const made = join(dir, "entries/01-2026/02-october/04-friday-23-october.md");
  await expect.poll(() => app.git(dir, "log", "-1", "--format=%s").trim(), { timeout: 10_000 }).toBe("Journal: add entry “Friday, 23 October”");
  await expect.poll(() => readFileSync(made, "utf8"), { timeout: 10_000 }).toContain("\nFog on the water till noon. Then sun.\n");
  expect(Number(app.git(dir, "rev-list", "--count", "HEAD"))).toBe(commits + 1);
  await page.keyboard.press("Escape");
  await expect(listening(page)).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(novelWords);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }

  // At phone width, the button is still in reach.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(button).toBeVisible();
  await button.click();
  await expect(listening(page)).toBeVisible();
  await axe(page);
});

test("a failure mid-phrase keeps the words heard so far and says what to do; in a browser, nothing is offered", async ({ page, app }) => {
  const dir = app.novelRepo("varn");
  await open(page, app, dir);
  const text = page.getByRole("textbox", { name: "Chapter text" });
  await caretAtEnd(page, text);
  await page.keyboard.press("ControlOrMeta+Shift+D");
  await expect(listening(page)).toBeVisible();
  await hear(page, { kind: "heard", text: "and then the" });
  await hear(page, { kind: "failed", reason: "microphone" });
  await expect(listening(page)).toHaveCount(0);
  await expect(text).toContainText("And then the");
  await expect(page.getByRole("status").filter({ hasText: "Dictation stopped. Writer couldn't use the microphone." })).toBeVisible();

  // A browser tab: no shell to hear with.
  const browser = await page.context().newPage();
  await browser.goto(app.launchUrl);
  await expect(browser.getByRole("textbox", { name: "Chapter text" })).toBeFocused();
  await expect(browser.getByRole("button", { name: "Dictate", exact: true })).toHaveCount(0);
  await browser.keyboard.press("ControlOrMeta+k");
  await browser.keyboard.type("dictate");
  await expect(browser.getByRole("option", { name: /Dictate/ })).toHaveCount(0);
});
