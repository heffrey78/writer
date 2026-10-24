import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readAnchor } from "@writer/core";
import type { Page } from "@playwright/test";
import { axe, expect, palette, selectionSettled, test, type App } from "./fixtures.ts";

/**
 * The Journal kind on screen (#36): the sample journal's months and entries, its index of people,
 * places, events and values, its outline and story map, in a journal's words, with nothing of the
 * Novel's story-only modules. It opens on its journal page (#64), on 23 October 2026: today's place
 * first, then its entries newest first.
 */

const sample = fileURLToPath(new URL("../../../examples/sample-journal", import.meta.url));
/** No novel's words anywhere on the page. */
const novelWords = /\b(scenes?|chapters?|manuscript|story bible|novel|off the page|plotlines?|point of view|drafting board)\b/i;

const begin = (page: Page) => page.getByRole("textbox", { name: "Write today's entry" });

async function open(page: Page, app: App) {
  const dir = app.bookRepo(sample, "journal");
  await page.clock.setFixedTime(new Date("2026-10-23T09:00:00"));
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(begin(page)).toBeFocused();
  return dir;
}

test("opens on its journal page, in its months and entries, in a journal's words", async ({ page, app }) => {
  await open(page, app);
  await expect(page.getByRole("heading", { level: 1, name: "Day by day" })).toBeVisible();
  const tree = page.getByRole("tree");
  for (const name of ["2026", "September", "October", "Monday, 28 September", "Thursday, 1 October"]) await expect(tree.getByRole("treeitem", { name, exact: false }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(novelWords);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }
});

test("its sidebar looks back first, then at its people and places, with no outline or comparing", async ({ page, app }) => {
  await open(page, app);
  const views = page.getByRole("navigation", { name: "Views" });
  await expect(views.getByRole("heading")).toHaveText(["Look back", "People and places"]);
  // Issues only for a journal on GitHub, which the sample isn't.
  await expect(views.getByRole("group", { name: "Look back" }).getByRole("link")).toHaveText(["Day by day", "Calendar", "Notes"]);
  await expect(views.getByRole("group", { name: "People and places" }).getByRole("link")).toHaveText(["Index", "Relationships", "Story map", "Progress"]);
  // Collapsed to its strip, in the same order.
  await page.getByRole("button", { name: "Collapse the sidebar" }).click();
  const strip = page.getByRole("navigation", { name: "Views" }).getByRole("link");
  await expect.poll(() => strip.evaluateAll((links) => links.map((l) => l.getAttribute("aria-label")))).toEqual(["Journal", "Day by day", "Calendar", "Notes", "Index", "Relationships", "Story map", "Progress"]);
});

test("its index, outline and story map say its words too", async ({ page, app }) => {
  await open(page, app);
  await palette(page, "index");
  await expect(page.getByRole("heading", { level: 1, name: "Index" })).toBeVisible();
  for (const type of ["People", "Places", "Events", "Values"]) await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^${type} \\d`) })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(novelWords);

  // Not in a journal's sidebar, but still in the palette.
  await palette(page, "outline");
  await expect(page.getByRole("heading", { level: 1, name: "Outline" })).toBeVisible();
  // Table and Cards: no drafting board for a journal.
  await expect(page.getByRole("radiogroup", { name: "Show the outline as" }).getByRole("radio")).toHaveCount(2);
  await expect(page.locator("main")).not.toContainText(novelWords);

  await palette(page, "story map: timeline");
  await expect(page.getByRole("tabpanel", { name: "Timeline" }).getByRole("link", { name: "Thursday, 1 October" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(novelWords);
});

test("written where it's read: today on top, made with its first words, and earlier entries newest first, written in place", async ({ page, app }) => {
  const dir = await open(page, app);
  const commits = Number(app.git(dir, "rev-list", "--count", "HEAD"));
  const entries = page.getByRole("list", { name: "Day by day" }).getByRole("article");
  await expect(entries).toHaveCount(6);
  await expect(entries.first().getByRole("heading", { level: 2 })).toHaveText("Friday, 23 October");
  await expect(entries.nth(1).getByRole("heading", { level: 2 })).toHaveText("Sunday, 4 October");
  await expect(entries.nth(2).getByRole("heading", { level: 2 })).toHaveText("Saturday, 3 October");
  await expect(entries.nth(1)).toContainText("Nothing much. A quiet day is a day too.");
  await expect(entries.nth(1).locator("time")).toHaveText("4 October 2026");
  await expect(page.locator("body")).not.toContainText(novelWords);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }

  // Typed at once: the entry is made in its month, in one commit, and the typing goes on in it.
  await selectionSettled(page);
  await page.keyboard.type("Fog on the water till noon.");
  const made = "entries/01-2026/02-october/04-friday-23-october.md";
  await expect.poll(() => app.git(dir, "log", "-1", "--format=%s").trim(), { timeout: 10_000 }).toBe("Journal: add entry “Friday, 23 October”");
  await page.keyboard.type(" Then sun.");
  await expect.poll(() => readFileSync(join(dir, made), "utf8"), { timeout: 10_000 }).toContain("\nFog on the water till noon. Then sun.\n");
  expect(Number(app.git(dir, "rev-list", "--count", "HEAD"))).toBe(commits + 1);
  expect(readFileSync(join(dir, made), "utf8")).toContain("when:\n  at: 2026-10-23\n");
  // The same text box, still named as the place was, in the entry made.
  await expect(entries.first()).toHaveAccessibleName("Friday, 23 October");
  await expect(begin(page)).toBeFocused();
  await expect(entries.first().locator("time")).toHaveText("23 October 2026");

  // Down off its end, into the entry before it, written in where it is.
  await page.keyboard.press("ArrowDown");
  const sunday = page.getByRole("textbox", { name: "Entry text: Sunday, 4 October" });
  await expect(sunday).toBeFocused();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Rain at dusk.");
  const sundayFile = join(dir, "entries/01-2026/02-october/03-sunday-4-october.md");
  await expect.poll(() => readFileSync(sundayFile, "utf8"), { timeout: 10_000 }).toContain("A quiet day is a day too. Rain at dusk.\n");

  // The palette's writing commands act on the entry with the caret: a footnote, the entry's details.
  await page.keyboard.press("Alt+PageDown");
  const saturday = page.getByRole("textbox", { name: "Entry text: Saturday, 3 October" });
  await expect(saturday).toBeFocused();
  await page.keyboard.press("ControlOrMeta+End");
  await palette(page, "add a footnote");
  // The command runs once the palette has given the text its focus back: then the caret is in the note.
  await expect(saturday.locator("aside.ghw-footnote")).toHaveCount(1);
  await selectionSettled(page);
  await page.keyboard.type("High tide at six.");
  const saturdayFile = join(dir, "entries/01-2026/02-october/02-saturday-3-october.md");
  await expect.poll(() => readFileSync(saturdayFile, "utf8"), { timeout: 10_000 }).toContain("[^1]: High tide at six.\n");
  expect(readFileSync(sundayFile, "utf8")).not.toContain("[^1]");
  await palette(page, "show the entry's details");
  await expect(page.getByRole("complementary", { name: "Right sidebar" }).getByRole("region", { name: "Details of “Saturday, 3 October”" })).toBeVisible();

  // Reading: the text only. A name opens its index entry, within the app.
  await page.getByRole("button", { name: "Reading" }).click();
  await expect(page.getByRole("button", { name: "Reading" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("list", { name: "Day by day" }).getByRole("textbox")).toHaveCount(0);
  await expect(entries.first()).toContainText("Fog on the water till noon. Then sun.");
  await entries.nth(2).getByRole("link", { name: "the sluice" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "The Old Sluice" })).toBeVisible();
  await page.goBack();
  await page.getByRole("button", { name: "Reading" }).click();

  // A title opens the entry alone.
  await entries.nth(1).getByRole("link", { name: "Sunday, 4 October" }).click();
  await expect(page).toHaveURL(/\/scene\/ent_\w{6}$/);
  await expect(page.getByRole("textbox", { name: "Entry text", exact: true })).toContainText("Rain at dusk.");
});

test("today's place, left untouched, makes nothing", async ({ page, app }) => {
  const dir = await open(page, app);
  const head = app.git(dir, "rev-parse", "HEAD");
  await page.keyboard.press("Tab");
  await palette(page, "index");
  await expect(page.getByRole("heading", { level: 1, name: "Index" })).toBeVisible();
  expect(app.git(dir, "rev-parse", "HEAD")).toBe(head);
  expect(app.git(dir, "status", "--porcelain")).toBe("");
});

test("an issue is raised about a passage in today's entry, written in its place, and in an earlier entry written in place (#70)", async ({ page, app }) => {
  const dir = await open(page, app);
  const id = new URL(page.url()).pathname.split("/")[2]!;
  // On the (fake) GitHub, signed in through the device flow without the dialog.
  const headers = { origin: app.url };
  expect((await page.request.post(`${app.url}/api/github/device`, { headers })).ok()).toBe(true);
  app.github.approve();
  await expect.poll(async () => ((await (await page.request.post(`${app.url}/api/github/device/poll`, { headers })).json()) as { status: string }).status).toBe("done");
  const published = await page.request.post(`${app.url}/api/novels/${id}/publish`, { data: { name: "journal" }, headers });
  expect(published.ok(), await published.text()).toBe(true);
  const repo = app.github.issues("ada", "journal");
  await expect(page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Issues" })).toBeVisible();

  // Today's entry, made on its first words in the editor of the place it began in.
  await begin(page).click();
  await selectionSettled(page);
  await page.keyboard.type("Fog on the water till noon.");
  await expect(page.getByRole("list", { name: "Day by day" }).getByRole("article").first().locator("time")).toHaveText("23 October 2026");
  const today = begin(page);
  const passage = today.getByText("Fog on the water till noon.");
  await passage.click({ clickCount: 3 });
  await passage.click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Selected text" }).getByRole("menuitem", { name: "Raise an issue…" })).toBeFocused();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("complementary", { name: "Raise an issue" });
  await expect(panel).toContainText("in “Friday, 23 October”");
  await expect(panel).not.toContainText(novelWords);
  await panel.getByRole("textbox", { name: "Title" }).fill("Which water?");
  await panel.getByRole("textbox", { name: "Title" }).press("Enter");
  await expect(panel).toHaveCount(0);
  await expect(today).toBeFocused();
  await expect.poll(() => repo.issues.length).toBe(1);
  const made = readFileSync(join(dir, "entries/01-2026/02-october/04-friday-23-october.md"), "utf8");
  expect(readAnchor(repo.issues[0]!.body)).toMatchObject({ scene: made.match(/^id: (ent_\w+)$/m)![1], quote: "Fog on the water till noon." });

  // An earlier entry, from the palette.
  const sunday = page.getByRole("textbox", { name: "Entry text: Sunday, 4 October" });
  await sunday.getByText(/A quiet day is a day too\./).click({ clickCount: 3 });
  await palette(page, "raise an issue about the selection");
  await expect(panel).toContainText("in “Sunday, 4 October”");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(sunday).toBeFocused();
});
