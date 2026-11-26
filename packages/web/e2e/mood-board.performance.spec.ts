import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.ts";

/**
 * #207: a mood board of 200 cards (pictures alone, notes and entries, as a game master's board for a
 * whole campaign might be) opens in under 2 s, and panning it across keeps frames under 50 ms at the
 * 95th percentile. Runs alone, after the other tests.
 */

const sample = fileURLToPath(new URL("../../../examples/sample-campaign", import.meta.url));

test("a board of 200 cards opens quickly and pans smoothly", async ({ page, app }) => {
  const dir = app.bookRepo(sample, "big-board");
  mkdirSync(join(dir, "boards"));
  const kinds = ["  - { note: note_tab1e0", "  - { entry: npc_ma7ra1", "  - { entry: loc_be1fry", '  - { picture: images/nothing-here.png, description: "A picture"'];
  const cards = Array.from({ length: 200 }, (_, i) => `${kinds[i % kinds.length]}, at: [ ${(i % 20) * 240}, ${Math.floor(i / 20) * 260} ], size: [ 220, 240 ] }\n`);
  writeFileSync(join(dir, "boards/everything.yaml"), `id: board_aaaaaa\ntitle: Everything\ncards:\n${cards.join("")}`);
  app.git(dir, "add", "-A");
  app.git(dir, "commit", "-qm", "A big board");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  const link = page.getByRole("navigation", { name: "Views" }).getByRole("list", { name: "Boards" }).getByRole("link", { name: "Everything" });
  await expect(link).toBeVisible();

  const start = Date.now();
  await link.click();
  await expect(page.getByRole("region", { name: "Board: Everything, 200 cards" })).toBeVisible();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  const opened = Date.now() - start;
  await page.evaluate(() => new Promise((done) => setTimeout(done, 500))); // fitView and fonts settle

  // Frame times while dragging the board across.
  await page.evaluate(() => {
    const w = window as unknown as { frames: number[]; recording: boolean };
    w.frames = [];
    w.recording = true;
    let last = performance.now();
    const tick = (t: number) => {
      w.frames.push(t - last);
      last = t;
      if (w.recording) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const pane = (await page.locator(".react-flow__pane").boundingBox())!;
  const viewport = page.locator(".react-flow__viewport");
  const before = await viewport.getAttribute("style");
  // From an empty spot: the gap between the first row's cards and the second's, near the top left.
  const x = pane.x + 20, y = pane.y + 20;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 90; i++) {
    await page.mouse.move(x + i * 4, y + Math.sin(i / 8) * 60 + i);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await page.mouse.up();
  expect(await viewport.getAttribute("style")).not.toBe(before); // it really panned
  const frames = await page.evaluate(() => {
    const w = window as unknown as { frames: number[]; recording: boolean };
    w.recording = false;
    return w.frames.slice(1);
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
  const worst = sorted[sorted.length - 1]!;

  const result = `open 200 cards: ${opened} ms; pan: ${frames.length} frames, p95 ${p95.toFixed(1)} ms, worst ${worst.toFixed(1)} ms`;
  console.log(result);
  test.info().annotations.push({ type: "performance", description: result });
  expect(opened).toBeLessThan(2000);
  expect(p95).toBeLessThan(50);
});
