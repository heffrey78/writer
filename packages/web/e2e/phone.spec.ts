import { readFileSync } from "node:fs";
import { join } from "node:path";
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

test("on a phone, by touch: the shelf, a book, its sidebar, writing, the palette and a sync", async ({ page, app }) => {
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

  // A book, opened by tapping it; its sidebar a strip, opened over the text.
  await page.getByRole("list", { name: "Books" }).getByRole("link", { name: /The Bridge at Varn/ }).tap();
  const text = page.getByRole("textbox", { name: "Chapter text" });
  await expect(text).toBeVisible();
  await fits(page);
  await audit(page);
  await page.getByRole("button", { name: "Expand the sidebar" }).tap();
  const drawer = page.getByRole("dialog", { name: "The sidebar" });
  await drawer.getByRole("tree", { name: "Manuscript" }).getByRole("treeitem", { name: /The Station/ }).tap();
  await expect(drawer).toHaveCount(0);

  // Written in, by tapping into the scene's text.
  const scene = page.getByRole("textbox", { name: "Scene text" });
  await scene.tap();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Written on the phone.");
  await expect.poll(() => readFileSync(join(app.home, "varn", STATION), "utf8"), { timeout: 10_000 }).toContain("Written on the phone.");

  // The scene's details, from the ⋯ menu: no strip of buttons for the right sidebar on a phone.
  await page.getByRole("banner").getByRole("button", { name: /^More/ }).tap();
  await page.getByRole("menuitem", { name: "Show the scene's details" }).tap();
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
  const open = page.getByRole("button", { name: "Drafts: Main version is open" });

  // It fills the screen, with nothing beside it to tap: its own button closes it.
  await open.tap();
  await expect(drafts).toBeVisible();
  await fits(page);
  await audit(page);
  await drafts.getByRole("button", { name: "Close" }).tap();
  await expect(drafts).toHaveCount(0);

  // Left for the shelf while open, as Android's back did: the book opens on its text again.
  await page.getByRole("link", { name: "Writer: your books" }).tap();
  await page.getByRole("list", { name: "Books" }).getByRole("link", { name: /The Bridge at Varn/ }).tap();
  await open.tap();
  await expect(drafts).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Your books" })).toBeVisible();
  await page.getByRole("list", { name: "Books" }).getByRole("link", { name: /The Bridge at Varn/ }).tap();
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeVisible();
  await expect(drafts).toHaveCount(0);
});
