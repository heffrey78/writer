import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

/**
 * A journal keeper, a game master and a non-fiction writer never read "story" or "scene" (#125): on the
 * pages, in what a screen reader is told, or in the palette.
 */

const sample = (name: string) => fileURLToPath(new URL(`../../../examples/sample-${name}`, import.meta.url));
const NOVEL_WORDS = /\b(story|stories|scenes?)\b/i;

/** Every word of the page, and every name, hint and description given in attributes. */
const said = (page: Page) =>
  page.evaluate(() => {
    const attributes = ["aria-label", "title", "placeholder", "alt", "aria-description", "aria-valuetext"];
    const named = [...document.querySelectorAll("*")].flatMap((e) => attributes.flatMap((a) => e.getAttribute(a) ?? []));
    return [...document.body.innerText.split("\n"), ...named];
  });

async function clean(page: Page, where: string) {
  await page.waitForTimeout(500);
  expect((await said(page)).filter((line) => NOVEL_WORDS.test(line)), where).toEqual([]);
}

for (const [name, map] of [
  ["journal", "Journal map"],
  ["campaign", "Campaign map"],
  ["nonfiction", "Book map"],
] as const) {
  test(`a ${name} says its own words everywhere`, async ({ page, app }) => {
    test.setTimeout(120_000);
    await app.restart(app.bookRepo(sample(name), name));
    await page.goto(app.launchUrl);
    const views = page.getByRole("navigation", { name: "Views" });
    await expect(views).toBeVisible();
    const id = new URL(page.url()).pathname.split("/")[2]!;
    const go = async (path: string) => {
      await page.goto(new URL(`/novels/${id}/${path}`, app.url).href);
      await expect(views).toBeVisible();
      await clean(page, path);
    };
    await clean(page, "where it opens");
    await expect(views.getByRole("link", { name: map })).toBeVisible();

    for (const path of ["outline/table", "outline/cards", "outline/table?order=time", "outline/cards?order=time", "relationships", "notes", "progress", "bible", "compare"]) await go(path);

    await views.getByRole("link", { name: map }).click();
    await expect(page.getByRole("heading", { level: 1, name: map })).toBeVisible();
    await clean(page, "the map");
    for (const tab of await page.getByRole("tab").all()) {
      await tab.click();
      await clean(page, `the map's ${await tab.textContent()}`);
    }

    // A piece's page, with its details beside it, and an entry's profile.
    await go("bible");
    await page.getByRole("main").locator('a[href*="/bible/"]').first().click();
    await clean(page, "an entry");
    await page.keyboard.press("Escape");
    await page.goto(new URL(`/novels/${id}/outline/table`, app.url).href);
    await page.locator('a[href*="/scene/"]').first().click();
    await expect(views).toBeVisible();
    await clean(page, "a piece");
    await page.getByRole("tab", { name: "Notes" }).click();
    await clean(page, "a piece's notes");

    // Every command the palette offers.
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await clean(page, "the palette");
  });
}
