import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Download } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { axe, caretAtEnd, expect, palette, test } from "./fixtures.ts";

/**
 * Citations (#59) in the sample non-fiction book: a source cited from a footnote with @, its page
 * saying how it'll be cited, and the compiled e-book's notes in short form and its bibliography.
 */

const sample = fileURLToPath(new URL("../../../examples/sample-nonfiction", import.meta.url));
const STONES = "text/02-burial/01-stones-sink.md";
/** No novel's words anywhere on the page. */
const novelWords = /\b(scenes?|manuscript|story bible|novel|characters?)\b/i;

test("a footnote cites a source with @; its page says how; the compiled book cites it short and lists it", async ({ page, app }) => {
  const dir = app.bookRepo(sample, "small-ploughs");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await page.getByRole("tree").getByRole("treeitem", { name: /Stones sink/ }).click();
  const text = page.getByRole("textbox", { name: "Section text" });
  await caretAtEnd(page, text);

  // A footnote, and in it the source, found by its alias.
  await page.keyboard.press("ControlOrMeta+Alt+f");
  await page.keyboard.type("@Selb");
  const suggestions = page.getByRole("listbox", { name: "Mention suggestions" });
  await expect(suggestions.getByRole("option", { name: /The Natural History of Selborne/ }).first()).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type("on worms.");
  await expect.poll(() => readFileSync(join(dir, STONES), "utf8"), { timeout: 10_000 }).toMatch(/\[\^1\]\n\n\[\^1\]: \[(Selborne|The Natural History of Selborne)\]\(#src_se1b0r\) on worms\.\n$/);

  // Its page: how the book will cite it.
  await palette(page, "Selborne");
  const citation = page.getByRole("region", { name: "Citation" });
  await expect(citation).toContainText("In the notesWhite, Selborne");
  await expect(citation).toContainText("White, Gilbert. The Natural History of Selborne. London, 1789.");
  await expect(citation).toContainText("For a fuller entry, add a field named publisher.");
  await expect(page.locator("main")).not.toContainText(novelWords);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }

  // Compiled: the note cites it short, and the book ends with its bibliography.
  await palette(page, "Compile the text");
  const dialog = page.getByRole("dialog", { name: "Compile the text" });
  await expect(dialog).not.toContainText(novelWords);
  const downloads: Download[] = [];
  page.on("download", (d) => downloads.push(d));
  await dialog.getByRole("button", { name: "Compile" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  const epubDownload = downloads.find((d) => d.suggestedFilename().endsWith(".epub"))!;
  const epub = Object.fromEntries(Object.entries(unzipSync(new Uint8Array(readFileSync((await epubDownload.path())!)))).map(([k, v]) => [k, strFromU8(v)]));
  expect(epub["OEBPS/chapter-002.xhtml"]).toContain("White, Selborne on worms.");
  const back = Object.entries(epub).find(([path, html]) => path.includes("back-") && html.includes("Bibliography"))?.[1];
  expect(back).toContain("Darwin, Charles. <em>The Formation of Vegetable Mould through the Action of Worms.</em> London: John Murray, 1881.");
  expect(back).toContain("White, Gilbert. <em>The Natural History of Selborne.</em> London, 1789.");
});
