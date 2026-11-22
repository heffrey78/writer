import { readFileSync } from "node:fs";
import { join } from "node:path";
import { axe, caretAtEnd, expect, proseOnItsGround, test } from "./fixtures.ts";

test("the Entry tab: a sheet to read, Back and Forward through names opened, a pin to keep it, the form in place", async ({ page, app }) => {
  await app.restart(app.novelRepo("varn"));
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused();
  const sidebar = page.getByRole("complementary", { name: "Right sidebar" });
  const sceneTab = sidebar.getByRole("tab", { name: "Scene", exact: true });
  const entryTab = sidebar.getByRole("tab", { name: "Entry", exact: true });
  const station = sidebar.getByRole("region", { name: "Details of “The Station”" });

  // A name on the Scene tab opens its sheet.
  await station.getByRole("button", { name: /^Ada Varn/ }).click();
  const ada = sidebar.getByRole("region", { name: "Ada Varn" });
  await expect(ada).toBeFocused();
  await expect(entryTab).toHaveAttribute("aria-selected", "true");
  await expect(ada.getByText("Character", { exact: true })).toBeVisible();
  await expect(ada.getByRole("region", { name: "At “The Station”" })).toBeVisible();
  // The profile at the sidebar's size: its strip, and its arcs read at the caret's scene.
  const strip = ada.getByRole("region", { name: "In the story" }).getByRole("list", { name: "Scenes, in reading order" });
  await expect(strip.getByRole("link", { name: "The Station: point of view" })).toBeVisible();
  await expect(ada.getByRole("region", { name: "Relationships" }).getByRole("list", { name: "All relationships" })).toBeVisible();
  await expect(ada.getByRole("region", { name: "Notes", exact: true })).toContainText("Voice: short sentences when she is angry");
  await expect(ada.getByRole("link", { name: "Open the full entry" })).toBeVisible();
  // What the book has said of her up to the scene being written (#153); one selects its sentence in the chapter.
  const appears = ada.getByRole("region", { name: "Appears in · 7" });
  await expect(appears).toContainText("The latest up to “The Station”:");
  const passages = appears.getByRole("list", { name: "Passages naming Ada Varn" }).getByRole("button").filter({ hasNotText: /^Link it$/ });
  await expect(passages).toHaveCount(1);
  await expect(passages).toHaveAccessibleName(/^The Station, point of view: The train gave up the last of its heat/);
  await axe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page);
  await page.emulateMedia({ colorScheme: "light" });
  // Its notes are written on the sidebar's own ground, the caret in them or not (#127).
  await proseOnItsGround(page, ada.getByRole("textbox", { name: "Notes on Ada Varn" }), sidebar, ada.getByRole("button", { name: "Edit occupation" }));
  const url = page.url();
  await passages.click();
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused();
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe("The train gave up the last of its heat as it pulled into Varn, and Ada was the only passenger who stood.");
  expect(page.url()).toBe(url);

  // Another, then Back and Forward.
  await sceneTab.click();
  await station.getByRole("button", { name: /^Varn Station/ }).click();
  const place = sidebar.getByRole("region", { name: "Varn Station" });
  await expect(place).toBeFocused();
  await place.getByRole("button", { name: "Previous entry" }).click();
  await expect(ada).toBeVisible();
  await expect(ada.getByRole("button", { name: "Previous entry" })).toBeDisabled();
  await ada.getByRole("button", { name: "Next entry" }).click();
  await expect(place).toBeVisible();

  // Nothing holds the tab (heffrey78/gh-writer#222): a name opened elsewhere replaces what's there, and there's no pin.
  await expect(place.getByRole("button", { name: /^Keep this/ })).toHaveCount(0);
  await sceneTab.click();
  await station.getByRole("button", { name: /^Ada Varn/ }).click();
  await expect(ada).toBeFocused();

  // Edited in place, as on its page.
  await ada.getByRole("button", { name: "Edit occupation" }).click();
  await expect(ada.getByRole("textbox", { name: "Occupation" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(ada.getByRole("button", { name: "Edit occupation" })).toBeFocused();
  await expect(ada.getByRole("heading", { level: 2, name: "Ada Varn" })).toBeVisible();

  // A scene it's in opens.
  await strip.getByRole("link", { name: "The Betrayal: point of view" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "The Betrayal" })).toBeVisible();
  await expect(ada.getByRole("region", { name: "At “The Betrayal”" })).toContainText("Rivals with Ben Varn");
});

test("In this scene, on the Scene tab: everyone and everything in the scene once, with its role and card, following the caret; a card opens its entry (#149, #160)", async ({ page, app }) => {
  await app.restart(app.novelRepo("varn"));
  await page.goto(app.launchUrl);
  const text = page.getByRole("textbox", { name: "Chapter text" });
  await expect(text).toBeFocused();
  const sidebar = page.getByRole("complementary", { name: "Right sidebar" });
  const scene = sidebar.getByRole("tab", { name: "Scene", exact: true });

  // One tab for the scene: its details and who's in it, not a tab for each.
  await expect(sidebar.getByRole("tab")).toHaveText(["Scene", "Notes", "Entry"]);
  await expect(scene).toHaveAttribute("aria-selected", "true");
  const station = sidebar.getByRole("list", { name: "In “The Station”" }).getByRole("listitem");
  await expect(station).toHaveText([/^AVAda Varnpoint of view · 31 · Structural engineer/, /^VSVarn Stationset here/, /^TSThe Saleplotline \(minor\) “First sign of the sale”/, /^IInheritancetheme \(faint\)/]);
  await expect(sidebar.getByRole("heading", { name: "In this scene · 4" })).toBeVisible();
  await axe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page);
  await page.emulateMedia({ colorScheme: "light" });

  // The caret into the next scene: its people and places.
  await caretAtEnd(page, text);
  const span = sidebar.getByRole("list", { name: "In “Walking the Span”" });
  await expect(span.getByRole("listitem")).toHaveCount(6);
  await expect(span.getByRole("listitem").nth(1)).toContainText("Ben Varnpresent");

  // A card opens its entry on the Entry tab, by Enter.
  await span.getByRole("button", { name: /^Ben Varn/ }).focus();
  await page.keyboard.press("Enter");
  await expect(sidebar.getByRole("tab", { name: "Entry", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(sidebar.getByRole("region", { name: "Ben Varn" })).toBeFocused();

  // From the palette, by who's in it.
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("who's in it");
  await page.keyboard.press("Enter");
  await expect(scene).toHaveAttribute("aria-selected", "true");
  await expect(span).toBeVisible();
});

test("entries pinned beside the text stay first in every scene and after a reload; a name written without a link here is linked from the Scene tab (#156, #160)", async ({ page, app }) => {
  const dir = app.novelRepo("varn");
  await app.restart(dir);
  const STATION = "manuscript/01-return/01-arrival/01-the-station.md";
  const was = readFileSync(join(dir, STATION), "utf8");
  await page.goto(app.launchUrl);
  const text = page.getByRole("textbox", { name: "Chapter text" });
  await expect(text).toBeFocused();
  const sidebar = page.getByRole("complementary", { name: "Right sidebar" });
  const tab = sidebar.getByRole("tab", { name: "Scene", exact: true });
  await tab.click();
  const pinned = sidebar.getByRole("list", { name: "Pinned" });

  // Pinned by the keyboard in The Station, first in Walking the Span, which doesn't have it.
  await sidebar.getByRole("button", { name: "Pin Varn Station beside the text" }).focus();
  await page.keyboard.press("Enter");
  await expect(sidebar.getByRole("status")).toHaveText("Pinned Varn Station beside the text.");
  await expect(pinned.getByRole("listitem")).toHaveCount(1);
  await expect(sidebar.getByRole("list", { name: "In “The Station”" }).getByRole("listitem")).toHaveCount(3);
  await caretAtEnd(page, text);
  await expect(sidebar.getByRole("list", { name: "In “Walking the Span”" })).toBeVisible();
  await expect(pinned.getByRole("listitem")).toHaveText([/^VSVarn Stationnot in this scene/]);
  await axe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page);
  await page.emulateMedia({ colorScheme: "light" });

  // And from the Entry tab: kept after a reload, in the order pinned.
  await sidebar.getByRole("region", { name: "Details of “Walking the Span”" }).getByRole("button", { name: /^Ben Varn/ }).click();
  await sidebar.getByRole("button", { name: "Pin Ben Varn beside the text" }).click();
  await page.reload();
  await expect(text).toBeVisible();
  await tab.click();
  await expect(pinned.getByRole("listitem")).toHaveText([/^VSVarn Station/, /^BVBen Varn/]);
  await sidebar.getByRole("button", { name: "Unpin Varn Station" }).click();
  await expect(sidebar.getByRole("status")).toHaveText("Unpinned Varn Station.");
  await expect(pinned.getByRole("listitem")).toHaveText([/^BVBen Varn/]);
  await sidebar.getByRole("button", { name: "Unpin Ben Varn" }).click();
  await expect(pinned).toHaveCount(0);

  // The Station writes "the bridge" without a link: linked from the tab, as Alt+Enter links it in the text.
  await expect(sidebar.getByRole("list", { name: "In “The Station”" })).toBeVisible();
  const bridge = sidebar.getByRole("button", { name: "Link “the bridge” to The Varn Bridge: 1 not linked in this scene" });
  await bridge.focus();
  await page.keyboard.press("Enter");
  await expect(sidebar.getByRole("status")).toHaveText("Linked “the bridge” to The Varn Bridge.");
  await expect(text.locator('[data-mention="loc_br1dg3"]')).toHaveText("the bridge");
  await expect(bridge).toHaveCount(0);
  await expect
    .poll(() => readFileSync(join(dir, STATION), "utf8"))
    .toBe(was.replace("she could see the bridge,", "she could see [the bridge](#loc_br1dg3),").replace("locations: [loc_5tat10]", "locations: [loc_5tat10, loc_br1dg3]"));
  await expect(sidebar.getByRole("list", { name: "In “The Station”" }).getByRole("listitem").filter({ hasText: "The Varn Bridge" })).toContainText("set here");
});
