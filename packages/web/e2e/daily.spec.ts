import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { entryTitle, MONTHS, today } from "../../modules/daily/src/core/index.ts";
import { asDesktop, axe, expect, launch, palette, test, type App } from "./fixtures.ts";

/** Today's entry, one action away (#38): from a journal's tile on the shelf, the palette and the desktop menu; and the calendar. */

/** A new journal on the shelf, made as New makes it. */
async function newJournal(page: Page, app: App, title = "Days") {
  await launch(page, app);
  const r = await page.request.post(`${app.url}/api/library/new`, { data: { kind: "journal", title }, headers: { origin: app.url } });
  expect(r.status()).toBe(201);
  await page.reload();
  return join(app.home, "writer", title.toLowerCase());
}

test("from the journal's tile: today's entry made in its month and year, opened, and written in", async ({ page, app }) => {
  const dir = await newJournal(page, app);
  const day = today();
  await page.getByRole("button", { name: "Today's entry" }).click();
  // Its month's page, at it.
  await expect(page.getByRole("heading", { level: 1, name: MONTHS[Number(day.slice(5, 7)) - 1] })).toBeVisible();
  const text = page.getByRole("textbox", { name: "Entry text" });
  await expect(text).toBeVisible();
  await expect(page).toHaveURL(/\/scene\/ent_[0-9a-z]{6}$/);
  expect(app.git(dir, "log", "-1", "--format=%s").trim()).toContain(`add entry “${entryTitle(day)}”`);

  await text.click();
  await page.keyboard.type("Rain all day.");
  const file = app.git(dir, "ls-files", "entries").split("\n").find((f) => f.endsWith(".md"))!;
  await expect.poll(() => readFileSync(join(dir, file), "utf8"), { timeout: 10_000 }).toContain("Rain all day.");
  expect(readFileSync(join(dir, file), "utf8")).toContain(`when:\n  at: ${day}\n`);

  // Again, from the palette: the same entry, nothing new.
  const commits = app.git(dir, "rev-list", "--count", "HEAD");
  await palette(page, "today's entry");
  await expect(page).toHaveURL(new RegExp(`/scene/${/^id: (\S+)$/m.exec(readFileSync(join(dir, file), "utf8"))![1]}$`));
  expect(app.git(dir, "rev-list", "--count", "HEAD")).toBe(commits);
});

test("the calendar shows the month's entries, today marked, and a way to write today's", async ({ page, app }) => {
  await newJournal(page, app);
  await page.getByRole("link", { name: "Days" }).click();
  await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Calendar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("status").filter({ hasText: /entr/ })).toHaveText("No entries this month.");
  await axe(page);
  await page.getByRole("link", { name: "Write today's entry" }).click();
  await expect(page.getByRole("textbox", { name: "Entry text" })).toBeVisible();
  await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Calendar" }).click();
  await expect(page.getByRole("table").getByRole("link", { name: entryTitle(today()) })).toBeVisible();
  await expect(page.getByRole("main").getByRole("status").filter({ hasText: /entr/ })).toHaveText("1 entry, 0 words");
});

test("the desktop menu's Today's Entry runs it on the shelf, for the journal opened last", async ({ page, app }) => {
  await asDesktop(page);
  await newJournal(page, app);
  await page.evaluate(() => window.writer!.run({ name: "command", arg: "daily.today" }));
  // The desktop app opens the journal in a window of its own, at today's entry.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __calls: [string, { path?: string }][] }).__calls.filter(([c]) => c === "open_novel").map(([, a]) => a.path))).toEqual(["today"]);
});
