import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { devices, type Locator, type Page } from "@playwright/test";
import { axe, expect, launch, test } from "./fixtures.ts";
import { makePicture } from "./pictures.ts";

/**
 * Writer on a phone (#53), by touch at 412 px: the shelf, a book opened, its sidebar over the text,
 * writing, the palette from the ⋯ menu, and a sync from the badge; nothing scrolls sideways, and axe
 * finds nothing in light or dark. Chromium's phone emulation: Android's webview is Chromium.
 */

const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices["Pixel 7"]!;
test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });
test.skip(({ browserName }) => browserName !== "chromium", "Phones' webviews are Chromium.");

const STATION = "manuscript/01-return/01-arrival/01-the-station.md";

/** Nothing wider than the phone's screen: measured against the screen, since a page wider than it widens the window too (the phone zooms out to fit it). */
async function fits(page: Page) {
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, innerWidth))).toBeLessThanOrEqual(page.viewportSize()!.width);
}

async function audit(page: Page) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }
}

/**
 * Real touches, as the phone's, so the browser's own panning (touch-action) has its say too, each
 * with its own time, so a flick is one however busy the machine is. The swipe: a finger down on the
 * middle of `on`, drawn by (dx, dy) in `steps` moves `ms` apart, held `hold` ms, and lifted.
 */
async function finger(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", timestamp: number, at?: { x: number; y: number }) =>
    cdp.send("Input.dispatchTouchEvent", { type, timestamp, touchPoints: at ? [at] : [] });
  return async (on: { x: number; y: number; width: number; height: number }, dx: number, dy: number, { steps = 10, ms = 30, hold = 150 } = {}) => {
    const x = on.x + on.width / 2;
    const y = on.y + on.height / 2;
    let at = Date.now() / 1000;
    await touch("touchStart", at, { x, y });
    for (let i = 1; i <= steps; i++) await touch("touchMove", (at += ms / 1000), { x: x + (dx * i) / steps, y: y + (dy * i) / steps });
    await touch("touchEnd", (at += hold / 1000));
  };
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
  // Settled back before it's taken again: sliding, the grip isn't under the place it was.
  await expect(more).toHaveCSS("transform", "none");
  await drag(200);
  await expect(more).toHaveCount(0);
  await bar.getByRole("button", { name: "More" }).tap();
  await fits(page);
  await audit(page);
  await more.getByRole("button", { name: "Details" }).tap();
  await expect(page.getByRole("tab", { name: "Scene", exact: true, selected: true })).toBeVisible();
  await fits(page);
  await audit(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab", { name: "Scene", exact: true })).toHaveCount(0);

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

test("on a phone, the right sidebar swipes closed: drawn far enough or flicked, not a little, not up and down, not in a field (#109)", async ({ page, app }) => {
  await app.restart(app.novelRepo("varn"));
  await launch(page, app);
  const sheet = page.getByRole("complementary", { name: "Right sidebar" });
  const tab = page.getByRole("tab", { name: "Scene", exact: true });
  const open = async () => {
    await page.getByRole("navigation", { name: "Book" }).getByRole("button", { name: "More" }).tap();
    await page.getByRole("dialog", { name: /: more$/ }).getByRole("button", { name: "Details" }).tap();
    await expect(tab).toBeVisible();
  };
  const swipe = await finger(page);

  // Drawn a little and held: it slides back.
  await open();
  await swipe((await tab.boundingBox())!, 60, 0);
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveCSS("transform", "none");
  // Up and down, and mostly so: the browser's, to scroll; the sheet stays where it is.
  await swipe((await tab.boundingBox())!, 0, 200);
  await swipe((await tab.boundingBox())!, 40, 200);
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveCSS("transform", "none");
  // In a field it edits, never closes.
  await sheet.getByRole("button", { name: "Edit synopsis" }).tap();
  await swipe((await sheet.getByRole("textbox", { name: "Synopsis" }).boundingBox())!, 250, 0);
  await expect(sheet).toBeVisible();
  // A mouse selects, as it would anywhere.
  const box = (await tab.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 250, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(sheet).toBeVisible();

  // Past a third of its width: it goes, with the dimmed text behind it.
  await swipe((await tab.boundingBox())!, 200, 10);
  await expect(sheet).toHaveCount(0);
  await expect(page.locator(".bg-black\\/30")).toHaveCount(0);
  // Flicked, however short (90 px of its 370, at about 2 px/ms).
  await open();
  await swipe((await tab.boundingBox())!, 90, 0, { steps: 3, ms: 16, hold: 0 });
  await expect(sheet).toHaveCount(0);
  // Without the slide, for whoever asks for less motion. Opened again at once: the first tap after a
  // flick once only stopped the browser's fling of it.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open();
  await swipe((await tab.boundingBox())!, 200, 0);
  await expect(sheet).toHaveCount(0);
  // Its button still closes it, and it opens again on the same tab.
  await open();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await sheet.getByRole("button", { name: "Hide the right sidebar" }).tap();
  await expect(sheet).toHaveCount(0);

  // On a wide screen the sidebar beside the text doesn't swipe.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(sheet).toBeVisible();
  await swipe((await sheet.getByRole("tab", { name: "Scene", exact: true }).boundingBox())!, 200, 0);
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveCSS("transform", "none");
});

test("on a phone, a journal's right sidebar keeps its scrolling to itself, and swipes closed (#109)", async ({ page, app }) => {
  await app.restart(app.bookRepo(fileURLToPath(new URL("../../../examples/sample-journal", import.meta.url)), "journal"));
  await launch(page, app);
  await expect(page.getByRole("textbox", { name: "Write today's entry" })).toBeVisible();
  const swipe = await finger(page);
  await page.getByRole("navigation", { name: "Book" }).getByRole("button", { name: "More" }).tap();
  await page.getByRole("dialog", { name: /: more$/ }).getByRole("button", { name: "Details" }).tap();
  const sheet = page.getByRole("complementary", { name: "Right sidebar" });
  const panel = sheet.getByRole("tabpanel");
  await expect(panel).toBeVisible();
  const pageScrolled = () => page.evaluate(() => document.scrollingElement!.scrollTop);

  // Drawn up, with nothing in it to scroll, from its middle and its foot: the entries beneath stay
  // where they are (they scrolled, on the owner's phone).
  expect(await panel.evaluate((e) => e.scrollHeight <= e.clientHeight)).toBe(true);
  const box = (await panel.boundingBox())!;
  for (const from of [0.5, 0.85]) {
    await swipe({ x: box.x, y: box.y + box.height * from, width: box.width, height: 0 }, 0, -300);
    await page.waitForTimeout(300);
    expect(await pageScrolled()).toBe(0);
  }
  // Longer than the screen, it scrolls in itself, and still not the entries.
  const details = await panel.evaluate((e) => (e.firstElementChild as HTMLElement).offsetHeight);
  await page.setViewportSize({ width: viewport.width, height: Math.round(details * 0.75) });
  await expect.poll(() => panel.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
  const short = (await panel.boundingBox())!;
  await swipe({ ...short, height: short.height / 2, y: short.y + short.height / 2 }, 0, -150);
  await expect.poll(() => panel.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  expect(await pageScrolled()).toBe(0);

  // Drawn to the right, from its tabs: it goes.
  await swipe((await sheet.getByRole("tab").first().boundingBox())!, 200, 0);
  await expect(sheet).toHaveCount(0);
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
  expect((await page.getByRole("list", { name: "Journal" }).getByRole("listitem").first().boundingBox())!.height).toBeGreaterThan(viewport.height * 0.6);
  const bar = page.getByRole("navigation", { name: "Book" });
  await expect(bar.getByRole("link")).toHaveText(["Journal", "Calendar", "Notes", "Index"]);
  await page.getByRole("button", { name: "Earlier entries" }).first().tap();
  await expect(page.getByRole("list", { name: "Journal" }).getByRole("article").nth(1)).toBeInViewport();

  // Arranged: Relationships in place of Notes, kept in book.yaml.
  await bar.getByRole("button", { name: "More" }).tap();
  await page.getByRole("dialog", { name: /: more$/ }).getByRole("button", { name: "Arrange the bar…" }).tap();
  const arrange = page.getByRole("dialog", { name: "Arrange the bar" });
  await fits(page);
  await audit(page);
  await arrange.getByRole("button", { name: "Take “Notes” out of the bar" }).tap();
  await arrange.getByRole("button", { name: "Put “Relationships” in the bar" }).tap();
  await arrange.getByRole("button", { name: "Save" }).tap();
  await expect(bar.getByRole("link")).toHaveText(["Journal", "Calendar", "Index", "Relationships"]);
  await expect.poll(() => readFileSync(join(dir, "book.yaml"), "utf8")).toMatch(/bar:\s*\n?\s*- calendar\s+- index\s+- relationships|bar: \[calendar, index, relationships\]/);
});

test("on a phone, Arrange the sidebar fits, from the ⋯ menu, and closes by its button", async ({ page, app }) => {
  await app.restart(app.bookRepo(fileURLToPath(new URL("../../../examples/sample-journal", import.meta.url)), "journal"));
  await launch(page, app);
  // The book open first, on its journal page (#64), which fits: until then the ⋯ menu has only the app's items.
  await expect(page.getByRole("textbox", { name: "Write today's entry" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Journal" }).getByRole("article").nth(1)).toBeVisible();
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

// The palette has what it has on a wide screen, though the tree that's beside the text there isn't here.
for (const [sample, name, section, piece] of [
  ["sample-novel", "novel", "chapter", "scene"],
  ["sample-campaign", "campaign", "arc", "session"],
  ["sample-nonfiction", "nonfiction", "chapter", "section"],
] as const) {
  test(`on a phone, the palette adds its sections and pieces to a ${name}, with the notice leaving the bar free`, async ({ page, app }) => {
    const dir = app.bookRepo(fileURLToPath(new URL(`../../../examples/${sample}`, import.meta.url)), name);
    await app.restart(dir);
    await launch(page, app);
    await expect(page.getByRole("navigation", { name: "Book" })).toBeVisible();
    const command = async (title: string) => {
      await page.getByRole("navigation", { name: "Book" }).getByRole("button", { name: "More" }).tap();
      await page.getByRole("dialog", { name: /: more$/ }).getByRole("button", { name: "Commands…" }).tap();
      const palette = page.getByRole("dialog", { name: "Command palette" });
      await palette.getByRole("combobox").fill(title);
      await palette.getByRole("option", { name: new RegExp(`^${title}`) }).first().tap();
    };
    await command(`New ${section}`);
    await page.getByRole("dialog", { name: `New ${section}` }).getByRole("textbox").fill("Added on the phone");
    await fits(page);
    await page.getByRole("dialog", { name: `New ${section}` }).getByRole("button", { name: new RegExp(`^Add ${section}`, "i") }).tap();
    await expect(page.getByRole("heading", { level: 1, name: "Added on the phone" })).toBeVisible();

    await command(`New ${piece}`);
    await page.getByRole("dialog", { name: `New ${piece}` }).getByRole("textbox").fill("Its first");
    await page.getByRole("dialog", { name: `New ${piece}` }).getByRole("button", { name: new RegExp(`^Add ${piece}`, "i") }).tap();
    await expect(page.getByRole("heading", { level: 1, name: "Its first" })).toBeVisible();
  });
}

test("on a phone, the top bar is the page's name, and the dropdown names the book (#115)", async ({ page, app }) => {
  await app.restart(app.novelRepo("varn"));
  await launch(page, app);
  const banner = page.getByRole("banner");
  await expect(banner.getByRole("group", { name: "History" })).toHaveCount(0);
  const name = banner.getByRole("button", { name: "Arrival, in The Bridge at Varn: go to a scene" });
  expect((await name.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await name.tap();
  const goTo = page.getByRole("dialog", { name: "Go to a scene" });
  await expect(goTo.getByText("The Bridge at Varn", { exact: true })).toBeVisible();
  await audit(page);

  // A long name fits.
  await goTo.getByRole("button", { name: "New chapter" }).tap();
  const dialog = page.getByRole("dialog", { name: "New chapter" });
  await dialog.getByRole("textbox").fill("A chapter whose title is much too long to fit in the top bar of any phone");
  await dialog.getByRole("button", { name: "Add chapter" }).tap();
  await expect(page.getByRole("heading", { level: 1, name: /^A chapter whose title/ })).toBeVisible();
  await fits(page);
});

test("on a phone, the dropdown adds a scene to any chapter, and a chapter after the last (#116)", async ({ page, app }) => {
  const dir = app.novelRepo("varn");
  await app.restart(dir);
  await launch(page, app);
  const open = () => page.getByRole("banner").getByRole("button", { name: /go to a scene$/ }).tap();
  const goTo = page.getByRole("dialog", { name: "Go to a scene" });

  await open();
  await goTo.getByRole("button", { name: /^Old Debts/ }).tap();
  const add = goTo.getByRole("button", { name: "New scene in Old Debts" });
  expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await add.tap();
  await fits(page);
  await audit(page);
  const scene = page.getByRole("dialog", { name: "New scene" });
  await scene.getByRole("textbox").fill("From the dropdown");
  await scene.getByRole("button", { name: "Add scene" }).tap();
  await expect(page.getByRole("heading", { level: 1, name: "From the dropdown" })).toBeVisible();
  await expect(goTo).toHaveCount(0);
  // At the end of the chapter it was asked of, though another was open.
  const id = /\/scene\/([^/?]+)/.exec(page.url())![1]!;
  await expect.poll(() => readFileSync(join(dir, "manuscript/01-return/02-old-debts/_chapter.yaml"), "utf8")).toMatch(new RegExp(`${id}\\s*\\]?\\s*$`));

  await open();
  await goTo.getByRole("button", { name: "New chapter" }).tap();
  const chapter = page.getByRole("dialog", { name: "New chapter" });
  await chapter.getByRole("textbox").fill("After the last");
  await chapter.getByRole("button", { name: "Add chapter" }).tap();
  await expect(page.getByRole("heading", { level: 1, name: "After the last" })).toBeVisible();
  await open();
  // The last of the list, whichever was open.
  await expect(goTo.getByRole("list", { name: "Manuscript" }).getByRole("button", { name: /^(?!New )/ }).last()).toContainText("After the last");
});

for (const [sample, name, section, piece] of [
  ["sample-campaign", "campaign", "arc", "session"],
  ["sample-nonfiction", "nonfiction", "chapter", "section"],
] as const) {
  test(`on a phone, the dropdown adds in a ${name}'s words (#116)`, async ({ page, app }) => {
    await app.restart(app.bookRepo(fileURLToPath(new URL(`../../../examples/${sample}`, import.meta.url)), name));
    await launch(page, app);
    await page.getByRole("banner").getByRole("button", { name: new RegExp(`go to a ${piece}$`) }).tap();
    const goTo = page.getByRole("dialog", { name: `Go to a ${piece}` });
    await goTo.getByRole("button", { name: new RegExp(`^New ${piece} in `) }).first().tap();
    const dialog = page.getByRole("dialog", { name: `New ${piece}` });
    await dialog.getByRole("textbox").fill("From the dropdown");
    await dialog.getByRole("button", { name: `Add ${piece}` }).tap();
    await expect(page.getByRole("heading", { level: 1, name: "From the dropdown" })).toBeVisible();
    await page.getByRole("banner").getByRole("button", { name: new RegExp(`go to a ${piece}$`) }).tap();
    await expect(goTo.getByRole("button", { name: `New ${section}` })).toBeVisible();
  });
}

test("on a phone, a journal's dropdown has Today's entry and no New (#116)", async ({ page, app }) => {
  await app.restart(app.bookRepo(fileURLToPath(new URL("../../../examples/sample-journal", import.meta.url)), "journal"));
  await launch(page, app);
  await page.getByRole("banner").getByRole("button", { name: /go to an entry$/ }).tap();
  const goTo = page.getByRole("dialog", { name: "Go to an entry" });
  await expect(goTo.getByRole("link", { name: "Today's entry" })).toBeVisible();
  await expect(goTo.getByRole("button", { name: /^New / })).toHaveCount(0);
});

test("on a phone, the outline adds in place by touch, the focus kept between titles; a journal's adds nothing (#117)", async ({ page, app }) => {
  await app.restart(app.novelRepo("varn"));
  await launch(page, app);
  const bar = page.getByRole("navigation", { name: "Book" });
  await bar.getByRole("link", { name: "Outline" }).tap();
  await page.getByRole("button", { name: "New scene in Arrival" }).tap();
  const field = page.getByRole("textbox", { name: "Title: New scene in Arrival" });
  await expect(field).toBeFocused();
  await expect(field).toBeInViewport();
  await fits(page);
  await audit(page);
  for (const title of ["One by thumb", "Two by thumb"]) {
    await field.fill(title);
    await page.getByRole("button", { name: "Add", exact: true }).tap();
    await expect(page.getByRole("link", { name: title })).toBeVisible();
    await expect(field).toBeFocused();
    await expect(field).toBeInViewport();
  }

  await app.restart(app.bookRepo(fileURLToPath(new URL("../../../examples/sample-journal", import.meta.url)), "journal"));
  await launch(page, app);
  await page.goto(new URL(page.url()).href.replace(/\/novels\/([^/]+).*$/, "/novels/$1/outline/table"));
  await expect(page.getByRole("heading", { level: 1, name: "Outline" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^New / })).toHaveCount(0);
});

// What a page's end does to the bottom bar: nothing is left under it, and a short page's bar reaches it.
const scrolledToEnd = (page: Page) => page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
const barTop = async (page: Page) => (await page.getByRole("navigation", { name: "Book" }).boundingBox())!.y;

test("on a phone, a long page scrolls clear of the bottom bar: notes and the outline", async ({ page, app }) => {
  await page.setViewportSize({ width: 412, height: 420 });
  await app.restart(app.novelRepo("varn"));
  await launch(page, app);
  const bar = page.getByRole("navigation", { name: "Book" });

  await bar.getByRole("link", { name: "Outline" }).tap();
  const last = page.getByRole("button", { name: "New chapter" });
  await expect(last).toBeVisible();
  await scrolledToEnd(page);
  await expect.poll(async () => (await last.boundingBox())!.y + (await last.boundingBox())!.height).toBeLessThanOrEqual(await barTop(page));

  await bar.getByRole("link", { name: "Notes" }).tap();
  await expect(page.getByRole("heading", { level: 1, name: "Notes" })).toBeVisible();
  const lastNote = page.locator('a[href*="/note/"]').last();
  await expect(lastNote).toBeAttached();
  await scrolledToEnd(page);
  await expect.poll(async () => (await lastNote.boundingBox())!.y + (await lastNote.boundingBox())!.height).toBeLessThanOrEqual(await barTop(page));
});

test("on a phone, a short scene's bar sits on the bottom bar, and on the keyboard while it's up", async ({ page, app }) => {
  await app.restart(app.novelRepo("varn"));
  await launch(page, app);
  await page.getByRole("banner").getByRole("button", { name: /go to a scene$/ }).tap();
  await page.getByRole("dialog", { name: "Go to a scene" }).getByRole("button", { name: /^New scene in / }).first().tap();
  const dialog = page.getByRole("dialog", { name: "New scene" });
  await dialog.getByRole("textbox").fill("Hardly begun");
  await dialog.getByRole("button", { name: "Add scene" }).tap();
  await expect(page.getByRole("heading", { level: 1, name: "Hardly begun" })).toBeVisible();

  // The keyboard away: the status bar, right on the bottom bar.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const status = page.getByRole("group", { name: "This session" }).locator("..");
  await expect(status).toBeVisible();
  await expect.poll(async () => Math.abs((await status.boundingBox())!.y + (await status.boundingBox())!.height - (await barTop(page)))).toBeLessThanOrEqual(2);
  // And nothing to scroll on a page this short.
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);

  // The keyboard up, as Android makes it: the window shorter, the bottom bar gone, the writing bar at its foot.
  const size = page.viewportSize()!;
  await page.getByRole("textbox", { name: "Scene text" }).tap();
  await page.setViewportSize({ width: size.width, height: Math.round(size.height * 0.6) });
  await expect(page.getByRole("navigation", { name: "Book" })).toHaveCount(0);
  const writing = page.getByRole("toolbar", { name: "Writing" });
  await expect.poll(async () => Math.abs((await writing.locator("..").boundingBox())!.y + (await writing.locator("..").boundingBox())!.height - Math.round(size.height * 0.6))).toBeLessThanOrEqual(2);
});

test("on a phone, Quick look is in More and fills the screen (#141, #174)", async ({ page, app }) => {
  await app.restart(app.novelRepo("varn"));
  await launch(page, app);
  await page.getByRole("navigation", { name: "Book" }).getByRole("button", { name: "More" }).tap();
  await page.getByRole("dialog", { name: /: more$/ }).getByRole("button", { name: "Quick look…" }).tap();
  const look = page.getByRole("dialog", { name: "Quick look" });
  await expect(look).toBeVisible();
  const box = (await look.boundingBox())!;
  expect([box.x, box.y, box.width]).toEqual([0, 0, viewport.width]);
  await page.keyboard.type("ada");
  await expect(look.getByRole("article", { name: "Ada Varn" })).toContainText("Bridge engineer");
  await fits(page);
  await audit(page);
});

test("on a phone, the index: the types as chips scrolling sideways, the rest under Filter, no Table, and back to the list where it was (#175)", async ({ page, app }) => {
  await page.setViewportSize({ width: viewport.width, height: 600 });
  await app.restart(app.novelRepo("varn"));
  await launch(page, app);
  await page.getByRole("navigation", { name: "Book" }).getByRole("link", { name: "Bible" }).tap();
  await expect(page.getByRole("heading", { level: 1, name: "Story bible" })).toBeVisible();

  // The types, a row of their own that scrolls sideways (not the page); no Table at a phone's width.
  const types = page.getByRole("group", { name: "Types" });
  await expect(types.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  expect(await types.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
  await expect(page.getByRole("group", { name: "Show as" }).getByRole("button")).toHaveText(["List", "Cards"]);
  await fits(page);
  // Every control a finger's size.
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('h1 + div button, [role=group] button, input[type=search], select, section[aria-labelledby^="type-"] a, section[aria-labelledby^="type-"] button')]
      .filter((el) => el.getBoundingClientRect().height < 44)
      .map((el) => el.getAttribute("aria-label") ?? el.textContent),
  );
  expect(small).toEqual([]);

  // A type on and off; the other filters under Filter, without the types.
  await types.getByRole("button", { name: "Characters" }).tap();
  await expect(types.getByRole("button", { name: "Characters" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("section[aria-labelledby^='type-']")).toHaveCount(1);
  await page.getByRole("group", { name: "Filters" }).getByRole("button", { name: "Filter" }).tap();
  await expect(page.getByRole("dialog", { name: /^Filter the / }).getByLabel("By").locator("option")).not.toContainText(["Type"]);
  await page.keyboard.press("Escape");
  await types.getByRole("button", { name: "All" }).tap();
  await expect(page.locator("section[aria-labelledby^='type-']")).not.toHaveCount(1);
  await page.getByLabel("Sort").selectOption("name");

  // Down the list to an entry, and back (as Android's back does, and by the entry's own way back): the list where it was, its row in focus.
  const row = page.getByRole("link", { name: /^Trust/ });
  await row.scrollIntoViewIfNeeded();
  const top = await page.evaluate(() => scrollY);
  expect(top).toBeGreaterThan(0);
  await row.tap();
  await expect(page.getByRole("heading", { level: 1, name: "Trust" })).toBeVisible();
  await page.goBack();
  await expect(row).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(top);
  await row.tap();
  await page.locator("#index-entry").getByRole("link", { name: "Story bible" }).first().tap();
  await expect(row).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(top);
  await expect(page).toHaveURL(/sort=name/);
  await audit(page);
});

test("on a phone, a journal's index puts the people last written about first (#175)", async ({ page, app }) => {
  await app.restart(app.bookRepo(fileURLToPath(new URL("../../../examples/sample-journal", import.meta.url)), "journal"));
  await launch(page, app);
  await page.getByRole("navigation", { name: "Book" }).getByRole("link", { name: "Index" }).tap();
  await expect(page.getByLabel("Sort")).toHaveValue("last");
  await page.getByRole("group", { name: "Types" }).getByRole("button", { name: "People" }).tap();
  await expect(page.locator("section[aria-labelledby^='type-']")).toHaveCount(1);
  await fits(page);
});

test("on a phone, an entry's strip of parts stays under its top bar and jumps to a part; back to the list in its place (#176)", async ({ page, app }) => {
  await page.setViewportSize({ width: viewport.width, height: 600 });
  await app.restart(app.novelRepo("varn"));
  await launch(page, app);
  await page.getByRole("navigation", { name: "Book" }).getByRole("link", { name: "Bible" }).tap();
  const row = page.getByRole("link", { name: /^Ada Varn/ });
  await row.tap();
  const entry = page.locator("#index-entry");
  const back = entry.getByRole("link", { name: "Story bible" }).first();
  const strip = page.getByRole("navigation", { name: "Parts of the entry" });

  // At once, not smoothly: where it lands is what's measured.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await strip.getByRole("button", { name: /^Appears in/ }).tap();
  const heading = page.getByRole("region", { name: /^Appears in/ }).getByRole("heading", { name: /^Appears in/ });
  await expect(heading).toBeFocused();
  await expect(strip.getByRole("button", { name: /^Appears in/ })).toHaveAttribute("aria-current", "true");
  // The way back at the top of the screen, the strip right under it, and the part's heading under both.
  // Where the page itself sees them (a phone's boundingBox is the visual viewport's).
  const rect = (l: Locator) => l.evaluate((e) => ({ top: e.getBoundingClientRect().top, bottom: e.getBoundingClientRect().bottom }));
  const bar = back.locator("..");
  await expect.poll(async () => (await page.evaluate(() => scrollY)) > 0 && (await rect(bar)).top).toBe(0);
  await expect.poll(async () => Math.abs((await rect(strip)).top - (await rect(bar)).bottom)).toBeLessThanOrEqual(1);
  expect((await rect(heading)).top).toBeGreaterThanOrEqual((await rect(strip)).bottom);
  for (const b of await strip.getByRole("button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await fits(page);
  await audit(page);

  await back.tap();
  await expect(row).toBeFocused();
});

test("on a phone, Tidy up's names and an entry's actions have room: no word to a line, nothing off the screen", async ({ page, app }) => {
  const dir = app.bookRepo(fileURLToPath(new URL("../../../examples/sample-journal", import.meta.url)), "journal");
  // A link pasted into the sentence Tidy up shows: one long word, which breaks rather than widen the page.
  const day = join(dir, "entries/01-2026/02-october/01-thursday-1-october.md");
  writeFileSync(day, readFileSync(day, "utf8").replace("The first count of the season.", "The first count of the season. https://example.org/a/very/long/link/that/never/ends/with/a/space/anywhere/in/it"));
  app.git(dir, "commit", "-qam", "A link");
  await app.restart(dir);
  await launch(page, app);
  // The journal, the link in it: no wider than the screen.
  await expect(page.getByRole("link", { name: /^https:\/\/example\.org\// })).toBeVisible();
  await fits(page);
  const box = (l: Locator) => l.evaluate((e) => e.getBoundingClientRect().toJSON() as DOMRect);

  // Tidy up: each name and its count on a line or two, its buttons under it.
  await page.getByRole("navigation", { name: "Book" }).getByRole("link", { name: "Index" }).tap();
  await page.getByRole("button", { name: "Tidy up" }).tap();
  const names = page.getByRole("list", { name: "Names not linked" }).getByRole("listitem");
  await expect(names.first()).toBeVisible();
  for (const name of await names.locator("> div > span:first-child").all()) expect((await box(name)).height).toBeLessThan(56);
  for (const button of await names.getByRole("button").all()) expect((await box(button)).height).toBeGreaterThanOrEqual(44);
  // Its names shown, each with its ≠ (not a name here): still nothing wider than the screen.
  await names.first().getByRole("button", { name: "Show them" }).tap();
  const notAName = names.first().getByRole("button", { name: /: not a name here$/ }).first();
  await expect(notAName).toHaveText("≠");
  expect((await box(notAName)).height).toBeGreaterThanOrEqual(44);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/tidy.png` });
  await fits(page);
  await audit(page);

  // An entry: its way into the index on one line, Merge and Delete on the screen and a finger's size.
  await page.goBack();
  await page.getByRole("region").getByRole("link").first().tap();
  const entry = page.locator("#index-entry");
  for (const name of ["Merge into…", "Delete"]) {
    const b = await box(entry.getByRole("button", { name, exact: true }));
    expect(b.right).toBeLessThanOrEqual(viewport.width);
    expect(b.height).toBeGreaterThanOrEqual(44);
  }
  expect((await box(entry.getByRole("link", { name: "Index" }).last().locator(".."))).height).toBeLessThan(30);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/entry.png` });
  await fits(page);
  await audit(page);
});

test("a picture from the phone's photos into a note, from Picture on the bar above the keyboard (#203)", async ({ page, app }) => {
  const dir = app.novelRepo("varn");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/")[2]!;
  await page.goto(`${new URL(page.url()).origin}/novels/${id}/note/note_w1fben`);
  const prose = page.getByRole("textbox", { name: "Note: What if Ben never sold the plans?" });
  await prose.tap();
  const bar = page.getByRole("toolbar", { name: "Writing" });
  await expect(bar).toBeVisible();
  // Every target a finger's: 48 px.
  for (const button of await bar.getByRole("button").all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await bar.getByRole("button", { name: "Picture" }).tap();
  await expect(prose).toBeFocused();
  await expect(bar.getByRole("button", { name: "Take a photo" })).toBeVisible();
  for (const button of await bar.getByRole("button").all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await audit(page);
  const bytes = await makePicture(page, { width: 3000, height: 4000, name: "IMG_2041.jpg" });
  const chooser = page.waitForEvent("filechooser");
  await bar.getByRole("button", { name: "Choose from your photos" }).tap();
  await (await chooser).setFiles({ name: "IMG_2041.jpg", mimeType: "image/jpeg", buffer: bytes });
  const dialog = page.getByRole("dialog", { name: "Insert a picture" });
  await expect(dialog).toContainText("IMG_2041.jpg · 3000 × 4000 px");
  await dialog.getByLabel("Description").fill("A sketch of the toll house");
  await expect(dialog.getByRole("button", { name: "Insert" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Insert" }).tap();
  await expect(dialog).toBeHidden();
  await expect(prose.getByRole("img", { name: "A sketch of the toll house" })).toBeVisible();
  await expect.poll(() => readFileSync(join(dir, "notes/what-if-ben-never-sold.md"), "utf8")).toContain("\n\n![A sketch of the toll house](/images/a-sketch-of-the-toll-house.jpg)\n");
  await fits(page);
});

/**
 * Shares from another app (#204), as the Android app's plugin keeps them: its two commands answered
 * in the page in place of Tauri's, what's written let go, and kept across reloads as the app keeps them.
 */
async function sharing(page: Page, shares: { id: string; received: number; text?: string; subject?: string; pictures: { name: string; type: string; data: string }[] }[]) {
  await page.addInitScript((seed) => {
    const kept = () => JSON.parse(localStorage.getItem("test-shares") ?? "null") ?? seed;
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: { id?: string }) => {
        if (command === "shares") return { shares: kept() };
        if (command === "share_done") return void localStorage.setItem("test-shares", JSON.stringify(kept().filter((s: { id: string }) => s.id !== args.id)));
        throw new Error(`No command ${command}`);
      },
      transformCallback: () => 0,
    };
  }, shares);
  return () => page.evaluate(() => (JSON.parse(localStorage.getItem("test-shares") ?? "null") as { id: string }[] | null)?.map((s) => s.id));
}

const icon = (size: "32x32" | "128x128") => readFileSync(fileURLToPath(new URL(`../../mobile/src-tauri/icons/${size}.png`, import.meta.url))).toString("base64");

test("Save to Writer: a picture and a link shared from another app become a new note in the book used last, each picture described (#205)", async ({ page, app }) => {
  const dir = app.novelRepo("varn");
  await app.restart(dir);
  const left = await sharing(page, [
    { id: "1", received: 1, text: "Toll houses of the valley https://example.com/tolls", subject: "The toll house", pictures: [{ name: "IMG_2041.png", type: "image/png", data: icon("128x128") }, { name: "IMG_2042.png", type: "image/png", data: icon("32x32") }] },
  ]);
  await page.goto(app.launchUrl);
  // What was shared opens Save to Writer.
  await expect(page.getByRole("heading", { level: 1, name: "Save to Writer" })).toBeVisible();
  const shared = page.getByRole("region", { name: "What was shared" });
  await expect(shared).toContainText("Toll houses of the valley");
  await expect(shared).toContainText("https://example.com/tolls");
  await expect(page.getByRole("combobox", { name: "Book" })).toHaveValue(/.+/);
  await expect(page.getByRole("combobox", { name: "Book" }).locator("option:checked")).toHaveText("The Bridge at Varn");
  await expect(page.getByRole("radio", { name: "New note" })).toBeChecked();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("The toll house");
  const save = page.getByRole("button", { name: "Save as a new note" });
  // Each picture described first: Save says which isn't, and goes to it.
  await save.tap();
  await expect(page.getByRole("alert")).toHaveText("Describe picture 1.");
  await expect(page.getByRole("textbox", { name: "Description of picture 1" })).toBeFocused();
  await page.getByRole("textbox", { name: "Description of picture 1" }).fill("The toll house from the bridge");
  await save.tap();
  await expect(page.getByRole("alert")).toHaveText("Describe picture 2.");
  await expect(page.getByRole("textbox", { name: "Description of picture 2" })).toBeFocused();
  await page.getByRole("textbox", { name: "Description of picture 2" }).fill("The toll board");
  await audit(page);
  for (const target of await page.locator("main").locator("input:not([type=radio]), select, button").all()) expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await fits(page);
  await save.tap();

  // The note, opened; written in the book with its pictures saved in images/, and the share let go.
  await expect(page.getByRole("textbox", { name: "Note: The toll house" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Note: The toll house" }).getByRole("img", { name: "The toll board" })).toBeVisible();
  const note = readFileSync(join(dir, "notes/the-toll-house.md"), "utf8");
  expect(note).toMatch(/^---\nid: note_\w+\ntitle: The toll house\ncreated: [\d-]+T[\d:]+\n---\n/);
  // A new note as New note makes one: a line between its front matter and its words.
  expect(note.split("---\n")[2]).toBe("\nToll houses of the valley <https://example.com/tolls>\n\n![The toll house from the bridge](/images/the-toll-house-from-the-bridge.png)\n\n![The toll board](/images/the-toll-board.png)\n");
  expect(existsSync(join(dir, "images/the-toll-house-from-the-bridge.png"))).toBe(true);
  expect(await left()).toEqual([]);
  // Let go: a reload doesn't bring it back.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Save to Writer" })).toHaveCount(0);
});

test("Save to Writer: shared text added at the end of a note picked from the book's, newest first, with search (#205)", async ({ page, app }) => {
  const dir = app.novelRepo("varn");
  await app.restart(dir);
  const IDEA = "notes/what-if-ben-never-sold.md";
  const before = readFileSync(join(dir, IDEA), "utf8");
  const left = await sharing(page, [{ id: "7", received: 7, text: "The ford floods in spring. Ask the ferryman.", pictures: [] }]);
  await page.goto(app.launchUrl);
  await expect(page.getByRole("heading", { level: 1, name: "Save to Writer" })).toBeVisible();
  await page.getByRole("radio", { name: "Add to a note…" }).tap();
  const notes = page.getByRole("list", { name: "Notes, newest first" });
  await expect(notes.getByRole("radio")).not.toHaveCount(0);
  await page.getByRole("button", { name: "Add to the note" }).tap();
  await expect(page.getByRole("alert")).toHaveText("Choose the note to add it to.");
  await expect(notes.getByRole("radio").first()).toBeFocused();
  await page.getByRole("searchbox", { name: "Search the notes" }).fill("flood");
  await expect(notes.getByRole("radio")).toHaveCount(1);
  await notes.getByRole("radio", { name: /What if Ben never sold the plans\?/ }).tap();
  await audit(page);
  await page.getByRole("button", { name: "Add to the note" }).tap();
  await expect(page.getByRole("textbox", { name: "Note: What if Ben never sold the plans?" })).toContainText("Ask the ferryman.");
  expect(readFileSync(join(dir, IDEA), "utf8")).toBe(`${before.trimEnd()}\n\nThe ford floods in spring. Ask the ferryman.\n`);
  expect(await left()).toEqual([]);
});

test("Save to Writer: what's shared can be left for later, by Not now or Back, and waits on the shelf without sending the writer back to it (#205)", async ({ page, app }) => {
  await app.restart(app.novelRepo("varn"));
  const left = await sharing(page, [{ id: "3", received: 3, text: "The ford floods in spring.", pictures: [] }]);
  await page.goto(app.launchUrl);
  await expect(page.getByRole("heading", { level: 1, name: "Save to Writer" })).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).tap();
  await expect(page.getByRole("heading", { level: 1, name: "Your books" })).toBeVisible();
  // Kept, and on the shelf; the app opened again doesn't go back to it.
  await expect(page.getByText("Something you shared with Writer isn't saved yet.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Your books" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Save to Writer" })).toHaveCount(0);
  // Never let go: the app still keeps it as shared.
  expect(await left()).toBeUndefined();
  // From the shelf, and Back from there, as Android's back gesture: the shelf again, not Save to Writer.
  await page.getByRole("link", { name: "Save to Writer" }).tap();
  await expect(page.getByRole("heading", { level: 1, name: "Save to Writer" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Your books" })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByRole("heading", { level: 1, name: "Save to Writer" })).toHaveCount(0);
});
