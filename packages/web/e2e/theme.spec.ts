import { devices, type Page } from "@playwright/test";
import { derive, THEMES, tokensOf } from "../src/themes.ts";
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

test("your own colors: started from the theme on screen, a too-faint link moved to the nearest shade that reads, named and said, a hex code typed, and kept (#191)", async ({ page, app }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ colorScheme: "light" });
  await launch(page, app);
  const token = (name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(`--ghw-${n}`).trim(), name);
  await palette(page, "theme: slate");
  await palette(page, "theme…");
  const picker = page.getByRole("dialog", { name: "Theme" });
  await picker.getByText("Your own", { exact: true }).click();
  const own = picker.getByRole("region", { name: "Your own, light, started from Slate" });
  await expect(own).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "own");
  await expect(own.getByRole("group", { name: "Paper" }).getByRole("radio", { name: "Paper #f7f8fa" })).toBeChecked();
  await expect(own.getByRole("textbox", { name: "Links color, as a hex code" })).toHaveValue("#3451c6");
  expect(await background(page)).toBe("rgb(247, 248, 250)");
  await axe(page);

  // A link color that doesn't read on this paper, by keyboard: its nearest shade that does is used, and said.
  await own.getByRole("radio", { name: "Links #3451c6" }).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(own.getByRole("radio", { name: "Links #e0b84a" })).toBeChecked();
  const shade = derive({ paper: "#f7f8fa", ink: "#1b2130", accent: "#e0b84a" }).accent;
  const checks = own.getByRole("list");
  await expect(checks).toHaveAttribute("aria-live", "polite");
  const links = checks.getByRole("listitem").filter({ hasText: "Links and the focus ring" });
  await expect(links).toContainText("Too faint on this paper (4.5 : 1 needed). Writer uses the nearest shade that reads:");
  await expect(links.locator("code")).toHaveText(shade);
  await expect.poll(() => token("accent")).toBe(shade);
  await expect(own.getByRole("textbox", { name: "Links color, as a hex code" })).toHaveValue("#e0b84a");
  await axe(page);

  // A paper typed as a hex code, without its #: taken once it's whole; half a code is said to be wrong.
  const paper = own.getByRole("textbox", { name: "Paper color, as a hex code" });
  await paper.fill("fdf6");
  await expect(paper).toHaveAttribute("aria-invalid", "true");
  expect(await background(page)).toBe("rgb(247, 248, 250)");
  await paper.fill("FDF6E3");
  await expect.poll(() => background(page)).toBe("rgb(253, 246, 227)");
  await expect(paper).not.toHaveAttribute("aria-invalid");
  await expect(own.getByRole("radio", { name: "Paper #fdf6e3" })).toBeChecked();

  // Dark has its own three, from Slate's dark, and is audited too.
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(picker.getByRole("region", { name: "Your own, dark, started from Slate" })).toBeVisible();
  await expect.poll(() => background(page)).toBe("rgb(19, 22, 28)");
  await axe(page);
  await page.emulateMedia({ colorScheme: "light" });

  // Kept on this device; Back to Paper keeps them for another time, and the palette offers them.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "own");
  expect(await background(page)).toBe("rgb(253, 246, 227)");
  // The link's shade is the one that reads on the paper typed since.
  expect(await token("accent")).toBe(derive({ paper: "#fdf6e3", ink: "#1b2130", accent: "#e0b84a" }).accent);
  await palette(page, "theme…");
  await picker.getByRole("button", { name: "Back to Paper" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-palette");
  await picker.getByRole("button", { name: "Done" }).click();
  await palette(page, "theme: your own");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "own");
  expect(await background(page)).toBe("rgb(253, 246, 227)");
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

  test("your own colors fit the screen: swatches, hex codes and the checks (#191)", async ({ page, app }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await launch(page, app);
    await page.getByRole("banner").getByRole("button", { name: "More" }).tap();
    await page.getByRole("menuitem", { name: "Theme…" }).tap();
    const picker = page.getByRole("dialog", { name: "Theme" });
    await picker.getByText("Your own", { exact: true }).tap();
    const own = picker.getByRole("region", { name: "Your own, light, started from Paper" });
    await expect(own).toBeVisible();
    await own.getByTitle("#e0b84a").tap();
    await expect(own.getByText("Too faint on this paper")).toBeVisible();
    expect(await picker.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const box of await own.getByRole("textbox").all()) expect((await box.boundingBox())!.x + (await box.boundingBox())!.width).toBeLessThanOrEqual(390);
    await axe(page);
  });
});
