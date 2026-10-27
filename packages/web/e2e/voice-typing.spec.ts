import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, launch, palette, selectionSettled, test } from "./fixtures.ts";

/**
 * A phone keyboard's voice typing (#85), as Gboard sends it, into today's place: each phrase one
 * composition, rewritten whole as more is heard (an earlier word corrected on the way) and committed
 * at a sentence's end; then the last word heard again, composed over where it was. The first words
 * make today's entry while they're still being composed. Android's webview is Chromium, and the
 * compositions go in through its protocol, as an input method's do. packages/mobile/e2e.ts does
 * the same on a device.
 */

test.skip(({ browserName }) => browserName !== "chromium", "Compositions are replayed through Chromium's protocol.");

test("voice typing into today's place keeps every word, the entry made mid-composition", async ({ page, app }) => {
  await launch(page, app);
  await page.getByRole("list", { name: "Books" }).getByRole("button", { name: "New book" }).click();
  const dialog = page.getByRole("dialog", { name: "New book" });
  await dialog.getByRole("radio", { name: "Journal" }).check();
  await dialog.getByRole("textbox", { name: "Title" }).fill("Days");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Day by day" })).toBeVisible();
  await page.clock.setFixedTime(new Date("2026-10-19T08:00:00"));
  await palette(page, "today's entry");
  const text = page.getByRole("textbox", { name: "Write today's entry" });
  await expect(text).toBeFocused();
  await selectionSettled(page);

  const ime = await page.context().newCDPSession(page);
  const compose = async (heard: string) => {
    await ime.send("Input.imeSetComposition", { text: heard, selectionStart: heard.length, selectionEnd: heard.length });
    await page.waitForTimeout(150);
  };
  const commit = (heard: string) => ime.send("Input.insertText", { text: heard });
  for (const heard of ["Spoken ", "Spoken to ", "Spoken to a ", "Spoken to the keyboard ", "Spoken to the keyboard every ", "Spoken to the keyboard, every word "]) await compose(heard);
  // A pause longer than the editor's (300 ms): what's composed so far is reported mid-phrase.
  await page.waitForTimeout(600);
  await compose("Spoken to the keyboard, every word.");
  await commit("Spoken to the keyboard, every word.");
  for (const heard of [" Kept ", " Kept as ", " Kept as sad"]) await compose(heard);
  await commit(" Kept as sad");
  await text.evaluate((el) => {
    const words = [...el.querySelectorAll("p")].at(-1)!.lastChild!;
    const at = words.textContent!.lastIndexOf("sad");
    getSelection()!.setBaseAndExtent(words, at, words, at + 3);
  });
  await compose("said");
  await commit("said.");
  await ime.detach();

  const said = "Spoken to the keyboard, every word. Kept as said.";
  await expect(text).toHaveText(said);
  // The editor kept its name, and the keyboard its text box, as the entry was made.
  await expect(page.getByRole("textbox", { name: "Write today's entry" })).toBeFocused();
  const month = join(app.home, "writer", "days", "entries", "01-2026", "01-october");
  const bodies = () => readdirSync(month).filter((f) => f.endsWith(".md")).map((f) => readFileSync(join(month, f), "utf8").split("---\n")[2]);
  await expect.poll(bodies).toEqual([`${said}\n`]);
});
