import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { entryTitle, MONTHS, today } from "../../modules/daily/src/core/index.ts";
import { asDesktop, axe, expect, launch, palette, selectionSettled, test, type App } from "./fixtures.ts";

/**
 * Today's entry, one action away (#38): from a journal's tile on the shelf, the palette and the
 * desktop menu, on the journal page with the caret where it begins, made with its first words (#64);
 * and the calendar.
 */

/** A new journal on the shelf, made as New makes it. */
async function newJournal(page: Page, app: App, title = "Days") {
  await launch(page, app);
  const r = await page.request.post(`${app.url}/api/library/new`, { data: { kind: "journal", title }, headers: { origin: app.url } });
  expect(r.status()).toBe(201);
  await page.reload();
  return join(app.home, "writer", title.toLowerCase());
}

test("from the journal's tile: the caret where today's begins; typed in, it's made in its month and year", async ({ page, app }) => {
  const dir = await newJournal(page, app);
  const day = today();
  const commits = app.git(dir, "rev-list", "--count", "HEAD");
  await page.getByRole("button", { name: "Today's entry" }).click();
  await expect(page).toHaveURL(/\/read$/);
  await expect(page.getByRole("heading", { level: 1, name: "Day by day" })).toBeVisible();
  const begin = page.getByRole("textbox", { name: "Write today's entry" });
  await expect(begin).toBeFocused();
  // Nothing made until there's something in it.
  expect(app.git(dir, "rev-list", "--count", "HEAD")).toBe(commits);
  await axe(page);

  await selectionSettled(page);
  await page.keyboard.type("Rain all day.");
  await expect.poll(() => app.git(dir, "log", "-1", "--format=%s").trim(), { timeout: 10_000 }).toContain(`add entry “${entryTitle(day)}”`);
  const file = () => app.git(dir, "ls-files", "entries").split("\n").find((f) => f.endsWith(".md"))!;
  await expect.poll(() => readFileSync(join(dir, file()), "utf8"), { timeout: 10_000 }).toContain("Rain all day.");
  expect(readFileSync(join(dir, file()), "utf8")).toContain(`when:\n  at: ${day}\n`);
  expect(file()).toMatch(new RegExp(`^entries/01-${day.slice(0, 4)}/01-${MONTHS[Number(day.slice(5, 7)) - 1]!.toLowerCase()}/`));

  // Again, from the palette: the caret at the end of today's, nothing new.
  const made = app.git(dir, "rev-list", "--count", "HEAD");
  await palette(page, "index");
  await palette(page, "today's entry");
  const entry = page.getByRole("textbox", { name: `Entry text: ${entryTitle(day)}` });
  await expect(entry).toBeFocused();
  await selectionSettled(page);
  await page.keyboard.type(" Still.");
  await expect.poll(() => readFileSync(join(dir, file()), "utf8"), { timeout: 10_000 }).toContain("Rain all day. Still.");
  expect(app.git(dir, "rev-list", "--count", "HEAD")).toBe(made);
});

test("the calendar shows the month's entries, today marked, and a way to write today's", async ({ page, app }) => {
  await newJournal(page, app);
  await page.getByRole("link", { name: "Days" }).click();
  await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Calendar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("status").filter({ hasText: /entr/ })).toHaveText("No entries this month.");
  await axe(page);
  await page.getByRole("link", { name: "Write today's entry" }).click();
  await expect(page.getByRole("textbox", { name: "Write today's entry" })).toBeFocused();
  await selectionSettled(page);
  await page.keyboard.type("Hello there.");
  await expect(page.getByRole("list", { name: "Day by day" }).getByRole("article", { name: entryTitle(today()) })).toBeVisible();
  await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Calendar" }).click();
  await expect(page.getByRole("table").getByRole("link", { name: entryTitle(today()) })).toBeVisible();
  await expect(page.getByRole("main").getByRole("status").filter({ hasText: /entr/ })).toHaveText("1 entry, 2 words");
});

test("the desktop menu's Today's Entry runs it on the shelf, for the journal opened last", async ({ page, app }) => {
  await asDesktop(page);
  await newJournal(page, app);
  await page.evaluate(() => window.writer!.run({ name: "command", arg: "daily.today" }));
  // The desktop app opens the journal in a window of its own, at today's entry.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __calls: [string, { path?: string }][] }).__calls.filter(([c]) => c === "open_novel").map(([, a]) => a.path))).toEqual(["today"]);
});
