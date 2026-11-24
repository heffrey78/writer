import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { THEMES, tokensOf } from "../src/themes.ts";
import { axe, caretAtEnd, expect, launch, palette, test, type App } from "./fixtures.ts";

/**
 * heffrey78/gh-writer#7's promises, walked the way a keyboard user would meet them: every flow mouse-free, focus always
 * visible, no axe violations in either theme, and a layout that works from a 13-inch laptop to a
 * large monitor.
 */

const BRIDGE = "manuscript/01-return/01-arrival/02-the-bridge.md";

/** A file's text, or "" while it's missing (a restore replaces files, so for a moment one isn't there). */
const readNow = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");

/** axe in light and dark, leaving the page in light. */
async function audit(page: Page) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/** Tab `count` times; each element reached must show focus (an outline or a ring), except the writing surface, whose focus is its caret. */
async function tabShowsFocus(page: Page, count: number) {
  for (let i = 0; i < count; i++) {
    await page.keyboard.press("Tab");
    const seen = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return { ok: true, what: "body" };
      if (el.classList.contains("ghw-prose")) return { ok: true, what: "the text" };
      const s = getComputedStyle(el);
      const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
      const ring = s.boxShadow !== "none";
      return { ok: outline || ring, what: `${el.tagName.toLowerCase()} ${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? ""}` };
    });
    expect(seen.ok, `focus is visible on ${seen.what}`).toBe(true);
  }
}

async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

/** A remote with the sample novel, and another machine's clone of it. */
function remoteAndOther(app: App) {
  const remote = app.bareRepo("varn.git");
  const other = join(app.home, "other");
  app.git(app.home, "clone", "-q", remote, other);
  return { remote, other };
}

for (const [name, viewport] of [
  ["a 13-inch laptop", { width: 1280, height: 800 }],
  ["a large monitor", { width: 2560, height: 1440 }],
] as const) {
  test(`every flow by keyboard alone, on ${name}`, async ({ page, app }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    const { remote, other } = remoteAndOther(app);

    // The library: skip link first, every control shows focus.
    await launch(page, app);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
    await tabShowsFocus(page, 6);
    await noSideways(page);
    await audit(page);

    // Clone from the remote, by keyboard.
    await page.getByRole("button", { name: "Clone from GitHub" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "Repository" })).toBeFocused();
    await page.keyboard.type(`file://${remote}`);
    await page.keyboard.press("Enter");
    const text = page.getByRole("textbox", { name: "Chapter text" });
    await expect(text).toBeFocused({ timeout: 15_000 });
    await noSideways(page);
    await audit(page);
    const here = join(app.home, "writer", "varn");

    // Write, and meet the other machine's change to the same paragraph.
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" Written here.");
    await expect.poll(() => readFileSync(join(here, BRIDGE), "utf8"), { timeout: 10_000 }).toContain("Written here.");
    const lines = readFileSync(join(other, BRIDGE), "utf8").trimEnd().split("\n");
    lines[lines.length - 1] = "Written on the other machine.";
    writeFileSync(join(other, BRIDGE), `${lines.join("\n")}\n`);
    app.git(other, "commit", "-qam", "Other");
    app.git(other, "push", "-q");

    // Sync and resolve from the palette.
    await palette(page, "sync now");
    await expect(page.getByRole("button", { name: "Sync: Conflict" })).toBeVisible({ timeout: 15_000 });
    await palette(page, "resolve sync conflicts");
    const resolver = page.getByRole("region", { name: "Resolve conflicts" });
    await expect(resolver).toBeFocused();
    await tabShowsFocus(page, 4);
    await audit(page);
    await resolver.focus();
    await page.keyboard.press("3");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page.getByRole("button", { name: "Sync: Synced" })).toBeVisible({ timeout: 15_000 });
    expect(app.git(remote, "show", `main:${BRIDGE}`)).toMatch(/Written here\.\n\nWritten on the other machine\.\n$/);

    // A checkpoint, a restore and its undo, all by keyboard.
    await text.focus();
    await palette(page, "checkpoints");
    const panel = page.getByRole("dialog", { name: "Drafts" });
    await expect(panel.getByRole("textbox", { name: "New checkpoint" })).toBeFocused();
    await page.keyboard.type("Merged");
    await page.keyboard.press("Enter");
    await expect(panel.getByRole("listitem")).toHaveCount(1);
    await audit(page);
    await page.keyboard.press("Escape");
    // Closed, not closing: until it's gone its focus trap would take the keys typed next.
    await expect(panel).toHaveCount(0);
    await caretAtEnd(page, text);
    await page.keyboard.type(" Then more.");
    await expect.poll(() => readFileSync(join(here, BRIDGE), "utf8"), { timeout: 10_000 }).toContain("Then more.");
    await palette(page, "checkpoints");
    await panel.getByRole("button", { name: "Restore the manuscript from “Merged”" }).focus();
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("alertdialog");
    await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(confirm.getByRole("button", { name: "Restore manuscript" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => readNow(join(here, BRIDGE))).toMatch(/Written on the other machine\.\n$/);
    await expect(page.getByRole("status").filter({ hasText: "Restored the manuscript" })).toBeVisible();
    // Undo is in the notice, and a keystroke away in the palette.
    await palette(page, "undo");
    await expect(page.getByRole("status").filter({ hasText: "Undone" })).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => readNow(join(here, BRIDGE))).toContain("Then more.");

    // Theme and the shortcut reference.
    await palette(page, "theme dark");
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
    await page.keyboard.press("ControlOrMeta+/");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await axe(page);
    await page.keyboard.press("Escape");
    await palette(page, "follow the system");

    // Back to the library, by keyboard.
    await palette(page, "your books");
    await expect(page.getByRole("heading", { level: 1, name: "Your books" })).toBeVisible();
    await noSideways(page);
  });
}

/** Where the focus is: inside what `selector` finds, or not. */
const focusIn = (page: Page, selector: string) => page.evaluate((s) => !!document.activeElement?.closest(s), selector);

test("the index's screens by keyboard and the palette: the table, its columns and its selection, a type's fields, Tidy up, Merge and Quick look, each audited in light and dark; the focus kept and given back, the changes said (#178)", async ({ page, app }) => {
  test.setTimeout(90_000);
  await app.restart(app.novelRepo("varn"));
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused();
  await palette(page, "story bible");
  await expect(page.getByRole("heading", { level: 1, name: "Story bible" })).toBeVisible();

  // The list's order and view, from the palette, and said.
  await palette(page, "sort the bible by name");
  await expect(page.getByLabel("Sort")).toHaveValue("name");
  await expect(page.locator("p[aria-live]").filter({ hasText: "Sorted by name" })).toBeAttached();
  await palette(page, "show the bible as table");
  await expect(page.getByRole("group", { name: "Show as" }).getByRole("button", { name: "Table" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("p[aria-live]").filter({ hasText: "Shown as Table" })).toBeAttached();

  // The table: audited; its columns, its sort and its selection's actions from the palette.
  await page.getByRole("button", { name: /^Characters/ }).click();
  const grid = page.getByRole("grid", { name: /^Characters/ });
  await expect(grid).toBeVisible();
  await audit(page);
  await palette(page, "choose the table's columns");
  const columns = page.getByRole("dialog", { name: "Columns" });
  await expect(columns).toBeVisible();
  await audit(page);
  await page.keyboard.press("Escape");
  await expect(columns).toHaveCount(0);
  await palette(page, "sort the table by name");
  await expect(page.locator("p[aria-live]").filter({ hasText: "Sorted by Name, ascending" })).toBeAttached();
  await palette(page, "select every one of the characters");
  await expect(page.getByRole("toolbar", { name: "The selected rows" })).toContainText("4 selected");
  await palette(page, "add a tag to the selected");
  const tagging = page.getByRole("dialog", { name: /^Add a tag to / });
  await expect(tagging.getByRole("combobox", { name: "Tag" })).toBeFocused();
  await audit(page);
  // Closed, the focus goes back to the table (the palette that opened it is gone).
  await page.keyboard.press("Escape");
  await expect(tagging).toHaveCount(0);
  await expect.poll(() => focusIn(page, '[role="grid"]')).toBe(true);
  await palette(page, "clear the selection");
  await expect(page.getByRole("toolbar", { name: "The selected rows" })).toHaveCount(0);

  // A type's fields: the dialog keeps the focus in it, and gives it back.
  await palette(page, "fields of characters");
  const fields = page.getByRole("dialog", { name: "Fields of characters" });
  await expect(fields).toBeVisible();
  await expect.poll(() => focusIn(page, '[role="dialog"]')).toBe(true);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await focusIn(page, '[role="dialog"]')).toBe(true);
  }
  await audit(page);
  await page.keyboard.press("Escape");
  await expect(fields).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body)).toBe(true);

  // Tidy up: audited, each list from the palette.
  await palette(page, "tidy up the bible");
  await expect(page.getByRole("heading", { level: 1, name: "Tidy up the bible" })).toBeVisible();
  await audit(page);
  await palette(page, "tidy up: no summary");
  await expect(page.getByRole("tab", { name: /No summary$/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: /No summary$/ })).toBeFocused();

  // Merge, from an entry's profile: audited; closed, the focus on the entry.
  await palette(page, "story bible");
  await palette(page, "show the bible as list");
  await page.getByRole("link", { name: /^Ben Varn/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Ben Varn" })).toBeVisible();
  await palette(page, "merge ben varn into another character");
  const merging = page.getByRole("dialog", { name: "Merge Ben Varn into…" });
  await expect(merging.getByRole("combobox", { name: "Into" })).toBeFocused();
  await audit(page);
  await page.keyboard.press("Escape");
  await expect(merging).toHaveCount(0);
  await expect(page.locator("#index-entry")).toBeFocused();

  // Quick look: audited; Tab goes round inside it, never to the page behind.
  await page.keyboard.press("Control+;");
  const look = page.getByRole("dialog", { name: "Quick look" });
  await expect(look.getByRole("combobox")).toBeFocused();
  await page.keyboard.type("ada");
  await expect(look.getByRole("article", { name: "Ada Varn" })).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await focusIn(page, '[role="dialog"]')).toBe(true);
  }
  await audit(page);
  await page.keyboard.press("Escape");
  await expect(look).toHaveCount(0);
});

test("Read at a session, from the palette: the list of sessions in focus (#140, #178)", async ({ page, app }) => {
  const dir = app.bookRepo(fileURLToPath(new URL("../../../examples/sample-campaign", import.meta.url)), "campaign");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Arc text" })).toBeFocused();
  await palette(page, "codex");
  await page.getByRole("link", { name: /^Marta Hollin/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Marta Hollin" })).toBeVisible();
  await palette(page, "read marta hollin at a session");
  await expect(page.getByRole("combobox", { name: "Read at" })).toBeFocused();
});

/** "#rrggbb" as getComputedStyle gives it. */
const asRgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

test("every theme reads, light and dark: the shelf, the writing view, the index, an entry and a dialog pass axe in each (#189)", async ({ page, app }) => {
  test.setTimeout(240_000);
  await app.restart(app.novelRepo("varn"));
  await page.goto(app.launchUrl);
  const text = page.getByRole("textbox", { name: "Chapter text" });
  await expect(text).toBeFocused();
  const writing = page.url();
  const book = writing.replace(/\/chapter.*$/, "");
  const pages: [string, () => Promise<void>][] = [
    [`${app.url}/`, () => expect(page.getByRole("heading", { level: 1, name: "Your books" })).toBeVisible()],
    [writing, () => expect(text).toBeVisible()],
    [`${book}/bible`, () => expect(page.getByRole("heading", { level: 1, name: "Story bible" })).toBeVisible()],
    [`${book}/bible/char_7f3k2q`, () => expect(page.getByRole("heading", { level: 2, name: "Ada Varn" })).toBeVisible()],
  ];
  for (const theme of THEMES) {
    await page.evaluate((palette) => localStorage.setItem("ghw:appearance", JSON.stringify({ mode: "system", palette })), theme.id);
    for (const [url, ready] of pages) {
      await page.goto(url);
      await ready();
      if (theme.id === "paper") await expect(page.locator("html")).not.toHaveAttribute("data-palette");
      else await expect(page.locator("html")).toHaveAttribute("data-palette", theme.id);
      for (const mode of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: mode });
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor), `${theme.name} ${mode}`).toBe(asRgb(tokensOf(theme, mode).paper));
        await axe(page);
      }
      await page.emulateMedia({ colorScheme: "light" });
    }
    // A dialog, over the entry.
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog")).toBeVisible();
    await audit(page);
    await page.keyboard.press("Escape");
  }
});

test("light or dark chosen before themes stays chosen, and a theme is chosen with it on this device alone (#189)", async ({ page, app }) => {
  await launch(page, app);
  await page.evaluate(() => {
    localStorage.removeItem("ghw:appearance");
    localStorage.setItem("ghw:theme", "dark");
  });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Your books" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).not.toHaveAttribute("data-palette");
  // Chosen again, from the palette: kept in the one record, and the old key gone.
  await palette(page, "theme: light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => [localStorage.getItem("ghw:appearance"), localStorage.getItem("ghw:theme")])).toEqual([JSON.stringify({ mode: "light", palette: "paper" }), null]);
  // Study, dark, chosen in the record: on the page from its first paint, whatever the system says.
  await page.evaluate(() => localStorage.setItem("ghw:appearance", JSON.stringify({ mode: "dark", palette: "study", text: { size: 21 } })));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "study");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(asRgb(tokensOf(THEMES.find((t) => t.id === "study")!, "dark").paper));
  // A record this app can't read is Paper, following the system.
  await page.evaluate(() => localStorage.setItem("ghw:appearance", "{not json"));
  await page.reload();
  await expect(page.locator("html")).not.toHaveAttribute("data-palette");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
});
