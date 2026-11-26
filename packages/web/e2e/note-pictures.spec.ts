import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { axe, caretAtEnd, expect, palette, test, type App } from "./fixtures.ts";
import { makePicture, pastePicture, pictureIn } from "./pictures.ts";

/** Pictures in a note (#200), as a scene takes them: added, described, moved, changed and removed, checked in the note's Markdown and images/. */

const IDEA = "notes/what-if-ben-never-sold.md";
const PROSE = "Then [Ada](#char_7f3k2q) has no reason to come home, and the bridge stands. Unless the debt goes back to [the flood](#evt_9ab3kd).";

async function openNote(page: Page, app: App) {
  const dir = app.novelRepo("varn");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused();
  await palette(page, "note: what if ben");
  const prose = page.getByRole("textbox", { name: "Note: What if Ben never sold the plans?" });
  await expect(prose).toBeVisible();
  return { dir, prose, read: () => readFileSync(join(dir, IDEA), "utf8"), exists: (path: string) => existsSync(join(dir, path)) };
}

test("Add a picture, a paste and a drop, each described; moved by keyboard; described, changed and removed from its toolbar", async ({ page, app }) => {
  const note = await openNote(page, app);
  const insert = page.getByRole("dialog", { name: "Insert a picture" });

  // Add a picture, at the caret: chosen, resized, described and captioned.
  await caretAtEnd(page, note.prose);
  const bytes = await makePicture(page, { width: 2400, height: 1600, name: "plans.jpg" });
  await page.getByRole("button", { name: "Add a picture" }).click();
  const chooser = page.waitForEvent("filechooser");
  await insert.getByRole("button", { name: "Choose a picture…" }).click();
  await (await chooser).setFiles({ name: "plans.jpg", mimeType: "image/jpeg", buffer: bytes });
  await expect(insert).toContainText("plans.jpg · 2400 × 1600 px");
  await insert.getByLabel("Description").fill("Ben's plans of the bridge");
  await insert.getByLabel("Caption (optional)").fill("The copy he kept");
  await insert.getByRole("button", { name: "Insert" }).click();
  await expect(insert).toBeHidden();
  const plans = '![Ben\'s plans of the bridge](/images/bens-plans-of-the-bridge.jpg "The copy he kept")';
  await expect(note.prose.getByRole("img", { name: "Ben's plans of the bridge" })).toBeVisible();
  await page.keyboard.type("Where are they now?");
  await expect.poll(note.read).toContain(`${PROSE}\n\n${plans}\n\nWhere are they now?\n`);
  expect(pictureIn(note.dir, "images/bens-plans-of-the-bridge.jpg")).toEqual({ type: "image/jpeg", width: 1600, height: 1067 });

  // Pasted at the caret.
  await makePicture(page, { width: 600, height: 400, type: "image/png", name: "seal.png" });
  await pastePicture(page);
  await expect(insert.getByLabel("Description")).toBeFocused();
  await page.keyboard.type("The toll seal");
  await expect(insert).toContainText(/Saved as images\/the-toll-seal\.jpg/);
  await expect(insert.getByRole("button", { name: "Insert" })).toBeEnabled();
  await page.keyboard.press("Enter");
  await expect(insert).toBeHidden();
  await expect.poll(note.read).toContain("Where are they now?\n\n![The toll seal](/images/the-toll-seal.jpg)\n");

  // Dropped on the first paragraph: it goes in after it.
  await makePicture(page, { width: 800, height: 1000, name: "letter.jpg" });
  const first = note.prose.locator("p").first();
  const box = (await first.boundingBox())!;
  const data = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add((window as unknown as { __picture: File }).__picture);
    return transfer;
  });
  const at = { clientX: box.x + 10, clientY: box.y + box.height / 2 };
  await first.dispatchEvent("dragover", { dataTransfer: data, ...at });
  await first.dispatchEvent("drop", { dataTransfer: data, ...at });
  await insert.getByLabel("Description").fill("Mirela's letter");
  await insert.getByRole("button", { name: "Insert" }).click();
  await expect(insert).toBeHidden();
  await expect.poll(note.read).toContain(`${PROSE}\n\n![Mirela's letter](/images/mirelas-letter.jpg)\n\n${plans}`);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }

  // Selected, Alt+↓ moves it past the next picture, and Alt+↑ back.
  const letter = note.prose.getByRole("img", { name: "Mirela's letter" });
  await letter.click();
  await expect(note.prose.locator(".ghw-picture.ProseMirror-selectednode")).toHaveCount(1);
  await expect(note.prose).toBeFocused();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(note.read).toContain(`${PROSE}\n\n${plans}\n\n![Mirela's letter](/images/mirelas-letter.jpg)\n\nWhere are they now?`);
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(note.read).toContain(`${PROSE}\n\n![Mirela's letter](/images/mirelas-letter.jpg)\n\n${plans}`);

  // Its toolbar: Describe…
  const toolbar = page.getByRole("toolbar", { name: "Picture" });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "Describe…" }).click();
  const change = page.getByRole("dialog", { name: "Change the picture" });
  await expect(change.getByLabel("Description")).toHaveValue("Mirela's letter");
  await change.getByLabel("Description").fill("Mirela's letter to Ada");
  await change.getByRole("button", { name: "Save" }).click();
  await expect(change).toBeHidden();
  await expect.poll(note.read).toContain("![Mirela's letter to Ada](/images/mirelas-letter.jpg)");

  // …Change…, another picture in its place, the one it showed deleted.
  await note.prose.getByRole("img", { name: "Mirela's letter to Ada" }).click();
  await toolbar.getByRole("button", { name: "Change…" }).click();
  await expect(change.getByRole("button", { name: "Choose another…" })).toBeFocused();
  const another = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await another).setFiles({ name: "letter-2.jpg", mimeType: "image/jpeg", buffer: await makePicture(page, { width: 900, height: 900, name: "letter-2.jpg" }) });
  await expect(change).toContainText("letter-2.jpg · 900 × 900 px");
  await change.getByRole("button", { name: "Save" }).click();
  await expect(change).toBeHidden();
  await expect.poll(note.read).toContain("![Mirela's letter to Ada](/images/mirelas-letter-to-ada.jpg)");
  await expect.poll(() => note.exists("images/mirelas-letter.jpg")).toBe(false);
  expect(pictureIn(note.dir, "images/mirelas-letter-to-ada.jpg")).toEqual({ type: "image/jpeg", width: 900, height: 900 });

  // …and Remove, its file with it.
  await note.prose.getByRole("img", { name: "Mirela's letter to Ada" }).click();
  await toolbar.getByRole("button", { name: "Remove" }).click();
  await expect(note.prose.getByRole("img", { name: "Mirela's letter to Ada" })).toHaveCount(0);
  await expect(toolbar).toBeHidden();
  await expect.poll(note.read).toContain(`${PROSE}\n\n${plans}`);
  await expect.poll(() => note.exists("images/mirelas-letter-to-ada.jpg")).toBe(false);
});

test("Insert a picture… in the palette, and a picture described, moved and removed by keyboard alone", async ({ page, app }) => {
  const note = await openNote(page, app);
  await caretAtEnd(page, note.prose);
  const bytes = await makePicture(page, { width: 400, height: 300, name: "ford.jpg" });
  await palette(page, "Insert a picture");
  const insert = page.getByRole("dialog", { name: "Insert a picture" });
  await expect(insert.getByRole("button", { name: "Choose a picture…" })).toBeFocused();
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles({ name: "ford.jpg", mimeType: "image/jpeg", buffer: bytes });
  await expect(insert).toContainText("ford.jpg · 400 × 300 px");
  await insert.getByLabel("Description").fill("The ford");
  await expect(insert).toContainText(/Saved as images\/the-ford\.jpg/);
  await expect(insert.getByRole("button", { name: "Insert" })).toBeEnabled();
  await page.keyboard.press("Enter");
  await expect(insert).toBeHidden();
  await expect(note.prose).toBeFocused();
  await expect.poll(note.read).toContain(`${PROSE}\n\n![The ford](/images/the-ford.jpg)\n`);

  // ↑ selects it; Enter describes it.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  const change = page.getByRole("dialog", { name: "Change the picture" });
  await expect(change.getByLabel("Description")).toBeFocused();
  await page.keyboard.type(" at dawn");
  await page.keyboard.press("Enter");
  await expect(change).toBeHidden();
  await expect.poll(note.read).toContain("![The ford at dawn](/images/the-ford.jpg)");
  // Alt+↑ puts it before the words; Delete takes it, and its file.
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(note.read).toMatch(/---\n!\[The ford at dawn\]\(\/images\/the-ford\.jpg\)\n\nThen \[Ada\]/);
  await page.keyboard.press("Delete");
  await expect.poll(note.read).not.toContain("the-ford");
  await expect.poll(() => note.exists("images/the-ford.jpg")).toBe(false);
});

test("pictures on neighbouring lines show as a row, one a line at a phone's width, each its own line in the file (#201)", async ({ page, app }) => {
  const dir = app.novelRepo("varn");
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const lines = ["![The north bank](/images/north.jpg)", "![The south bank](/images/south.jpg)"];
  const body = `${readFileSync(join(dir, IDEA), "utf8").trimEnd()}\n\n${lines.join("\n\n")}\n`;
  writeFileSync(join(dir, IDEA), body);
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused();
  mkdirSync(join(dir, "images"), { recursive: true });
  for (const [name, shade] of [["north", 1], ["south", 2]] as const) writeFileSync(join(dir, `images/${name}.jpg`), await makePicture(page, { width: 1200 + shade, height: 800, name: `${name}.jpg` }));
  await palette(page, "note: what if ben");
  const prose = page.getByRole("textbox", { name: "Note: What if Ben never sold the plans?" });
  const north = prose.getByRole("img", { name: "The north bank" });
  const south = prose.getByRole("img", { name: "The south bank" });
  await expect(south).toBeVisible();
  // Side by side: the same top, the second to the right.
  await expect.poll(async () => [(await north.boundingBox())!.y === (await south.boundingBox())!.y, (await south.boundingBox())!.x > (await north.boundingBox())!.x]).toEqual([true, true]);
  // By keyboard, in order: → from the first goes on to the second (past the gap between them), ← back.
  const selected = prose.locator(".ProseMirror-selectednode img");
  await north.click();
  await expect(selected).toHaveAttribute("alt", "The north bank");
  await expect(async () => {
    await page.keyboard.press("ArrowRight");
    await expect(selected).toHaveAttribute("alt", "The south bank", { timeout: 200 });
  }).toPass({ timeout: 3000 });
  await expect(async () => {
    await page.keyboard.press("ArrowLeft");
    await expect(selected).toHaveAttribute("alt", "The north bank", { timeout: 200 });
  }).toPass({ timeout: 3000 });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }
  // At a phone's width, one a line.
  await page.setViewportSize({ width: 375, height: 800 });
  await expect.poll(async () => (await south.boundingBox())!.y > (await north.boundingBox())!.y + (await north.boundingBox())!.height - 1).toBe(true);
  // The file is as it was.
  expect(readFileSync(join(dir, IDEA), "utf8")).toBe(body);
});

test("the Notes gallery shows a note's first picture and how many it has, and With pictures keeps only those (#202)", async ({ page, app }) => {
  const dir = app.novelRepo("varn");
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const add = (file: string, lines: string[]) => writeFileSync(join(dir, file), `${readFileSync(join(dir, file), "utf8").trimEnd()}\n\n${lines.join("\n\n")}\n`);
  add(IDEA, ["![Ben's plans](/images/plans.jpg)", "![The toll seal](/images/seal.jpg)"]);
  add("notes/the-varn-bridge.md", ["![The bridge at dusk](/images/bridge.jpg)"]);
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused();
  mkdirSync(join(dir, "images"), { recursive: true });
  for (const name of ["plans", "seal", "bridge"]) writeFileSync(join(dir, `images/${name}.jpg`), await makePicture(page, { width: 1200, height: 800, name: `${name}.jpg` }));

  await palette(page, "note: what if ben");
  await expect(page.getByRole("textbox", { name: "Note: What if Ben never sold the plans?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { level: 1, name: /^Notes/ })).toBeVisible();
  const cards = page.getByRole("list", { name: "Notes" }).getByRole("listitem");
  const idea = cards.filter({ hasText: "What if Ben never sold the plans?" });
  const bridge = cards.filter({ hasText: "The Varn Bridge" });
  // The first picture, shown first but read after the title and words; "2 pictures" when it has more than one.
  await expect(idea.locator("img")).toHaveAttribute("src", /\/images\/plans\.jpg$/);
  await expect.poll(() => idea.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(1200);
  await expect(idea).toContainText("2 pictures");
  await expect(bridge.locator("img")).toHaveAttribute("src", /\/images\/bridge\.jpg$/);
  await expect(bridge).not.toContainText("pictures");
  expect((await idea.getByRole("link").textContent())!.startsWith("What if Ben never sold the plans?Then Ada")).toBe(true);
  // A note without pictures is words only.
  await expect(cards.filter({ hasText: "Tomas Hale" }).locator("img")).toHaveCount(0);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }

  // With pictures: only those, kept in the address.
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("checkbox", { name: "With pictures" }).click();
  await expect(page.getByRole("checkbox", { name: "With pictures" })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Filter · 1" })).toBeFocused();
  await expect(cards.locator("span.font-semibold")).toHaveText(["The Varn Bridge", "What if Ben never sold the plans?"]);
  await expect(page.getByRole("status").filter({ hasText: "notes match" })).toHaveText("2 notes match");
  await expect(page).toHaveURL(/[?&]pictures=1/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Remove the filter: With pictures" })).toBeVisible();
  await expect(cards).toHaveCount(2);
  await page.getByRole("button", { name: "Remove the filter: With pictures" }).click();
  await expect(cards).toHaveCount(6);
  await expect(page).not.toHaveURL(/pictures=/);
});
