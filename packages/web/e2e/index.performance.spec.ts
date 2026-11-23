import type { Locator, Page } from "@playwright/test";
import { BIG_INDEX, OCCUPATIONS, writeBigIndex } from "./big-index.ts";
import { expect, test } from "./fixtures.ts";

/**
 * The index (#134, #177) on a long book with a large index: about 500 entries across the kind's types,
 * their fields declared and filled in, related and mentioned through a 200,000-word manuscript
 * (big-index.ts). It opens in under a second, and each step of working in it answers within 100 ms:
 * a letter typed in its search, the next entry opened with j, a filter taken off, Quick look opened
 * over it (#141). An entry's profile lists every passage naming its main character within 50 ms (#135);
 * Tidy up counts what has drifted within 500 ms (#137). Its Table of 500 characters sorts by a column
 * within 100 ms and scrolls at 60 frames a second (#170). A step timed more than once is judged by its
 * median, so one slow frame on a busy machine doesn't fail it. Runs alone, after the other tests.
 */

const BUDGET = 100;
const PASSAGES_BUDGET = 50;
const TIDY_BUDGET = 500;
const ADA = "char_7f3k2q";

/**
 * Each press of `key`, timed in the page from the key going down to the frame after the page has
 * answered it (`selector`'s text has changed, it's gone, or it's there): what the writer waits for,
 * without the test's own work in it. `press` is what's pressed, when it isn't the key alone (Ctrl+;);
 * `between` runs after each answer (closing what it opened).
 */
async function timed(page: Page, key: string, times: number, selector: string, until: "changed" | "gone" | "there", { press = key, between }: { press?: string; between?: () => Promise<void> } = {}): Promise<number[]> {
  await page.evaluate(
    ({ key, selector, until }) => {
      const w = window as unknown as { answered: number[]; timing?: (e: KeyboardEvent) => void };
      w.answered = [];
      // One listener at a time; on the window, as it's captured: a key the page takes there (Quick look's) still reaches it.
      if (w.timing) window.removeEventListener("keydown", w.timing, true);
      w.timing = (e: KeyboardEvent) => {
        if (e.key !== key) return;
        const start = e.timeStamp;
        const from = document.querySelector(selector)?.textContent;
        const done = () => (until === "gone" ? !document.querySelector(selector) : until === "there" ? !!document.querySelector(selector) : document.querySelector(selector)?.textContent !== from);
        const check = () => (done() ? requestAnimationFrame(() => w.answered.push(performance.now() - start)) : requestAnimationFrame(check));
        requestAnimationFrame(check);
      };
      window.addEventListener("keydown", w.timing, true);
    },
    { key, selector, until },
  );
  for (let i = 0; i < times; i++) {
    const before = await page.evaluate(() => (window as unknown as { answered: number[] }).answered.length);
    await page.keyboard.press(press);
    await page.waitForFunction((n) => (window as unknown as { answered: number[] }).answered.length > n, before, { polling: "raf" });
    await between?.();
  }
  return page.evaluate(() => (window as unknown as { answered: number[] }).answered);
}

/** A click on `on`, timed in the page from the click to the frame after `selector` is there. */
async function clicked(page: Page, on: Locator, selector: string): Promise<number> {
  await page.evaluate((selector) => {
    const w = window as unknown as { clicked?: number };
    delete w.clicked;
    document.addEventListener(
      "click",
      (e) => {
        const start = e.timeStamp;
        const check = () => (document.querySelector(selector) ? requestAnimationFrame(() => (w.clicked = performance.now() - start)) : requestAnimationFrame(check));
        requestAnimationFrame(check);
      },
      { capture: true, once: true },
    );
  }, selector);
  await on.click();
  return page.waitForFunction(() => (window as unknown as { clicked?: number }).clicked, undefined, { polling: "raf" }).then((h) => h.jsonValue() as Promise<number>);
}

const report = (what: string, times: number[]) => {
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const result = `${what}: median ${median.toFixed(1)} ms, max ${sorted.at(-1)!.toFixed(1)} ms over ${times.length}`;
  console.log(result);
  test.info().annotations.push({ type: "performance", description: result });
  return median;
};

test("the index of a 500-entry book opens in under a second; searching, stepping, filtering and Quick look each answer within 100 ms; Tidy up counts within 500 ms", async ({ page, app }) => {
  test.setTimeout(180_000);
  await app.restart(writeBigIndex(app));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused({ timeout: 15_000 });

  // Opened from the sidebar, the book already loaded.
  const views = page.getByRole("navigation", { name: "Views" });
  const opening = report("opening the index", [await clicked(page, views.getByRole("link", { name: "Story bible" }), '[aria-labelledby^="type-"] li a')]);
  await expect(page.getByRole("region", { name: /^Characters/ }).getByRole("link").first()).toBeVisible();

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
  await expect(status).toHaveText(new RegExp(`^${Math.ceil(BIG_INDEX.characters / OCCUPATIONS.length)} entries match “ferryman”`));
  const typed = report("a letter typed in the search", await page.evaluate(() => (window as unknown as { latencies: number[] }).latencies));

  // j: the next entry opened beside the list. Answered once the name beside the list (its first heading) is the next one's.
  const heading = page.locator("#index-entry h2").first();
  await page.keyboard.press("ArrowDown");
  await expect(heading).not.toBeEmpty();
  const stepped = report("j to the next entry", await timed(page, "j", 10, "#index-entry h2", "changed"));

  // A filter taken off with Backspace, five times over: the list widens.
  await page.getByRole("searchbox", { name: "Search the bible" }).fill("");
  const filtering: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.getByRole("button", { name: "Filter", exact: true }).click();
    const adding = page.getByRole("dialog", { name: "Filter the bible" });
    await adding.getByRole("combobox", { name: "By" }).selectOption("tag");
    await adding.getByRole("combobox", { name: "Tag" }).selectOption("river");
    await adding.getByRole("button", { name: "Add the filter" }).click();
    await expect(status).toHaveText(`${Math.ceil(BIG_INDEX.characters / 3)} entries match the filters`);
    await page.getByRole("button", { name: "Remove the filter: Tag: river" }).focus();
    filtering.push(...(await timed(page, "Backspace", 1, '[aria-label="Remove the filter: Tag: river"]', "gone")));
  }
  const filtered = report("a filter taken off", filtering);

  // Quick look over the index, five times: from Ctrl+; to the frame its first result is drawn in.
  const quickLook = page.getByRole("dialog", { name: "Quick look" });
  const looked = report(
    "opening Quick look",
    await timed(page, ";", 5, '[role="dialog"] [cmdk-item]', "there", {
      press: "Control+;",
      between: async () => {
        await expect(quickLook.getByRole("option").first()).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(quickLook).toHaveCount(0);
      },
    }),
  );

  // Tidy up, three times: from its button pressed to the frame its counts are drawn in.
  const tidying: number[] = [];
  for (let i = 0; i < 3; i++) {
    tidying.push(await clicked(page, page.getByRole("button", { name: "Tidy up" }), '[role="tablist"][aria-label="What to tidy"]'));
    await expect(page.getByRole("tab", { name: /Names not linked$/ })).not.toHaveText(/^0/);
    await page.goBack();
    await expect(page.getByRole("button", { name: "Tidy up" })).toBeVisible();
  }
  const tidied = report("Tidy up's counts", tidying);

  // Ada Varn's profile, in a fresh page: every passage of the 200,000 words naming her, worked out
  // from nothing (as the profile times it).
  await page.goto(new URL(`${new URL(page.url()).pathname.replace(/\/bible.*$/, "")}/bible/${ADA}`, page.url()).href);
  await expect(page.getByRole("region", { name: /^Appears in · \d{3,}/ })).toBeVisible({ timeout: 15_000 });
  const listing = await page.evaluate(
    (id) => performance.getEntriesByName("passages").filter((m) => (m as PerformanceMeasure).detail === id).map((m) => m.duration),
    ADA,
  );
  const passages = report("listing a main character's passages", listing.slice(0, 1));

  expect(opening).toBeLessThan(1000);
  expect(typed).toBeLessThan(BUDGET);
  expect(stepped).toBeLessThan(BUDGET);
  expect(filtered).toBeLessThan(BUDGET);
  expect(looked).toBeLessThan(BUDGET);
  expect(tidied).toBeLessThan(TIDY_BUDGET);
  expect(passages).toBeLessThan(PASSAGES_BUDGET);
});

test("a table of 500 characters draws in under a second, sorts by a column within 100 ms and scrolls at 60 frames a second (#170)", async ({ page, app }) => {
  test.setTimeout(120_000);
  await app.restart(writeBigIndex(app, { characters: 496 }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused({ timeout: 15_000 });
  await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Story bible" }).click();
  await page.getByRole("button", { name: "Table" }).click();

  const drawing = report("drawing a table of 500 characters", [await clicked(page, page.getByRole("button", { name: /^Characters/ }), '[role="grid"] tbody tr[aria-rowindex]')]);
  const grid = page.getByRole("grid", { name: /^Characters/ });
  await expect(grid).toHaveAttribute("aria-rowcount", "501");

  // Enter on the Age header's button, again and again: youngest first, then oldest first.
  await grid.getByRole("button", { name: "Age" }).focus();
  const sorting = await timed(page, "Enter", 6, "tbody tr[aria-rowindex] td:nth-child(2)", "changed");
  const sorted = report("sorting 500 rows by age", sorting);

  // Ctrl+End to the last cell, a row not drawn yet: drawn, in focus and in view; Ctrl+Home back.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Control+End");
  await expect(grid.locator('tbody tr[aria-rowindex="501"] td').last()).toBeFocused();
  await expect(grid.locator('tbody tr[aria-rowindex="501"]')).toBeInViewport();
  await page.keyboard.press("Control+Home");
  await expect(grid.locator('tbody tr[aria-rowindex="2"] input[type="checkbox"]')).toBeFocused();

  // Scrolled from top to bottom by the wheel: the time between frames as it goes, and the last row reached.
  await page.mouse.move(700, 500);
  await page.evaluate(() => {
    const w = window as unknown as { frames: number[]; framing: boolean };
    w.frames = [];
    w.framing = true;
    let last = performance.now();
    const tick = (now: number) => {
      w.frames.push(now - last);
      last = now;
      if (w.framing) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  for (let i = 0; i < 50; i++) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(16);
  }
  const frames = await page.evaluate(() => {
    const w = window as unknown as { frames: number[]; framing: boolean };
    w.framing = false;
    return w.frames.slice(1);
  });
  const frame = report("a frame while scrolling 500 rows", frames);
  await expect(grid.locator('tbody tr[aria-rowindex="501"]')).toBeVisible();

  expect(drawing).toBeLessThan(1000);
  expect(sorted).toBeLessThan(BUDGET);
  // 60 frames a second: a frame every 16.7 ms, give or take the timer's grain.
  expect(frame).toBeLessThan(20);
});
