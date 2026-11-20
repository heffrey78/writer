import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { ID_ALPHABET } from "@writer/core";
import { writeBigNovel } from "./big-novel.ts";
import { expect, test, type App } from "./fixtures.ts";

/**
 * The index (#134) on a long book with a large story bible: 500 entries beside a 200,000-word
 * manuscript. It opens in under a second, and each step of working in it answers within 100 ms:
 * a letter typed in its search, the next entry opened with j, a filter taken off. Runs alone, after
 * the other tests.
 */

const BUDGET = 100;
/** An ID in the format's alphabet: char_000001, loc_000002… */
const id = (prefix: string, n: number) => `${prefix}_${Array.from({ length: 6 }, (_, i) => ID_ALPHABET[Math.floor(n / 32 ** (5 - i)) % 32]).join("")}`;
const OCCUPATIONS = ["Ferryman", "Toll keeper", "Clerk", "Engineer", "Baker", "Surveyor", "Teacher", "Fisher"];

/** A 200,000-word novel whose bible has 500 entries, each with a summary, fields, tags and notes. */
function bigBible(app: App): string {
  const dir = join(app.home, "novels", "the-long-crossing");
  writeBigNovel(dir, { total: 200_000, extraCharacters: 0 });
  for (let i = 1; i <= 400; i++) {
    const c = id("char", 1000 + i);
    writeFileSync(
      join(dir, "bible/characters", `${c}.md`),
      `---\nid: ${c}\nname: Person ${i} of Varn\nsummary: Someone from the ${i % 2 ? "east" : "west"} bank who remembers the old bridge.\nfields:\n  age: ${20 + (i % 60)}\n  occupation: ${OCCUPATIONS[i % OCCUPATIONS.length]}\ntags: [${i % 3 ? "town" : "river"}]\n---\nGrew up near pier ${1 + (i % 9)}. Keeps a ledger of the tolls.\n`,
    );
  }
  for (let i = 1; i <= 87; i++) {
    const l = id("loc", 1000 + i);
    writeFileSync(join(dir, "bible/locations", `${l}.md`), `---\nid: ${l}\nname: Place ${i} in Varn\nsummary: A corner of the town by the water.\ntags: [town]\n---\nCobbles, a lamp, the sound of the weir.\n`);
  }
  app.git(dir, "init", "-q");
  app.git(dir, "add", "-A");
  app.git(dir, "commit", "-qm", "Start");
  return dir;
}

/**
 * Each press of `key`, timed in the page from the key going down to the frame after the page has
 * answered it (`selector`'s text has changed, or it's gone): what the writer waits for, without the
 * test's own work in it.
 */
async function timed(page: Page, key: string, times: number, selector: string, until: "changed" | "gone"): Promise<number[]> {
  await page.evaluate(
    ({ key, selector, until }) => {
      const w = window as unknown as { answered: number[] };
      w.answered = [];
      document.addEventListener(
        "keydown",
        (e) => {
          if (e.key !== key) return;
          const start = e.timeStamp;
          const from = document.querySelector(selector)?.textContent;
          const done = () => (until === "gone" ? !document.querySelector(selector) : document.querySelector(selector)?.textContent !== from);
          const check = () => (done() ? requestAnimationFrame(() => w.answered.push(performance.now() - start)) : requestAnimationFrame(check));
          requestAnimationFrame(check);
        },
        true,
      );
    },
    { key, selector, until },
  );
  for (let i = 0; i < times; i++) {
    const before = await page.evaluate(() => (window as unknown as { answered: number[] }).answered.length);
    await page.keyboard.press(key);
    await page.waitForFunction((n) => (window as unknown as { answered: number[] }).answered.length > n, before, { polling: "raf" });
  }
  return page.evaluate(() => (window as unknown as { answered: number[] }).answered);
}

const report = (what: string, times: number[]) => {
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const result = `${what}: median ${median.toFixed(1)} ms, max ${sorted.at(-1)!.toFixed(1)} ms over ${times.length}`;
  console.log(result);
  test.info().annotations.push({ type: "performance", description: result });
  return median;
};

test("the index of a 500-entry bible opens in under a second, and searching, stepping and filtering each answer within 100 ms", async ({ page, app }) => {
  test.setTimeout(120_000);
  await app.restart(bigBible(app));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused({ timeout: 15_000 });

  // Opened from the sidebar, the book already loaded.
  const views = page.getByRole("navigation", { name: "Views" });
  const start = Date.now();
  await views.getByRole("link", { name: "Story bible" }).click();
  await expect(page.getByRole("region", { name: /^Characters/ }).getByRole("link").first()).toBeVisible();
  const opening = Date.now() - start;
  report("opening the index", [opening]);
  expect(opening).toBeLessThan(1000);

  // A letter typed in the search: the list matches it in the same frame (the search answers at once).
  const status = page.getByRole("status").filter({ hasText: / match/ });
  await page.keyboard.press("/");
  await page.evaluate(() => {
    const w = window as unknown as { latencies: number[] };
    w.latencies = [];
    document.addEventListener("keydown", (e) => {
      const start = e.timeStamp;
      requestAnimationFrame(() => setTimeout(() => w.latencies.push(performance.now() - start)));
    }, true);
  });
  await page.keyboard.type("ferryman", { delay: 150 });
  await expect(status).toHaveText(/^50 entries match “ferryman”/);
  const typed = report("a letter typed in the search", await page.evaluate(() => (window as unknown as { latencies: number[] }).latencies));

  // j: the next entry opened beside the list.
  // The entry's name: the first heading beside the list.
  const heading = page.locator("#index-entry h2").first();
  await page.keyboard.press("ArrowDown");
  await expect(heading).toHaveText(/^Person/);
  // Answered once the name beside the list is the next one's.
  const stepping = await timed(page, "j", 10, "#index-entry h2", "changed");
  const stepped = report("j to the next entry", stepping);

  // A filter taken off with Backspace: the list widens.
  await page.getByRole("searchbox", { name: "Search the bible" }).fill("");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  const adding = page.getByRole("dialog", { name: "Filter the bible" });
  await adding.getByRole("combobox", { name: "By" }).selectOption("tag");
  await adding.getByRole("combobox", { name: "Tag" }).selectOption("river");
  await adding.getByRole("button", { name: "Add the filter" }).click();
  await expect(status).toHaveText("133 entries match the filters");
  await page.getByRole("button", { name: "Remove the filter: Tag: river" }).focus();
  const filtering = await timed(page, "Backspace", 1, '[aria-label="Remove the filter: Tag: river"]', "gone");
  const filtered = report("a filter taken off", filtering);

  expect(typed).toBeLessThan(BUDGET);
  expect(stepped).toBeLessThan(BUDGET);
  expect(filtered).toBeLessThan(BUDGET);
});
