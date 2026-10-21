import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, launch, palette, selectionSettled, test, type App } from "./fixtures.ts";

/**
 * The Journal end to end (#40, #5): a new journal from the shelf, written in on three days (one in a
 * new month), with the people and places in it made from mentions, then put on GitHub and synced.
 */

const badge = (page: Page) => page.getByRole("button", { name: /^Sync: / });
const text = (page: Page) => page.getByRole("textbox", { name: "Entry text" });
const listbox = (page: Page) => page.getByRole("listbox", { name: "Mention suggestions" });

/** Sign in to the fake GitHub with a code, from the ⋯ menu. */
async function signIn(page: Page, app: App) {
  await page.getByRole("banner").getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: /Connect GitHub/ }).click();
  const dialog = page.getByRole("dialog", { name: "Connect to GitHub" });
  await dialog.getByRole("button", { name: "Sign in with a code" }).click();
  await expect(dialog.getByLabel("Your code")).toHaveText(app.github.userCode);
  app.github.approve();
  await expect(dialog).toHaveCount(0);
}

/** Today's entry, on `day` (the writer's clock), from the palette: written in where its text ends. */
async function write(page: Page, day: string, words: () => Promise<void>) {
  await page.clock.setFixedTime(new Date(`${day}T08:00:00`));
  await palette(page, "today's entry");
  await expect(page).toHaveURL(/\/scene\/ent_[0-9a-hjkmnp-tv-z]{6}$/);
  await text(page).click();
  await selectionSettled(page);
  await page.keyboard.press("ControlOrMeta+End");
  await words();
}

/** @ and a new name, made an index item of the type in the `row`th New row. */
async function newItem(page: Page, name: string, row: number) {
  await page.keyboard.type(`@${name}`);
  await expect(listbox(page)).toBeVisible();
  const made = listbox(page).getByRole("option", { name: new RegExp(`New .*${name}`) });
  await expect(made.nth(row)).toBeVisible();
  for (let i = 0; i <= row; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
}

test("a new journal, written in on three days, its people and places from mentions, synced to GitHub", async ({ page, app }) => {
  await launch(page, app);
  await signIn(page, app);
  await page.getByRole("list", { name: "Books" }).getByRole("button", { name: "New book" }).click();
  const dialog = page.getByRole("dialog", { name: "New book" });
  await dialog.getByRole("radio", { name: "Journal" }).check();
  await dialog.getByRole("textbox", { name: "Title" }).fill("Days");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "No months yet" })).toBeVisible();
  const dir = join(app.home, "writer", "days");

  await write(page, "2026-10-19", async () => {
    await page.keyboard.type("Out early with ");
    // A mention is followed by a space of its own.
    await newItem(page, "Mira Hale", 0);
    await page.keyboard.type("to ");
    await newItem(page, "The Spit", 1);
    await page.keyboard.press("Backspace");
    await page.keyboard.type(". Forty curlew.");
  });
  await expect(page.getByRole("heading", { level: 1, name: "October" })).toBeVisible();
  await write(page, "2026-10-20", async () => {
    await page.keyboard.type("Rain. ");
    await page.keyboard.type("@Mira");
    await expect(listbox(page).getByRole("option", { name: /Mira Hale/ }).first()).toBeVisible();
    await page.keyboard.press("Enter");
    await page.keyboard.type("came by anyway.");
  });
  await write(page, "2026-11-02", async () => {
    await page.keyboard.type("November already.");
  });
  await expect(page.getByRole("heading", { level: 1, name: "November" })).toBeVisible();

  // Each day in its month and year, its people and places in its fields, all saved.
  const entries = ["entries/01-2026/01-october/01-monday-19-october.md", "entries/01-2026/01-october/02-tuesday-20-october.md", "entries/01-2026/02-november/01-monday-2-november.md"];
  await expect.poll(() => readFileSync(join(dir, entries[2]!), "utf8"), { timeout: 10_000 }).toContain("November already.");
  const first = readFileSync(join(dir, entries[0]!), "utf8");
  expect(first).toMatch(/when:\n {2}at: 2026-10-19\n/);
  expect(first).toMatch(/Out early with \[Mira Hale\]\(#per_\w{6}\) to \[The Spit\]\(#pl_\w{6}\)\. Forty curlew\./);
  const mira = /\[Mira Hale\]\(#(per_\w{6})\)/.exec(first)![1]!;
  await expect.poll(() => readFileSync(join(dir, entries[0]!), "utf8")).toMatch(new RegExp(`people:\\n {2}- ${mira}\\n`));
  await expect.poll(() => readFileSync(join(dir, entries[1]!), "utf8"), { timeout: 10_000 }).toContain(`[Mira Hale](#${mira}) came by anyway.`);
  expect(readFileSync(join(dir, "index/people/mira-hale.md"), "utf8")).toContain(`id: ${mira}\n`);

  // Put on GitHub, from the sync badge, then synced: everything there.
  await badge(page).click();
  await page.getByRole("dialog").getByRole("button", { name: "Put on GitHub…" }).click();
  const publish = page.getByRole("dialog", { name: "Put on GitHub" });
  await publish.getByRole("button", { name: "Create and push" }).click();
  await expect(badge(page)).toHaveAccessibleName("Sync: Synced", { timeout: 15_000 });
  const remote = app.github.repoPath("ada", "days");
  for (const entry of entries) expect(app.git(remote, "show", `main:${entry}`), entry).toContain("---\nid: ent_");
  expect(app.git(remote, "show", `main:${entries[1]}`)).toContain("came by anyway.");
  expect(app.git(remote, "show", "main:book.yaml")).toMatch(/^kind: journal$/m);
});
