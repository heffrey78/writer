import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { axe, expect, openView, palette, test, type App } from "./fixtures.ts";

/**
 * The Campaign kind on screen (#41): the sample campaign's arc and sessions, its codex of NPCs,
 * player characters, locations, factions, items and quests, its outline, story map and graph, in a
 * game master's words, with nothing of the Novel's story-only modules.
 */

const sample = fileURLToPath(new URL("../../../examples/sample-campaign", import.meta.url));
/** No novel's words anywhere on the page. */
const novelWords = /\b(scenes?|chapters?|manuscript|story bible|novel|off the page|plotlines?|point of view|drafting board)\b/i;

async function open(page: Page, app: App) {
  await app.restart(app.bookRepo(sample, "campaign"));
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Arc text" })).toBeFocused();
}

test("opens in its arc and sessions, in a game master's words", async ({ page, app }) => {
  await open(page, app);
  await expect(page.getByRole("heading", { level: 1, name: "The Drowned Bell" })).toBeVisible();
  const tree = page.getByRole("tree");
  for (const name of ["The Drowned Bell", "Session 1", "Session 2"]) await expect(tree.getByRole("treeitem", { name, exact: false }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(novelWords);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }
});

test("its codex, outline and story map say its words too", async ({ page, app }) => {
  await open(page, app);
  await palette(page, "codex");
  await expect(page.getByRole("heading", { level: 1, name: "Codex" })).toBeVisible();
  for (const type of ["NPCs", "Player characters", "Locations", "Factions", "Items", "Quests"]) await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^${type}`) })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(novelWords);

  await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Outline" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Outline" })).toBeVisible();
  // Table and Cards: no drafting board for a campaign.
  await expect(page.getByRole("radiogroup", { name: "Show the outline as" }).getByRole("radio")).toHaveCount(2);
  await expect(page.locator("main")).not.toContainText(novelWords);

  await palette(page, "story map: timeline");
  await expect(page.getByRole("tabpanel", { name: "Timeline" }).getByRole("link", { name: "Session 2" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(novelWords);
});

test("the graph shows an NPC change sides at a session", async ({ page, app }) => {
  await open(page, app);
  await openView(page, "Relationships");
  await expect(page.getByRole("heading", { level: 1, name: "Relationships" })).toBeVisible();
  const slider = page.getByRole("slider", { name: /position$/ });
  await expect(slider).toHaveAttribute("aria-valuetext", "Session 1 of 2: Session 1, in The Drowned Bell");
  const edge = (name: string) => page.locator(`.react-flow__edge[aria-label="${name}"]`);
  await expect(edge("Marta Hollin, Member of, The Watch")).toHaveCount(1);
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(edge("Marta Hollin, Member of, The Tide Choir")).toHaveCount(1);
  await expect(edge("Marta Hollin, Member of, The Watch")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(novelWords);
  await axe(page);
});
