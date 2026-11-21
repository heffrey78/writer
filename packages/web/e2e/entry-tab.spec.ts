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
  await station.getByRole("button", { name: "Ada Varn" }).first().click();
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
  const passages = appears.getByRole("list", { name: "Passages naming Ada Varn" }).getByRole("button");
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
  await station.getByRole("button", { name: "Varn Station" }).click();
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
  await station.getByRole("button", { name: "Ada Varn" }).first().click();
  await expect(ada).toBeFocused();

  // Edited in place, as on its page.
  await ada.getByRole("button", { name: "Edit occupation" }).click();
  await expect(ada.getByRole("textbox", { name: "Field name" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(ada.getByRole("button", { name: "Edit occupation" })).toBeFocused();
  await expect(ada.getByRole("heading", { level: 2, name: "Ada Varn" })).toBeVisible();

  // A scene it's in opens.
  await strip.getByRole("link", { name: "The Betrayal: point of view" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "The Betrayal" })).toBeVisible();
  await expect(ada.getByRole("region", { name: "At “The Betrayal”" })).toContainText("Rivals with Ben Varn");
});

test("In this scene: everyone and everything in the scene once, with its role and card, following the caret; one expands to its profile, Open goes to it (#149)", async ({ page, app }) => {
  await app.restart(app.novelRepo("varn"));
  await page.goto(app.launchUrl);
  const text = page.getByRole("textbox", { name: "Chapter text" });
  await expect(text).toBeFocused();
  const sidebar = page.getByRole("complementary", { name: "Right sidebar" });
  const tab = sidebar.getByRole("tab", { name: "In this scene" });

  // A tab like the others: the arrows reach it.
  await sidebar.getByRole("tab", { name: "Scene", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(tab).toBeFocused();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  const station = sidebar.getByRole("list", { name: "In “The Station”" }).getByRole("listitem");
  await expect(station).toHaveText([/^AVAda Varnpoint of view · 31 · Structural engineer/, /^VSVarn Stationset here/, /^TSThe Saleplotline \(minor\) “First sign of the sale”/, /^IInheritancetheme \(faint\)/]);
  await axe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page);
  await page.emulateMedia({ colorScheme: "light" });

  // The caret into the next scene: its people and places.
  await caretAtEnd(page, text);
  const span = sidebar.getByRole("list", { name: "In “Walking the Span”" });
  await expect(span.getByRole("listitem")).toHaveCount(6);
  await expect(span.getByRole("listitem").nth(1)).toContainText("Ben Varnpresent");

  // One expands in place to its profile, by Enter; Open goes to it in the bible.
  const ben = span.getByRole("button", { name: /^Ben Varn/ });
  await ben.focus();
  await page.keyboard.press("Enter");
  await expect(ben).toHaveAttribute("aria-expanded", "true");
  await expect(span.getByRole("heading", { name: "Ben Varn" })).toBeVisible();
  await expect(span.getByRole("region", { name: /^Appears in/ })).toBeVisible();
  await axe(page);
  await page.keyboard.press("Enter");
  await expect(ben).toHaveAttribute("aria-expanded", "false");
  await span.getByRole("link", { name: "Open Ben Varn in the bible" }).click();
  await expect(page).toHaveURL(/\/bible\/char_b3n0vs$/);
  await expect(page.getByRole("heading", { level: 2, name: "Ben Varn" })).toBeVisible();

  // From the palette.
  await page.goBack();
  await expect(text).toBeVisible();
  await sidebar.getByRole("tab", { name: "Scene", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("who's in this scene");
  await page.keyboard.press("Enter");
  await expect(tab).toHaveAttribute("aria-selected", "true");
});
