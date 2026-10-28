import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { devices, type Page } from "@playwright/test";
import { axe, expect, launch, test } from "./fixtures.ts";

/**
 * Writer on a phone (#53), by touch at 412 px: the shelf, a book opened, its sidebar over the text,
 * writing, the palette from the ⋯ menu, and a sync from the badge; nothing scrolls sideways, and axe
 * finds nothing in light or dark. Chromium's phone emulation: Android's webview is Chromium.
 */

const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices["Pixel 7"]!;
test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });
test.skip(({ browserName }) => browserName !== "chromium", "Phones' webviews are Chromium.");

const STATION = "manuscript/01-return/01-arrival/01-the-station.md";

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function audit(page: Page) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }
}

test("on a phone, by touch: the shelf, a book, its bar and its pages, writing, the palette and a sync", async ({ page, app }) => {
  test.setTimeout(90_000);
  const remote = app.bareRepo("varn.git");
  app.git(app.home, "clone", "-q", remote, join(app.home, "varn"));
  await app.restart(join(app.home, "varn"));
  await launch(page, app);

  // The shelf, from the book the app opened on.
  await page.getByRole("link", { name: "Writer: your books" }).tap();
  await expect(page.getByRole("heading", { level: 1, name: "Your books" })).toBeVisible();
  await fits(page);
  await audit(page);

  // A book, opened by tapping it: no sidebar beside the text, and its bar at the bottom (#100),
  // the novel's pages in it, each a thumb's width.
  await page.getByRole("list", { name: "Books" }).getByRole("link", { name: /The Bridge at Varn/ }).tap();
  const text = page.getByRole("textbox", { name: "Chapter text" });
  await expect(text).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Sidebar" })).toHaveCount(0);
  const bar = page.getByRole("navigation", { name: "Book" });
  await expect(bar.getByRole("link")).toHaveText(["Manuscript", "Outline", "Notes", "Bible"]);
  for (const target of await bar.locator("a, button").all()) expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await fits(page);
  await audit(page);
  // A page from the bar, and back.
  await bar.getByRole("link", { name: "Outline" }).tap();
  await expect(page.getByRole("heading", { level: 1, name: "Outline" })).toBeVisible();
  await expect(bar.getByRole("link", { name: "Outline" })).toHaveAttribute("aria-current", "page");
  await bar.getByRole("link", { name: "Manuscript" }).tap();
  await expect(text).toBeVisible();

  // A scene, from the page's name in the top bar: the chapters folded, the one being read open.
  await page.getByRole("banner").getByRole("button", { name: /^Arrival, in The Bridge at Varn/ }).tap();
  const goTo = page.getByRole("dialog", { name: "Go to a scene" });
  await expect(goTo.getByRole("button", { name: /^Arrival/ })).toHaveAttribute("aria-expanded", "true");
  await expect(goTo.getByRole("button", { name: /^Old Debts/ })).toHaveAttribute("aria-expanded", "false");
  await fits(page);
  await audit(page);
  // Its handle tapped closes it; it opens again from the page's name.
  await goTo.getByRole("button", { name: "Close" }).tap();
  await expect(goTo).toHaveCount(0);
  await page.getByRole("banner").getByRole("button", { name: /^Arrival, in The Bridge at Varn/ }).tap();
  await goTo.getByRole("link", { name: "The Station" }).tap();
  await expect(goTo).toHaveCount(0);

  // Written in, by tapping into the scene's text.
  const scene = page.getByRole("textbox", { name: "Scene text" });
  await scene.tap();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Written on the phone.");
  await expect.poll(() => readFileSync(join(app.home, "varn", STATION), "utf8"), { timeout: 10_000 }).toContain("Written on the phone.");

  // The scene's details, from the bar's More (#100): the right sidebar's, for the piece written in.
  // The keyboard hidden first: the bar gives way to it while writing.
  await page.getByRole("toolbar", { name: "Writing" }).getByRole("button", { name: "Hide the keyboard" }).tap();
  await bar.getByRole("button", { name: "More" }).tap();
  const more = page.getByRole("dialog", { name: "The Bridge at Varn: more" });
  await expect(more.getByRole("region", { name: "This scene" })).toBeVisible();
  // Its handle: dragged down, it closes (#100); dragged a little, it goes back.
  const handle = more.getByRole("button", { name: "Close" });
  const grip = (await handle.boundingBox())!;
  const drag = async (by: number) => {
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + by, { steps: 6 });
    await page.mouse.up();
  };
  await drag(30);
  await expect(more).toBeVisible();
  await drag(200);
  await expect(more).toHaveCount(0);
  await bar.getByRole("button", { name: "More" }).tap();
  await fits(page);
  await audit(page);
  await more.getByRole("button", { name: "Details" }).tap();
  await expect(page.getByRole("tab", { name: "Scene", selected: true })).toBeVisible();
  await fits(page);
  await audit(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab", { name: "Scene" })).toHaveCount(0);

  // The palette, from the ⋯ menu: a command tapped.
  await page.getByRole("banner").getByRole("button", { name: /^More/ }).tap();
  await page.getByRole("menuitem", { name: "Commands…" }).tap();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await fits(page);
  await audit(page);
  await palette.getByRole("option", { name: /^Outline/ }).first().tap();
  await expect(palette).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Outline" })).toBeVisible();
  await fits(page);

  // Synced, from the badge: the words on the remote.
  await page.getByRole("button", { name: /^Sync: / }).tap();
  const sync = page.getByRole("dialog");
  const box = await sync.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  await audit(page);
  await sync.getByRole("button", { name: "Sync now" }).tap();
  await expect.poll(() => app.git(remote, "show", `main:${STATION}`), { timeout: 15_000 }).toContain("Written on the phone.");
});

test("on a phone, Drafts closes by its button, and a book left with Drafts open doesn't open on it", async ({ page, app }) => {
  await app.restart(app.novelRepo("varn"));
  await launch(page, app);
  const drafts = page.getByRole("dialog", { name: "Drafts" });
  // On a phone, from the bar's More (#100).
  const open = async () => {
    await page.getByRole("navigation", { name: "Book" }).getByRole("button", { name: "More" }).tap();
    await page.getByRole("dialog", { name: /: more$/ }).getByRole("button", { name: "Drafts and checkpoints…" }).tap();
  };

  // It fills the screen, with nothing beside it to tap: its own button closes it.
  await open();
  await expect(drafts).toBeVisible();
  await fits(page);
  await audit(page);
  await drafts.getByRole("button", { name: "Close" }).tap();
  await expect(drafts).toHaveCount(0);

  // Left for the shelf while open, as Android's back did: the book opens on its text again.
  await page.getByRole("link", { name: "Writer: your books" }).tap();
  await page.getByRole("list", { name: "Books" }).getByRole("link", { name: /The Bridge at Varn/ }).tap();
  await open();
  await expect(drafts).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Your books" })).toBeVisible();
  await page.getByRole("list", { name: "Books" }).getByRole("link", { name: /The Bridge at Varn/ }).tap();
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeVisible();
  await expect(drafts).toHaveCount(0);
});

test("on a phone, a journal opens on today's entry with the screen to write in, and its bar is arranged from More (#100)", async ({ page, app }) => {
  const dir = app.bookRepo(fileURLToPath(new URL("../../../examples/sample-journal", import.meta.url)), "journal");
  await app.restart(dir);
  await launch(page, app);
  const today = page.getByRole("textbox", { name: "Write today's entry" });
  await expect(today).toBeVisible();
  // The place to write takes most of the screen; the earlier entries are a tap away.
  expect((await page.getByRole("list", { name: "Day by day" }).getByRole("listitem").first().boundingBox())!.height).toBeGreaterThan(viewport.height * 0.6);
  const bar = page.getByRole("navigation", { name: "Book" });
  await expect(bar.getByRole("link")).toHaveText(["Day by day", "Calendar", "Notes", "Index"]);
  await page.getByRole("button", { name: "Earlier entries" }).first().tap();
  await expect(page.getByRole("list", { name: "Day by day" }).getByRole("article").nth(1)).toBeInViewport();

  // Arranged: Relationships in place of Notes, kept in book.yaml.
  await bar.getByRole("button", { name: "More" }).tap();
  await page.getByRole("dialog", { name: /: more$/ }).getByRole("button", { name: "Arrange the bar…" }).tap();
  const arrange = page.getByRole("dialog", { name: "Arrange the bar" });
  await fits(page);
  await audit(page);
  await arrange.getByRole("button", { name: "Take “Notes” out of the bar" }).tap();
  await arrange.getByRole("button", { name: "Put “Relationships” in the bar" }).tap();
  await arrange.getByRole("button", { name: "Save" }).tap();
  await expect(bar.getByRole("link")).toHaveText(["Day by day", "Calendar", "Index", "Relationships"]);
  await expect.poll(() => readFileSync(join(dir, "book.yaml"), "utf8")).toMatch(/bar:\s*\n?\s*- calendar\s+- index\s+- relationships|bar: \[calendar, index, relationships\]/);
});

test("on a phone, Arrange the sidebar fits, from the ⋯ menu, and closes by its button", async ({ page, app }) => {
  await app.restart(app.bookRepo(fileURLToPath(new URL("../../../examples/sample-journal", import.meta.url)), "journal"));
  await launch(page, app);
  // The book open first, on its journal page (#64), which fits: until then the ⋯ menu has only the app's items.
  await expect(page.getByRole("textbox", { name: "Write today's entry" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Day by day" }).getByRole("article").nth(1)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  await page.getByRole("banner").getByRole("button", { name: /^More/ }).tap();
  await page.getByRole("menuitem", { name: "Arrange the sidebar…" }).tap();
  const dialog = page.getByRole("dialog", { name: "Arrange the sidebar" });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  await fits(page);
  await audit(page);
  await dialog.getByRole("button", { name: "Cancel" }).tap();
  await expect(dialog).toHaveCount(0);
});

test("on a phone, writing: the bar on top of the keyboard, every tap leaving the text its focus (#96)", async ({ page, app }) => {
  test.setTimeout(90_000);
  await app.restart(app.novelRepo("varn"));
  await page.goto(app.launchUrl);
  const text = page.getByRole("textbox", { name: "Chapter text" });
  await expect(text).toBeVisible();
  // On GitHub, for Raise an issue… on selected text.
  const id = new URL(page.url()).pathname.split("/")[2]!;
  const headers = { origin: app.url };
  expect((await page.request.post(`${app.url}/api/github/device`, { headers })).ok()).toBe(true);
  app.github.approve();
  await expect.poll(async () => ((await (await page.request.post(`${app.url}/api/github/device/poll`, { headers })).json()) as { status: string }).status).toBe("done");
  expect((await page.request.post(`${app.url}/api/novels/${id}/publish`, { data: { name: "varn" }, headers })).ok()).toBe(true);
  await page.reload();

  const bar = page.getByRole("toolbar", { name: "Writing" });
  const book = page.getByRole("navigation", { name: "Book" });
  // Only while writing, above the book's bar; with the keyboard up (the window made shorter for it,
  // as Android does), in place of it (#100).
  await expect(bar).toHaveCount(0);
  await expect(book).toBeVisible();
  await text.tap();
  await expect(bar).toBeVisible();
  expect((await bar.boundingBox())!.y + (await bar.boundingBox())!.height).toBeLessThanOrEqual((await book.boundingBox())!.y + 1);
  await page.setViewportSize({ width: viewport.width, height: Math.round(viewport.height * 0.6) });
  await expect(book).toHaveCount(0);
  await expect(bar).toBeInViewport();
  await page.setViewportSize(viewport);
  await expect(book).toBeVisible();
  await fits(page);
  await audit(page);
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Rain.");
  await bar.getByRole("button", { name: "Undo" }).tap();
  await expect(text).toBeFocused();
  await expect(text).not.toContainText("Rain.");
  await bar.getByRole("button", { name: "Redo" }).tap();
  await expect(text).toContainText("Rain.");

  // @ in the text, the mention menu open.
  await bar.getByRole("button", { name: "Mention" }).tap();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(text).toBeFocused();

  // The palette, then back to the text with the caret where it was.
  await bar.getByRole("button", { name: "Commands" }).tap();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(text).toBeFocused();
  await page.keyboard.type(" Wind.");
  await expect(text).toContainText("Wind.");

  // Hide the keyboard puts it away: the text lets go of the focus, and the writing bar goes.
  await bar.getByRole("button", { name: "Hide the keyboard" }).tap();
  await expect(text).not.toBeFocused();
  await expect(bar).toHaveCount(0);
  await text.tap();
  await page.keyboard.press("Control+End");

  // A selection's actions while there's one.
  await expect(bar.getByRole("button", { name: "Raise an issue…" })).toHaveCount(0);
  await page.keyboard.press("Shift+Home");
  await bar.getByRole("button", { name: "Raise an issue…" }).tap();
  await expect(page.getByRole("complementary", { name: "Raise an issue" })).toBeVisible();
});
