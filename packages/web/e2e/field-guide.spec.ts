import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Download, Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { axe, expect, palette, test, withTestKinds, type App } from "./fixtures.ts";

/**
 * A book of a kind that isn't a novel (#35): a field guide of regions, habitats and families of
 * species, with an atlas, one field of its own and no modules. The shelf, the writing view, the tree,
 * the atlas, notes, sync and compile all work for it, in its own words.
 */

const guide = fileURLToPath(new URL("../../../examples/sample-field-guide", import.meta.url));
const REDSHANK = "guide/01-the-estuary/01-mudflats/01-waders/02-redshank.md";
test.use({ entry: withTestKinds });

const text = (page: Page) => page.getByRole("textbox", { name: "Family text" });
/** No novel's words anywhere on the page. */
const novelWords = /\b(scenes?|chapters?|manuscript|story bible|novel|off the page)\b/i;

async function open(page: Page, app: App, dir = app.bookRepo(guide, "birds")) {
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(text(page)).toBeFocused();
  return dir;
}

test("is on the shelf, and opens in its writing view and tree, in its own words", async ({ page, app }) => {
  const dir = await open(page, app);
  await expect(page.getByRole("heading", { level: 1, name: "Waders" })).toBeVisible();
  const tree = page.getByRole("tree");
  for (const name of ["The Estuary", "Mudflats", "Waders", "Curlew", "Redshank"]) await expect(tree.getByRole("treeitem", { name, exact: false }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(novelWords);

  // Typing saves to the species' own file, in the guide's folders.
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Flocks of two hundred in March.");
  await expect.poll(() => readFileSync(join(dir, REDSHANK), "utf8"), { timeout: 10_000 }).toMatch(/Flocks of two hundred in March\.\n$/);

  // To a family in another habitat, through the tree.
  await tree.getByRole("treeitem", { name: "Warblers", exact: false }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Warblers" })).toBeVisible();
  await expect(text(page)).toContainText("a scratchy song");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }

  await page.getByRole("link", { name: "Writer: your books" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your books" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Birds of the Varn Estuary/ })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(novelWords);
});

test("its atlas lists its observers and sites, and its notes are on its species", async ({ page, app }) => {
  await open(page, app);
  await palette(page, "atlas");
  await expect(page.getByRole("heading", { level: 1, name: "Atlas" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /^Observers/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /^Sites/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /The Old Sluice/ })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(novelWords);
  await axe(page);

  await palette(page, "note: a hide");
  await expect(page.getByRole("heading", { level: 1, name: "A hide at the sluice?" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sedge Warbler" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Make it a species" })).toBeVisible();
});

test("syncs with its remote, and compiles", async ({ page, app }) => {
  const seed = app.bookRepo(guide, "seed");
  const remote = join(app.home, "remotes", "birds.git");
  app.git(app.home, "clone", "-q", "--bare", seed, remote);
  const here = join(app.home, "here");
  app.git(app.home, "clone", "-q", remote, here);
  await open(page, app, here);
  const badge = page.getByRole("button", { name: /^Sync:/ });
  await expect(badge).toHaveAccessibleName("Sync: Synced");

  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Flocks of two hundred in March.");
  await expect.poll(() => readFileSync(join(here, REDSHANK), "utf8"), { timeout: 10_000 }).toMatch(/March\.\n$/);
  await badge.click();
  await page.getByRole("dialog").getByRole("button", { name: "Sync now" }).click();
  await page.keyboard.press("Escape");
  await expect.poll(() => app.git(remote, "show", `main:${REDSHANK}`)).toMatch(/Flocks of two hundred in March\.\n$/);

  await palette(page, "Compile the guide");
  const dialog = page.getByRole("dialog", { name: "Compile the guide" });
  await expect(dialog).toBeVisible();
  // Not "manuscript": standard manuscript format is the DOCX's layout until it's a module (#32).
  await expect(dialog).not.toContainText(/\b(scenes?|chapters?|story bible|novel)\b/i);
  const downloads: Download[] = [];
  page.on("download", (d) => downloads.push(d));
  await dialog.getByRole("button", { name: "Compile" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => downloads.length).toBeGreaterThan(0);
  const docx = downloads.find((d) => d.suggestedFilename().endsWith(".docx"));
  expect(docx?.suggestedFilename()).toBe("birds-of-the-varn-estuary.docx");
  const xml = strFromU8(unzipSync(new Uint8Array(readFileSync((await docx!.path())!)))["word/document.xml"]!);
  expect(xml).toContain("Flocks of two hundred in March.");
  expect(xml).toContain("a scratchy song");
});
