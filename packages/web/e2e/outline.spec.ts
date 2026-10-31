import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { axe, expect, test, type App } from "./fixtures.ts";

const STATION = "manuscript/01-return/01-arrival/01-the-station.md";
const ARRIVAL = "manuscript/01-return/01-arrival/_chapter.yaml";

async function open(page: Page, app: App) {
  const dir = app.novelRepo("varn");
  await app.restart(dir);
  const base = new URL(app.launchUrl).pathname;
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused();
  await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Outline" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Outline" })).toBeVisible();
  return { dir, base, read: (path: string) => readFileSync(join(dir, path), "utf8") };
}

const row = (page: Page, title: string) => page.getByRole("row").filter({ has: page.getByRole("link", { name: title, exact: true }) });

test("lists every scene by chapter with its details and words", async ({ page, app }) => {
  await open(page, app);
  const table = page.getByRole("table", { name: "Every scene in reading order, by chapter" });
  await expect(table.locator("thead").getByRole("columnheader")).toHaveText(["Move", "Scene", "Synopsis", "Status", "Point of view", "Characters", "Plotlines", "Words"]);
  for (const chapter of ["Arrival", "Old Debts", "Night Crossing", "Varn Holds"]) await expect(table.getByRole("link", { name: chapter, exact: true })).toBeVisible();
  await expect(row(page, "The Station")).toContainText("Ada Varn");
  await expect(row(page, "The Station").getByRole("combobox")).toHaveValue("drafted");
  await expect(row(page, "The Station").getByRole("cell").last()).toHaveText(/^\d+$/);
  await axe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page);
});

test("edits a synopsis and a status in place, changing only those lines", async ({ page, app }) => {
  const novel = await open(page, app);
  const before = novel.read(STATION).split("\n");
  const synopsis = page.getByRole("textbox", { name: "Synopsis of “The Station”" });
  await synopsis.fill("Ada comes home and sees the flags.");
  await synopsis.press("Enter");
  await row(page, "The Station").getByRole("combobox", { name: "Status of “The Station”" }).selectOption("revised");
  await expect.poll(() => novel.read(STATION), { timeout: 10_000 }).toContain("status: revised");
  const after = novel.read(STATION).split("\n");
  const changed = after.filter((line, i) => line !== before[i]);
  expect(changed).toEqual(["synopsis: Ada comes home and sees the flags.", "status: revised"]);
  expect(after.length).toBe(before.length);
});

test("reorders scenes with the keyboard, and opens one", async ({ page, app }) => {
  const novel = await open(page, app);
  await page.getByRole("button", { name: "Move “The Station”" }).focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => novel.read(ARRIVAL)).toContain("scenes: [sc_br1dg3, sc_5tat1n]");
  await expect(page.getByRole("button", { name: "Move “The Station”" })).toBeFocused();
  await row(page, "Walking the Span").getByRole("link", { name: "Walking the Span" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Walking the Span" })).toBeVisible();
});

test("reorders by dragging a row's handle", async ({ page, app }) => {
  const novel = await open(page, app);
  // Tried again until it lands, as in the swimlanes: a drag as the list settles can miss. Dropped there
  // again, the scene stays where it is.
  await expect(async () => {
    await page.getByRole("button", { name: "Move “Walking the Span”" }).dragTo(row(page, "The Station"), { targetPosition: { x: 40, y: 4 } });
    await expect.poll(() => novel.read(ARRIVAL), { timeout: 3_000 }).toContain("scenes: [sc_br1dg3, sc_5tat1n]");
  }).toPass({ timeout: 20_000 });
});

test("adds scenes in place: titles typed in a row by keyboard alone, in order, one commit each, and the outline stays (#117)", async ({ page, app }) => {
  const { dir } = await open(page, app);
  const url = page.url();
  const commits = () => Number(app.git(dir, "rev-list", "--count", "HEAD").trim());
  await expect.poll(() => app.git(dir, "status", "--porcelain").trim()).toBe("");
  const before = commits();
  const add = page.getByRole("button", { name: "New scene in Arrival" });
  await add.focus();
  await page.keyboard.press("Enter");
  const field = page.getByRole("textbox", { name: "Title: New scene in Arrival" });
  await expect(field).toBeFocused();
  await axe(page);
  // Enter on nothing adds nothing, and leaves the field.
  await page.keyboard.press("Enter");
  await expect(field).toBeFocused();
  for (const title of ["First of three", "Second of three", "Third of three"]) {
    await page.keyboard.type(title);
    await page.keyboard.press("Enter");
    await expect(field).toHaveValue("");
    await expect(field).toBeFocused();
  }
  const rows = page.getByRole("link", { name: /of three$/ });
  await expect(rows).toHaveText(["First of three", "Second of three", "Third of three"]);
  expect(page.url()).toBe(url);
  await expect(page.getByRole("status").filter({ hasText: "Added “Third of three”." })).toBeAttached();
  await expect.poll(commits).toBe(before + 3);

  await page.keyboard.press("Escape");
  await expect(add).toBeFocused();
  await expect(field).toHaveCount(0);
});

test("adds a chapter at the end in place, and goes on to its first scene; a chapter's title is required here (#117)", async ({ page, app }) => {
  await open(page, app);
  await page.getByRole("button", { name: "New chapter" }).click();
  const field = page.getByRole("textbox", { name: "Title: New chapter" });
  await page.keyboard.press("Enter");
  await expect(field).toBeFocused();
  await expect(page.getByRole("button", { name: /^New scene in Chapter/ })).toHaveCount(0);
  await field.fill("Outlined");
  await page.keyboard.press("Enter");
  const inIt = page.getByRole("textbox", { name: "Title: New scene in Outlined" });
  await expect(inIt).toBeFocused();
  await page.keyboard.type("Its first");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name: "Its first" })).toBeVisible();
  await expect(inIt).toBeFocused();
});

test("the cards add in place too, and say when the filter hides what was added (#117)", async ({ page, app }) => {
  await open(page, app);
  await page.goto(`${page.url().replace(/\/outline.*$/, "/outline/cards")}?status=drafted`);
  await page.getByRole("button", { name: /^New scene in / }).first().click();
  const field = page.getByRole("textbox", { name: /^Title: New scene in / });
  await field.fill("Hidden by the filter");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Added “Hidden by the filter”. The filter hides it." })).toBeVisible();
  await expect(field).toBeFocused();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByText("Hidden by the filter", { exact: true }).first()).toBeVisible();
  await axe(page);
});
