import { devices, type Page } from "@playwright/test";
import { THEMES, tokensOf } from "../src/themes.ts";
import { axe, expect, launch, palette, test } from "./fixtures.ts";

/*
 * The Theme picker (#190): light or dark and the five themes, each applied as it's picked and kept on
 * this device; by keyboard, from the palette, and on a phone.
 */

const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const asRgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

test("each theme picked by keyboard paints the app as it's picked, is audited light and dark, and stays after a reload", async ({ page, app }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ colorScheme: "light" });
  await launch(page, app);
  await palette(page, "theme…");
  const picker = page.getByRole("dialog", { name: "Theme" });
  await expect(picker.getByRole("radio", { name: "Follow the system" })).toBeFocused();
  await expect(picker).toContainText("This computer is light at the moment; Writer turns dark with it.");
  // To the colors: the chosen one, Paper, takes the focus; the arrows pick the next.
  await page.keyboard.press("Tab");
  await expect(picker.getByRole("radio", { name: "Paper" })).toBeFocused();
  await expect(picker.getByRole("radio", { name: "Paper" })).toHaveAccessibleDescription("Today's look, and the default");
  for (const theme of THEMES) {
    if (theme.id !== "paper") await page.keyboard.press("ArrowDown");
    await expect(picker.getByRole("radio", { name: theme.name })).toBeChecked();
    await expect.poll(() => background(page), theme.name).toBe(asRgb(tokensOf(theme, "light").paper));
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect.poll(() => background(page), `${theme.name} ${colorScheme}`).toBe(asRgb(tokensOf(theme, colorScheme).paper));
      await axe(page);
    }
    await page.emulateMedia({ colorScheme: "light" });
  }
  // Contrast, kept on this device after a reload, with no picker open.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "contrast");
  expect(await background(page)).toBe("rgb(255, 255, 255)");

  // Back to Paper: today's look, following the system.
  await palette(page, "theme: dark");
  await palette(page, "theme…");
  await picker.getByRole("button", { name: "Back to Paper" }).click();
  await expect(picker.getByRole("radio", { name: "Paper" })).toBeChecked();
  await expect(picker.getByRole("radio", { name: "Follow the system" })).toBeChecked();
  await expect(page.locator("html")).not.toHaveAttribute("data-palette");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  expect(await page.evaluate(() => localStorage.getItem("ghw:appearance"))).toBe(JSON.stringify({ mode: "system", palette: "paper" }));
});

test("the palette has a command for each theme beside light, dark and the system's, and shows which is on", async ({ page, app }) => {
  await launch(page, app);
  await palette(page, "theme: moss");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "moss");
  await palette(page, "theme: dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await background(page)).toBe(asRgb(tokensOf(THEMES.find((t) => t.id === "moss")!, "dark").paper));
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("theme:");
  await expect(page.getByRole("option", { name: /^Theme: / })).toHaveText([/follow the system/, /light/, /dark/, /Paper/, /Study/, /Slate/, /Moss/, /Contrast/]);
  await page.keyboard.press("Escape");
});

test.describe("on a phone", () => {
  const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices["Pixel 7"]!;
  test.use({ viewport: { ...viewport, width: 390 }, deviceScaleFactor, isMobile, hasTouch, userAgent });

  test("the picker fills the screen, fits it, and Escape (Android's back) leaves it", async ({ page, app }) => {
    await launch(page, app);
    await page.getByRole("banner").getByRole("button", { name: "More" }).tap();
    await page.getByRole("menuitem", { name: "Theme…" }).tap();
    const picker = page.getByRole("dialog", { name: "Theme" });
    await expect(picker).toBeVisible();
    const box = (await picker.boundingBox())!;
    expect([box.x, box.y, box.width]).toEqual([0, 0, 390]);
    expect(await picker.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await picker.getByText("Study", { exact: true }).tap();
    await expect(page.locator("html")).toHaveAttribute("data-palette", "study");
    await picker.getByRole("button", { name: "Done" }).scrollIntoViewIfNeeded();
    await axe(page);
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
  });
});
