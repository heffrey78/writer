import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { asDesktop, axe, calls, caretAtEnd, expect, hear, launch, palette, selectionSettled, test, type App } from "./fixtures.ts";

/**
 * Dictation's page side (#79), with a stand-in shell that hears what the test says: the phrase being
 * heard greyed at the caret, each settled phrase written and saved as typing is, from the palette,
 * Mod-Shift-D, the right-click menu and the bar's button; stopped by Escape and the Stop button. The
 * shell's own hearing is #83's and #86's.
 */

const journal = fileURLToPath(new URL("../../../examples/sample-journal", import.meta.url));
const novelWords = /\b(scenes?|chapters?|manuscript|story bible|novel)\b/i;

/** The book in `dir`, opened in a page whose shell can hear. */
async function open(page: Page, app: App, dir: string, model: "ready" | "missing" = "ready"): Promise<string> {
  await app.restart(dir);
  // The book's address, from a browser tab: the desktop app's library would open it in a window of its own.
  const tab = await page.context().newPage();
  await tab.goto(app.launchUrl);
  await expect(tab).toHaveURL(/\/novels\/[^/]+/);
  const id = new URL(tab.url()).pathname.split("/")[2]!;
  await tab.close();
  await asDesktop(page, { dictation: true, model });
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

test("the first Dictate on a computer without the speech model offers it, says how far the download is, then dictates (#83)", async ({ page, app }) => {
  const dir = app.novelRepo("varn");
  await open(page, app, dir, "missing");
  const text = page.getByRole("textbox", { name: "Chapter text" });
  await caretAtEnd(page, text);
  // The page tells the desktop app it offers Dictate, for Start Dictation in its Edit menu.
  await expect.poll(() => calls(page, "dictation_offered")).toContainEqual({ offered: true });

  // From the Edit menu: the shell runs the palette's command in the page.
  await page.evaluate(() => window.writer!.run({ name: "command", arg: "writing.dictate" }));
  // A dialog of its own: hundreds of megabytes to agree to.
  const offer = page.getByRole("dialog", { name: "Dictation needs its speech model" });
  await expect(offer).toContainText("Writer hears you with its own speech model, on this computer: what you say never leaves it, and nothing is recorded.");
  await expect(offer).toContainText("419 MB to download, 208 MB once it's in");
  await expect(listening(page)).toHaveCount(0);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }
  // At a phone's width, all of it in reach.
  await page.setViewportSize({ width: 412, height: 915 });
  await axe(page);
  await page.evaluate(() => void ((window as unknown as { __holdDownload: () => void }).__holdDownload = () => {}));
  await offer.getByRole("button", { name: "Download it (419 MB)" }).click();
  await expect(offer).toContainText("Downloading: 50% of 419 MB…");
  await expect(offer.getByRole("button", { name: "Cancel download" })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __holdDownload: () => void }).__holdDownload());
  const ready = page.getByRole("dialog", { name: "The speech model is in" });
  await expect(ready).toContainText("Dictation hears on this computer now.");
  await ready.getByRole("button", { name: "Dictate" }).click();
  await expect(ready).toHaveCount(0);
  await expect(listening(page)).toContainText("Listening…");
  await hear(page, { kind: "settled", text: "the clock was right for once." });
  await expect(text).toContainText("he clock was right for once.");
  await page.keyboard.press("Escape");
  await expect(listening(page)).toHaveCount(0);
});

test("dictation's settings: the speech model downloaded and removed, the microphone, the silence and reading out, all kept by the shell (#80)", async ({ page, app }) => {
  const dir = app.novelRepo("varn");
  await open(page, app, dir, "missing");
  const dialog = page.getByRole("dialog", { name: "Dictation" });
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeVisible();
  await page.getByRole("banner").getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Dictation…" }).click();
  await expect(dialog).toContainText("What you say is heard on this computer, by Writer itself, and never leaves it.");
  await expect(dialog.getByRole("radio", { name: "On this computer, with Writer's speech model" })).toBeChecked();
  await expect(dialog).toContainText("419 MB to download, 208 MB once it's in");
  await expect(dialog).toContainText("If the system's choice is Bluetooth headphones, they switch to headset mode while you dictate");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }

  // The download, said in the settings rather than a notice.
  await page.evaluate(() => void ((window as unknown as { __holdDownload: () => void }).__holdDownload = () => {}));
  await dialog.getByRole("button", { name: "Download it" }).click();
  await expect(dialog).toContainText("Downloading: 50% of 419 MB…");
  await expect(dialog.getByRole("button", { name: "Cancel download" })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __holdDownload: () => void }).__holdDownload());
  await expect(dialog).toContainText("Writer's speech model for English is on this computer: 208 MB.");
  await expect(page.getByRole("status").filter({ hasText: "speech model" })).toHaveCount(0);

  const microphone = dialog.getByLabel("Microphone", { exact: true });
  await expect(microphone).toHaveValue("");
  await microphone.selectOption({ label: "Bose NC 700 (Bluetooth)" });
  await expect(dialog).toContainText("This is Bluetooth headphones' microphone. They switch to headset mode while you dictate");
  await microphone.selectOption({ label: "Built-in Audio Analog Stereo" });
  await expect(dialog).not.toContainText("headset mode");
  await dialog.getByLabel("Stop listening after").selectOption({ label: "2 minutes without a word" });
  await dialog.getByLabel("Read each phrase out to a screen reader as it's written").check();
  await dialog.getByRole("radio", { name: "On this computer, by the system" }).check();
  await expect
    .poll(async () => (await calls(page, "dictation_save_settings")).at(-1))
    .toEqual({ settings: { recognizer: "system", microphone: { id: "pulseaudio:alsa_input.pci", name: "Built-in Audio Analog Stereo" }, silenceSeconds: 120, announce: true } });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }

  // Removing the model asks first.
  await dialog.getByRole("button", { name: "Remove from this computer" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Remove the speech model?" });
  await expect(confirm).toContainText("It frees 208 MB.");
  await confirm.getByRole("button", { name: "Remove it" }).click();
  await expect(dialog).toContainText("isn't on this computer yet");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);

  // From the palette, as they were left.
  await palette(page, "dictation settings");
  await expect(dialog.getByLabel("Stop listening after")).toHaveValue("120");
  await expect(dialog.getByLabel("Microphone", { exact: true })).toHaveValue("pulseaudio:alsa_input.pci");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("names written as the book spells them, and a new paragraph said alone, into the file (#81)", async ({ page, app }) => {
  const dir = app.novelRepo("varn");
  await open(page, app, dir);
  const text = page.getByRole("textbox", { name: "Chapter text" });
  await caretAtEnd(page, text);
  const file = join(dir, "manuscript/01-return/01-arrival/02-the-bridge.md");

  await page.keyboard.press("ControlOrMeta+Shift+D");
  await expect(listening(page)).toContainText("Listening…");
  await hear(page, { kind: "settled", text: "Thomas was waiting." });
  await hear(page, { kind: "settled", text: "New paragraph." });
  await hear(page, { kind: "settled", text: "the lamps came on." });
  await expect(text).toContainText("Tomas was waiting.");
  await expect.poll(() => readFileSync(file, "utf8"), { timeout: 10_000 }).toMatch(/ Tomas was waiting\.\n\nThe lamps came on\.\n$/);
  expect(readFileSync(file, "utf8")).not.toContain("Thomas");
  await page.keyboard.press("Escape");
  await expect(listening(page)).toHaveCount(0);
});
