import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ID_ALPHABET } from "@writer/core";
import { entryTitle, MONTHS } from "../../modules/daily/src/core/index.ts";
import { expect, test, type App } from "./fixtures.ts";

/**
 * The journal page (#64) on a year of entries: it opens with the caret in today's place in under a
 * second, and typing in an entry on it stays within the editor's budget (50 ms at the 95th
 * percentile), with the entries near it in their own editors. Runs alone, after the other tests.
 */

const sample = fileURLToPath(new URL("../../../examples/sample-journal", import.meta.url));
const two = (n: number) => String(n).padStart(2, "0");
/** An ID in the format's alphabet: ent_000001, ent_000002… */
const id = (prefix: string, n: number) => `${prefix}_${Array.from({ length: 6 }, (_, i) => ID_ALPHABET[Math.floor(n / 32 ** (5 - i)) % 32]).join("")}`;

const DAY = [
  "Out early along the [Spit](#pl_5p1t00) before the tide turned. The mud was full of birds and the light came in low across the water.",
  "Saw [Mira](#per_m1ra00) at the shop; she says the boat is nearly done. We talked about the winter and whether the path will flood again.",
  "Rain most of the afternoon. Read by the window and wrote letters I won't send. The kettle, the radio, the wind in the flue.",
];

/** The sample journal, its entries replaced by one a day for all of 2026: 366 is a year and a day. */
function yearOfEntries(app: App): string {
  const dir = join(app.home, "novels", "a-year");
  cpSync(sample, dir, { recursive: true });
  rmSync(join(dir, "entries"), { recursive: true });
  const months: string[] = [];
  let n = 0;
  for (let m = 1; m <= 12; m++) {
    const folder = join(dir, "entries/01-2026", `${two(m)}-${MONTHS[m - 1]!.toLowerCase()}`);
    mkdirSync(folder, { recursive: true });
    const entries: string[] = [];
    const days = new Date(Date.UTC(2026, m, 0)).getUTCDate();
    for (let d = 1; d <= days; d++) {
      const day = `2026-${two(m)}-${two(d)}`;
      const entry = id("ent", ++n);
      entries.push(entry);
      const body = Array.from({ length: 4 }, (_, i) => DAY[(n + i) % DAY.length]).join("\n\n");
      writeFileSync(join(folder, `${two(d)}-${entryTitle(day).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`), `---\nid: ${entry}\ntitle: ${entryTitle(day)}\nstatus: kept\nwhen:\n  at: ${day}\n---\n${body}\n`);
    }
    const month = id("mon", m);
    months.push(month);
    writeFileSync(join(folder, "_month.yaml"), `id: ${month}\ntitle: ${MONTHS[m - 1]}\nentries: [${entries.join(", ")}]\n`);
  }
  writeFileSync(join(dir, "entries/01-2026/_year.yaml"), `id: yr_2026ab\ntitle: "2026"\nmonths: [${months.join(", ")}]\n`);
  app.git(dir, "init", "-q");
  app.git(dir, "add", "-A");
  app.git(dir, "commit", "-qm", "Start");
  return dir;
}

test.beforeEach(async ({ page }) => void (await page.clock.setFixedTime(new Date("2027-01-02T09:00:00"))));

test("a year's journal opens on its journal page, the caret in today's place, in under a second", async ({ page, app }) => {
  await app.restart(yearOfEntries(app));
  // Warm the browser's cache of the app's own files, as a second launch would have it; the journal itself is cold.
  await page.goto(`${app.launchUrl.replace(/\/novels\/[^?]+/, "/no-such-page")}`);
  await expect(page.getByRole("heading", { name: "Nothing here" })).toBeVisible();

  const start = Date.now();
  await page.goto(app.launchUrl.replace(/\?token=.*/, ""), { waitUntil: "commit" });
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Write today's entry", undefined, { polling: "raf", timeout: 10_000 });
  const elapsed = Date.now() - start;
  await expect(page.getByRole("list", { name: "Day by day" }).getByRole("article").nth(1)).toHaveAccessibleName("Thursday, 31 December");
  const result = `journal page ${elapsed} ms`;
  console.log(result);
  test.info().annotations.push({ type: "performance", description: result });
  expect(elapsed).toBeLessThan(1000);
});

test("typing in an entry on the journal page of a year's journal stays under 50 ms at the 95th percentile", async ({ page, app }) => {
  await app.restart(yearOfEntries(app));
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Write today's entry" })).toBeFocused({ timeout: 10_000 });
  const text = page.getByRole("textbox", { name: "Entry text: Thursday, 31 December" });
  await text.click();
  // Today's place and the entries near the screen in their editors too.
  await expect.poll(() => page.getByRole("list", { name: "Day by day" }).getByRole("textbox").count()).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => {
    const w = window as unknown as { latencies: number[] };
    w.latencies = [];
    document.addEventListener(
      "keydown",
      (e) => {
        const start = e.timeStamp;
        requestAnimationFrame(() => setTimeout(() => w.latencies.push(performance.now() - start)));
      },
      true,
    );
  });
  await page.keyboard.press("Control+End");
  const sentence = "The wind came off the river hard enough to lean on. ";
  for (let i = 0; i < 4; i++) {
    await page.keyboard.type(sentence, { delay: 20 });
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(500);
  const latencies = await page.evaluate(() => (window as unknown as { latencies: number[] }).latencies.sort((a, b) => a - b));
  const at = (q: number) => latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))]!;
  const result = `${latencies.length} keystrokes: p50 ${at(0.5).toFixed(1)} ms, p95 ${at(0.95).toFixed(1)} ms, max ${latencies.at(-1)!.toFixed(1)} ms`;
  console.log(result);
  test.info().annotations.push({ type: "latency", description: result });
  expect(latencies.length).toBeGreaterThan(200);
  expect(at(0.95)).toBeLessThan(50);
});
