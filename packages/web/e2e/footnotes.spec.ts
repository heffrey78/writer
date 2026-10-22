import { readFileSync } from "node:fs";
import { join } from "node:path";
import { axe, caretAtEnd, expect, palette, test } from "./fixtures.ts";

/** Footnotes in the writing view (#58): added by keyboard and from the palette, written, followed and removed, saved as Markdown's. */

const BRIDGE = "manuscript/01-return/01-arrival/02-the-bridge.md";

test("a footnote added by keyboard, written, followed both ways, saved as Markdown's", async ({ page, app }) => {
  const dir = app.novelRepo("varn");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await page.getByRole("tree", { name: "Manuscript" }).getByRole("treeitem", { name: /Walking the Span/ }).click();
  const text = page.getByRole("textbox", { name: "Scene text" });
  const before = readFileSync(join(dir, BRIDGE), "utf8");
  await caretAtEnd(page, text);

  // Mod-Alt-F, as in Word: its number at the caret, the caret in its note.
  await page.keyboard.press("ControlOrMeta+Alt+f");
  const note = text.locator("aside.ghw-footnote");
  await expect(note).toHaveAttribute("aria-label", "Footnote 1");
  await page.keyboard.type("Counted from the town side.");
  await expect.poll(() => readFileSync(join(dir, BRIDGE), "utf8"), { timeout: 10_000 }).toBe(`${before.trimEnd()}[^1]\n\n[^1]: Counted from the town side.\n`);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }

  // The same keys from the note go back to the reference; the reference clicked opens the note.
  await page.keyboard.press("ControlOrMeta+Alt+f");
  await page.keyboard.type(" Twice.");
  // Clicked where it shows: Playwright's own aim inside it lands on its hidden words for screen readers.
  const box = (await text.locator("sup.ghw-footnote-ref").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.type(" Nine piers.");
  await expect.poll(() => readFileSync(join(dir, BRIDGE), "utf8"), { timeout: 10_000 }).toBe(`${before.trimEnd()}[^1] Twice.\n\n[^1]: Counted from the town side. Nine piers.\n`);

  // From the palette too; deleting a reference takes its note with it.
  // Back to the reference, then to the end of its line ("… check.¹ Twice.").
  await page.keyboard.press("ControlOrMeta+Alt+f");
  await page.keyboard.press("End");
  await palette(page, "add a footnote");
  await page.keyboard.type("Second.");
  await expect(text.locator("aside.ghw-footnote")).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+Alt+f");
  await page.keyboard.press("Backspace");
  await expect(text.locator("aside.ghw-footnote")).toHaveCount(1);
  await expect.poll(() => readFileSync(join(dir, BRIDGE), "utf8"), { timeout: 10_000 }).toBe(`${before.trimEnd()}[^1] Twice.\n\n[^1]: Counted from the town side. Nine piers.\n`);
});
