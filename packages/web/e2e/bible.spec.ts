import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { axe, caretAtEnd, expect, palette, test, type App } from "./fixtures.ts";

const ADA = "char_7f3k2q";

async function open(page: Page, app: App) {
  const dir = app.novelRepo("varn");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused();
  return {
    dir,
    read: (path: string) => readFileSync(join(dir, path), "utf8"),
    lastCommit: () => app.git(dir, "log", "-1", "--format=%s").trim(),
  };
}

test("adds a character, fills in the details and notes, all saved to its file", async ({ page, app }) => {
  const novel = await open(page, app);
  await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Story bible" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Story bible" })).toBeVisible();
  await page.getByRole("button", { name: "New character" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("Ilse Varn");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "Ilse Varn" })).toBeVisible();
  expect(novel.lastCommit()).toBe("Bible: add Ilse Varn");
  const file = "bible/characters/ilse-varn.md";

  // Read first: each empty part behind "+ Add…", edited in place, saved at once; Enter saves and
  // returns to the part.
  await page.getByRole("button", { name: "Add other names" }).click();
  await expect(page.getByRole("textbox", { name: "Other names" })).toBeFocused();
  await page.keyboard.type("Ilse, the Aunt");
  await page.keyboard.press("Enter");
  // Exactly: the profile's, not the list's.
  await expect(page.getByText("Also Ilse, the Aunt", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit other names" })).toBeFocused();
  await page.getByRole("button", { name: "Add a summary" }).click();
  await page.keyboard.type("Ada's aunt, who never left.");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Add a field" }).click();
  await page.getByRole("textbox", { name: "Field name" }).fill("age");
  await page.getByRole("textbox", { name: "Value" }).fill("67");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("definition").filter({ hasText: "67" })).toBeVisible();
  await page.getByRole("button", { name: "Add tags" }).click();
  await page.keyboard.type("family, Varn");
  await page.keyboard.press("Enter");
  await expect.poll(() => novel.read(file)).toMatch(/tags:\n {2}- family\n {2}- Varn\n/);
  expect(novel.read(file)).toContain("summary: Ada's aunt, who never left.");
  expect(novel.read(file)).toMatch(/aliases:\n {2}- Ilse\n {2}- the Aunt\n/);
  expect(novel.read(file)).toMatch(/fields:\n {2}age: "67"\n/);
  expect(novel.read(file)).toMatch(/tags:\n {2}- family\n {2}- Varn\n/);
  expect(novel.lastCommit()).toBe("Bible: edit Ilse Varn");

  // Escape leaves a part as it was.
  await page.getByRole("button", { name: "Edit summary" }).click();
  await page.keyboard.type(" Not this.");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Edit summary" })).toBeFocused();
  await expect(page.getByRole("region", { name: "Ilse Varn" }).getByText("Ada's aunt, who never left.", { exact: true })).toBeVisible();

  // A field renamed and changed, another added and removed.
  await page.getByRole("button", { name: "Edit age" }).click();
  await page.getByRole("textbox", { name: "Field name" }).fill("born");
  await page.getByRole("textbox", { name: "Value" }).fill("1958");
  await page.keyboard.press("Enter");
  await expect.poll(() => novel.read(file)).toMatch(/fields:\n {2}born: "1958"\n/);
  await expect(page.getByRole("button", { name: "Edit born" })).toBeFocused();
  await page.getByRole("button", { name: "Add a field" }).click();
  await page.getByRole("textbox", { name: "Field name" }).fill("born");
  await page.keyboard.press("Enter");
  await expect(page.getByText("There's already a field “born”.")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Edit born" }).click();
  await page.getByRole("button", { name: "Remove the field" }).click();
  await expect.poll(() => novel.read(file)).not.toContain("born");

  const notes = page.getByRole("textbox", { name: "Notes on Ilse Varn" });
  await notes.click();
  await page.keyboard.type("Lives above the toll house.");
  await expect.poll(() => novel.read(file), { timeout: 10_000 }).toMatch(/---\nLives above the toll house\.\n$/);
  await axe(page);
});

test("renames an entry by moving its file only; every reference still resolves", async ({ page, app }) => {
  const novel = await open(page, app);
  await palette(page, "character: ada");
  await expect(page.getByRole("heading", { level: 2, name: "Ada Varn" })).toBeVisible();
  await page.getByRole("button", { name: "Edit name" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Ada Kost");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "Ada Kost" })).toBeVisible();
  expect(novel.lastCommit()).toBe("Bible: rename Ada Varn to Ada Kost");
  expect(app.git(novel.dir, "show", "-M", "--name-status", "--format=", "HEAD").trim()).toMatch(/^R\d+\tbible\/characters\/ada\.md\tbible\/characters\/ada-kost\.md$/);
  // Her scenes still list her, and the backlinks still find them.
  await expect(page.getByRole("region", { name: "In the story" }).getByRole("link", { name: "The Station" })).toBeVisible();
});

test("lists every scene that refers to a character, and asks before deleting one the story uses", async ({ page, app }) => {
  const novel = await open(page, app);
  await page.goto(`${app.url}${new URL(app.launchUrl).pathname.replace(/\/chapter.*$/, "")}/bible/${ADA}`);
  await expect(page.getByRole("heading", { level: 2, name: "Ada Varn" })).toBeVisible();
  // Every scene file that names her, in front matter or prose, is listed.
  const scenes = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? scenes(join(dir, e.name)) : e.name.endsWith(".md") ? [join(dir, e.name)] : []));
  const naming = scenes(join(novel.dir, "manuscript"))
    .filter((f) => readFileSync(f, "utf8").includes(ADA))
    .map((f) => /^title: (.*)$/m.exec(readFileSync(f, "utf8"))![1]!);
  // On the strip, each scene she's in is a link to it.
  const listed = page.getByRole("region", { name: "In the story" }).getByRole("list", { name: "Scenes, in reading order" }).getByRole("link");
  await expect(listed).toHaveCount(naming.length);
  for (const title of naming) await expect(listed.and(page.getByRole("link", { name: new RegExp(`^${title.replace(/[?]/g, "\\?")}: `) }))).toHaveCount(1);
  await expect(page.getByRole("list", { name: "All relationships" })).toContainText("Rivals with Ben Varn, from “The Betrayal”");

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const ask = page.getByRole("alertdialog");
  await expect(ask).toContainText("The story still refers to it");
  await expect(ask).toContainText("The Station");
  await axe(page);
  await ask.getByRole("button", { name: "Keep it" }).click();
  expect(existsSync(join(novel.dir, "bible/characters/ada.md"))).toBe(true);
});

test("deletes an entry nobody refers to", async ({ page, app }) => {
  const novel = await open(page, app);
  await palette(page, "new location");
  await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("The Old Mill");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "The Old Mill" })).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("region", { name: "The Old Mill" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Story bible" })).toBeVisible();
  await expect(page).toHaveURL(/\/bible$/);
  expect(existsSync(join(novel.dir, "bible/locations/the-old-mill.md"))).toBe(false);
  expect(novel.lastCommit()).toBe("Bible: remove The Old Mill");
});

test("a new type of entry works at once, with no code changes", async ({ page, app }) => {
  const novel = await open(page, app);
  await palette(page, "story bible");
  await page.getByRole("button", { name: "New type" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Name, singular" }).fill("Vehicle");
  await page.getByRole("dialog").getByRole("button", { name: "Add type" }).click();
  await expect(page.getByRole("heading", { level: 2, name: /^Vehicles/ })).toBeVisible();
  expect(novel.read("novel.yaml")).toMatch(/- key: vehicle\n {4}prefix: vehi\n {4}folder: vehicles\n {4}label: Vehicle\n/);
  await page.getByRole("button", { name: "New vehicle" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("The Night Train");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "The Night Train" })).toBeVisible();
  expect(novel.read("bible/vehicles/the-night-train.md")).toMatch(/^---\nid: vehi_[0-9a-hjkmnp-tv-z]{6}\nname: The Night Train\n---\n$/);
});

test("searches the bible by anything an entry says: names, other names, summaries, fields and notes", async ({ page, app }) => {
  await open(page, app);
  await palette(page, "story bible");
  const search = page.getByRole("searchbox", { name: "Search the bible" });
  const results = page.getByRole("main").getByRole("region", { name: /^Characters/ });
  // A field's value: only Ada's eyes are grey.
  await search.fill("GREY");
  await expect(page.getByText(/entr(y|ies) match(es)? “GREY”/)).toBeVisible();
  await expect(results.getByRole("link")).toHaveCount(1);
  await expect(results.getByRole("link", { name: /^Ada Varn/ })).toBeVisible();
  // Another name, in any case; and a summary and notes: Ben is “Ada's younger brother”, Tomas “taught Ada to read a gauge”.
  await search.fill("m. k.");
  await expect(results.getByRole("link", { name: /^Mirela Kost/ })).toBeVisible();
  await search.fill("ada");
  await expect(results.getByRole("link", { name: /^Ada Varn/ })).toBeVisible();
  await expect(results.getByRole("link", { name: /^Ben Varn/ })).toBeVisible();
  await expect(results.getByRole("link", { name: /^Tomas Hale/ })).toBeVisible();
  await expect(results.getByRole("link", { name: /^Mirela/ })).toHaveCount(0);
  await axe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page);
});

test("in the story: a strip of every scene, marking where the entry carries it, is in it or is mentioned", async ({ page, app }) => {
  await open(page, app);
  await page.goto(`${app.url}${new URL(app.launchUrl).pathname.replace(/\/chapter.*$/, "")}/bible/${ADA}`);
  const story = page.getByRole("region", { name: "In the story" });
  const strip = story.getByRole("list", { name: "Scenes, in reading order" });
  // Her point of view in all but The Flood, where she's in the scene.
  await expect(strip.getByRole("listitem")).toHaveCount(8);
  await expect(strip.getByRole("link")).toHaveText(["", "", "", "", "", "", "", ""]);
  await expect(strip.getByRole("link", { name: "The Station: point of view" })).toBeVisible();
  await expect(strip.getByRole("link", { name: "The Flood: in the scene" })).toBeVisible();
  await expect(story.getByRole("list", { name: "Key" }).getByRole("listitem")).toHaveText(["Point of view", "In the scene", "Mentioned", "Not there"]);
  await expect(story).toContainText("In all 8 scenes, from “The Station” to “The Last Rivet”; point of view in 7.");
  await expect(story).toContainText("Off the page: ");
  await axe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page);
  await page.emulateMedia({ colorScheme: "light" });

  // A place, with an absence; and a mark opens its scene.
  await page.goto(`${app.url}${new URL(app.launchUrl).pathname.replace(/\/chapter.*$/, "")}/bible/loc_w0rk5p`);
  await expect(story).toContainText("In 2 of 8 scenes, from “Tomas's Workshop” to “Mirela's Offer”.");
  await expect(story).toContainText("Longest absence: 3 scenes, “Ben's Ledger” to “The Flood”.");
  await expect(strip.getByRole("listitem").filter({ hasText: "Ben's Ledger: not there" })).toHaveCount(1);
  await strip.getByRole("link", { name: "Mirela's Offer: set here" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Mirela's Offer" })).toBeVisible();
});

test("an entry's profile lists every passage naming it, by scene and role; chips narrow them; a passage opens its scene with its sentence selected (#153)", async ({ page, app }) => {
  await open(page, app);
  await page.goto(`${app.url}${new URL(app.launchUrl).pathname.replace(/\/chapter.*$/, "")}/bible/char_b3n0vs/page`);
  const part = page.getByRole("region", { name: "Appears in · 6" });
  const passages = part.getByRole("list", { name: "Passages naming Ben Varn" }).getByRole("button");
  // In reading order, each with its scene and his role there; the names written without a link say so.
  await expect(passages).toHaveCount(6);
  await expect(passages.first()).toHaveAccessibleName("Walking the Span, in the scene: Ben met her at the toll house with two coffees and a grin that was a size too large for him.");
  await expect(passages.nth(3)).toHaveAccessibleName("The Flood, point of view, not linked: Ben was fourteen, and the river was louder than he had known a river could be.");
  await expect(part.getByRole("listitem").filter({ hasText: /^Walking the Span/ }).first()).toContainText("Walking the Span · Arrival · in the scene");

  // Narrowed to a role, or to the names not linked (as the editor underlines them), and back.
  const chips = part.getByRole("group", { name: "Show" }).getByRole("button");
  await expect(chips).toHaveText(["All · 6", "Point of view · 2", "In the scene · 3", "Mentioned · 1", "Not linked · 3"]);
  await chips.filter({ hasText: "Not linked" }).click();
  await expect(chips.filter({ hasText: "Not linked" })).toHaveAttribute("aria-pressed", "true");
  await expect(passages).toHaveCount(3);
  for (const p of await passages.all()) await expect(p).toHaveAccessibleName(/, not linked: /);
  await chips.filter({ hasText: "Point of view" }).click();
  await expect(passages).toHaveCount(2);
  await chips.filter({ hasText: "All" }).click();
  await expect(passages).toHaveCount(6);
  await axe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page);
  await page.emulateMedia({ colorScheme: "light" });

  // The strip of the profile's parts jumps to one, and marks it.
  const strip = page.getByRole("navigation", { name: "Parts of the entry" });
  await expect(strip.getByRole("button")).toHaveText(["Profile", "Notes", "In the story", "Appears in · 6", "Relationships · 5"]);
  await strip.getByRole("button", { name: "Appears in · 6" }).click();
  await expect(part).toBeFocused();
  await expect(strip.getByRole("button", { name: "Appears in · 6" })).toHaveAttribute("aria-current", "true");

  // Enter on a passage: its scene, with the sentence selected and the caret in the text.
  await passages.first().focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/scene\/sc_br1dg3$/);
  await expect(page.getByRole("textbox", { name: "Scene text" })).toBeFocused();
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe("Ben met her at the toll house with two coffees and a grin that was a size too large for him.");
});

test("the bible as a gallery: cards with a summary, facts, a strip and a count; sorted four ways by keyboard", async ({ page, app }) => {
  const novel = await open(page, app);
  await palette(page, "story bible");
  // The Cards, chosen over the List (#134), and kept.
  await page.getByRole("button", { name: "Cards" }).click();
  await expect(page.getByRole("button", { name: "Cards" })).toHaveAttribute("aria-pressed", "true");
  const characters = page.getByRole("main").getByRole("region", { name: /^Characters/ });
  const cards = characters.getByRole("listitem").getByRole("link");
  // By first appearance: Ada at the station, Ben on the span, Tomas in his workshop, Mirela at her offer.
  await expect(cards.locator("span.font-semibold:not([aria-hidden])")).toHaveText(["Ada Varn", "Ben Varn", "Tomas Hale", "Mirela Kost"]);
  const ada = cards.filter({ hasText: "Ada Varn" });
  await expect(ada).toContainText("Bridge engineer who comes home after twelve years");
  await expect(ada).toContainText("31 · Structural engineer");
  // Counts as the backlinks have them: every scene file that names the entry, front matter or prose.
  const naming = (id: string) => readdirSync(join(novel.dir, "manuscript"), { recursive: true }).filter((f) => String(f).endsWith(".md") && novel.read(join("manuscript", String(f))).includes(id)).length;
  for (const [name, id] of [["Ada Varn", ADA], ["Ben Varn", "char_b3n0vs"], ["Tomas Hale", "char_t0ma5h"], ["Mirela Kost", "char_m1re1a"]] as const) {
    const n = naming(id);
    await expect(cards.filter({ hasText: name })).toContainText(`${n} ${n === 1 ? "scene" : "scenes"}`);
  }
  await axe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page);
  await page.emulateMedia({ colorScheme: "light" });

  // Sorted by last appearance, by name, then by most scenes, from the keyboard; the choice is in the address.
  const sort = page.getByRole("combobox", { name: "Sort" });
  await sort.focus();
  await page.keyboard.press("ArrowDown");
  await expect(sort).toHaveValue("last");
  // Ada, Ben and Tomas are in the last scene; Mirela last appears at her offer, the scene before.
  await expect(cards.locator("span.font-semibold:not([aria-hidden])")).toHaveText(["Ada Varn", "Ben Varn", "Tomas Hale", "Mirela Kost"]);
  await expect(page).toHaveURL(/sort=last/);
  await page.keyboard.press("ArrowDown");
  await expect(sort).toHaveValue("name");
  await expect(cards.locator("span.font-semibold:not([aria-hidden])")).toHaveText(["Ada Varn", "Ben Varn", "Mirela Kost", "Tomas Hale"]);
  await page.keyboard.press("ArrowDown");
  await expect(cards.locator("span.font-semibold:not([aria-hidden])")).toHaveText(["Ada Varn", "Ben Varn", "Tomas Hale", "Mirela Kost"]);
  await expect(page).toHaveURL(/sort=most/);

  // Search by another name keeps the sort; an entry no scene uses says so.
  await page.getByRole("searchbox", { name: "Search the bible" }).fill("the plans");
  await expect(page.getByRole("main").getByRole("region", { name: /^Artifacts/ }).getByRole("link")).toContainText("1 scene");
  await page.getByRole("searchbox", { name: "Search the bible" }).fill("");
  await page.getByRole("button", { name: "New character" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("Ilse Varn");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "Ilse Varn" })).toBeVisible();
  await page.goBack();
  await expect(cards.filter({ hasText: "Ilse Varn" })).toContainText("Not in the manuscript yet");
});

test("an entry opens beside the list: stepped through in the list's order, the list kept where it was; Open as page; one pane at a time when narrow (#134)", async ({ page, app }) => {
  await open(page, app);
  await page.setViewportSize({ width: 1440, height: 700 });
  await palette(page, "story bible");
  // Nothing open yet: the list, and a word on what goes beside it.
  await expect(page.getByText("Choose an entry from the list to read it here.")).toBeVisible();
  const list = page.getByRole("heading", { level: 1, name: "Story bible" }).locator("xpath=ancestor::div[contains(@class,'overflow-y-auto')][1]");
  const rows = page.getByRole("region", { name: /^Characters/ }).getByRole("link");
  await expect(rows.locator("span.font-semibold:not([aria-hidden])")).toHaveText(["Ada Varn", "Ben Varn", "Tomas Hale", "Mirela Kost"]);

  // A row opens the entry beside the list, marked as the one open; the address names it and keeps the sort.
  await page.getByRole("combobox", { name: "Sort" }).selectOption("name");
  await rows.filter({ hasText: "Ada Varn" }).click();
  const ada = page.getByRole("region", { name: "Ada Varn" });
  await expect(ada.getByRole("heading", { level: 2, name: "Ada Varn" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/bible/${ADA}\\?sort=name$`));
  await expect(rows.filter({ hasText: "Ada Varn" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(/^1 of \d+$/)).toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }
  await page.emulateMedia({ colorScheme: "light" });

  // Scrolled down the list, then stepped on: the next by name, and the list stays where it was.
  await list.evaluate((el) => (el.scrollTop = 120));
  await page.getByRole("link", { name: "Next entry" }).click();
  await expect(page.getByRole("region", { name: "Ben Varn" })).toBeVisible();
  await expect(page.getByText(/^2 of \d+$/)).toBeVisible();
  expect(await list.evaluate((el) => el.scrollTop)).toBe(120);
  await page.getByRole("link", { name: "Next entry" }).click();
  await expect(page.getByRole("region", { name: "Mirela Kost" })).toBeVisible();
  await page.getByRole("link", { name: "Previous entry" }).click();
  await expect(page.getByRole("region", { name: "Ben Varn" })).toBeVisible();
  // Back and Forward go through them too.
  await page.goBack();
  await expect(page.getByRole("region", { name: "Mirela Kost" })).toBeVisible();
  await page.goBack();
  await page.goBack();
  await expect(page.getByRole("region", { name: "Ada Varn" })).toBeVisible();

  // An edit saved beside the list changes its row, and the list doesn't move: renamed, Ada stays first.
  await ada.getByRole("button", { name: "Edit name" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Zelda Varn");
  await page.keyboard.press("Enter");
  await expect(rows.locator("span.font-semibold:not([aria-hidden])")).toHaveText(["Zelda Varn", "Ben Varn", "Mirela Kost", "Tomas Hale"]);

  // The entry as a page of its own, and back.
  await page.getByRole("link", { name: "Open as page" }).click();
  await expect(page).toHaveURL(new RegExp(`/bible/${ADA}/page$`));
  await expect(page.getByRole("heading", { level: 1, name: "Zelda Varn" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Story bible" })).toHaveCount(0);
  await page.goBack();

  // Closed: the list alone, with the sort it had.
  await page.getByRole("link", { name: "Close the entry" }).click();
  await expect(page).toHaveURL(/\/bible\?sort=name$/);
  await expect(page.getByText("Choose an entry from the list to read it here.")).toBeVisible();

  // The list folded away and back.
  await page.getByRole("button", { name: "Hide the list" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Story bible" })).toHaveCount(0);
  await page.getByRole("button", { name: "Show the list" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Story bible" })).toBeVisible();

  // Too narrow for both: the list, then the entry in its place, with the way back to the list.
  await page.setViewportSize({ width: 900, height: 700 });
  await rows.filter({ hasText: "Ben Varn" }).click();
  await expect(page.getByRole("region", { name: "Ben Varn" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Story bible" })).toHaveCount(0);
  await axe(page);
  await page.getByRole("link", { name: "Story bible" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Story bible" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Ben Varn" })).toHaveCount(0);
});

test("the index's search says where each entry matched, filters narrow it as chips kept in the address, and scenes that match are offered last (#134)", async ({ page, app }) => {
  await open(page, app);
  await page.setViewportSize({ width: 1440, height: 900 });
  await palette(page, "story bible");
  const search = page.getByRole("searchbox", { name: "Search the bible" });
  const characters = page.getByRole("region", { name: /^Characters/ });
  const locations = page.getByRole("region", { name: /^Locations/ });
  const found = page.getByRole("status").filter({ hasText: / match/ });

  // Where each matched: Ada in her notes, the bridge in its summary, each with the word marked.
  await search.fill("iron");
  await expect(characters.getByRole("link", { name: /^Ada Varn/ })).toContainText("notes");
  await expect(characters.getByRole("link", { name: /^Ada Varn/ }).locator("mark")).toHaveText("iron");
  await expect(locations.getByRole("link", { name: /^The Varn Bridge/ })).toContainText("summary");
  await expect(found).toHaveText("2 entries match “iron” (and the off-page events below that do)");

  // A filter by type, from + Filter: only characters, said as a chip; the count says so.
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  const adding = page.getByRole("dialog", { name: "Filter the bible" });
  await expect(adding.getByRole("combobox", { name: "By" })).toHaveValue("type");
  await adding.getByRole("combobox", { name: "Type" }).selectOption("character");
  await adding.getByRole("button", { name: "Add the filter" }).click();
  await expect(page.getByRole("button", { name: "Remove the filter: Characters" })).toBeVisible();
  await expect(locations).toHaveCount(0);
  await expect(found).toHaveText("1 entry matches “iron” and the filters");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }
  await page.emulateMedia({ colorScheme: "light" });

  // A word only the scenes have: none of the entries, and the scene offered, opening the book's find on it.
  await search.fill("stitches");
  await expect(found).toHaveText("0 entries match “stitches” and the filters");
  await page.getByRole("button", { name: "search the manuscript for “stitches”" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "The Station" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Find" })).toHaveValue("stitches");
  await page.goBack();

  // A tag too, and the filters kept in the address: opened again from it, the same list.
  await search.fill("");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await adding.getByRole("combobox", { name: "By" }).selectOption("tag");
  await adding.getByRole("combobox", { name: "Tag" }).selectOption("protagonist");
  await adding.getByRole("button", { name: "Add the filter" }).click();
  await expect(characters.getByRole("link")).toHaveCount(1);
  await expect(page).toHaveURL(/[?&]type=character&tag=protagonist$/);
  const address = page.url();
  await page.goto("about:blank");
  await page.goto(address);
  await expect(page.getByRole("button", { name: "Remove the filter: Tag: protagonist" })).toBeVisible();
  await expect(characters.getByRole("link")).toHaveCount(1);
  await expect(characters.getByRole("link", { name: /^Ada Varn/ })).toBeVisible();

  // A chip goes with Backspace, the focus on to the next.
  await page.getByRole("button", { name: "Remove the filter: Characters" }).focus();
  await page.keyboard.press("Backspace");
  await expect(page.getByRole("button", { name: "Remove the filter: Characters" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove the filter: Tag: protagonist" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("group", { name: "Filters" }).getByRole("button", { name: /^Remove/ })).toHaveCount(0);

  // A field's value; a role a scene gives; a chapter.
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await adding.getByRole("combobox", { name: "By" }).selectOption("field");
  await adding.getByRole("combobox", { name: "Field" }).selectOption("occupation");
  await adding.getByRole("combobox", { name: "Value" }).selectOption("Toll keeper");
  await adding.getByRole("button", { name: "Add the filter" }).click();
  await expect(characters.getByRole("link").locator("span.font-semibold:not([aria-hidden])")).toHaveText(["Ben Varn"]);
  await expect(locations).toHaveCount(0);
  await page.getByRole("button", { name: "Remove the filter: Occupation: Toll keeper" }).click();
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await adding.getByRole("combobox", { name: "By" }).selectOption("role");
  await adding.getByRole("combobox", { name: "Role" }).selectOption("pov");
  await adding.getByRole("button", { name: "Add the filter" }).click();
  await expect(characters.getByRole("link").locator("span.font-semibold:not([aria-hidden])")).toHaveText(["Ada Varn", "Ben Varn"]);
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await adding.getByRole("combobox", { name: "By" }).selectOption("in");
  await adding.getByRole("combobox", { name: /^In a/ }).selectOption({ label: "Chapter: Arrival" });
  await adding.getByRole("button", { name: "Add the filter" }).click();
  await expect(page.getByRole("button", { name: "Remove the filter: In “Arrival”" })).toBeVisible();
  // Ben's point of view is in The Sale; in Arrival, Ada's alone.
  await expect(characters.getByRole("link").locator("span.font-semibold:not([aria-hidden])")).toHaveText(["Ada Varn"]);

  // The sidebar's types open the index filtered to them.
  await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: /^Locations/ }).click();
  await expect(page).toHaveURL(/\/bible\?type=location$/);
  await expect(page.getByRole("button", { name: "Remove the filter: Locations" })).toBeVisible();
  await expect(characters).toHaveCount(0);

  // Not in the story yet: an entry no scene uses.
  await palette(page, "new location");
  await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("The Old Mill");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "The Old Mill" })).toBeVisible();
  await page.getByRole("link", { name: "Close the entry" }).click();
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await adding.getByRole("combobox", { name: "By" }).selectOption("absent");
  await adding.getByRole("button", { name: "Add the filter" }).click();
  await expect(locations.getByRole("link").locator("span.font-semibold:not([aria-hidden])")).toHaveText(["The Old Mill"]);
});

test("the index by the keyboard alone: / searches, j and k open the next and previous, Enter into the entry and Escape out, e edits, n makes one, [ folds the list; each said (#134)", async ({ page, app }) => {
  const novel = await open(page, app);
  await page.setViewportSize({ width: 1440, height: 900 });
  await palette(page, "story bible");
  const search = page.getByRole("searchbox", { name: "Search the bible" });
  const said = page.locator("p[aria-live=polite].sr-only");
  const focusedRow = (name: RegExp) => page.getByRole("region", { name: /^Characters/ }).getByRole("link", { name });

  // / to search; down from it, the first it found opened, its row in focus.
  await expect(page.getByRole("heading", { level: 1, name: "Story bible" })).toBeVisible();
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  await page.keyboard.type("varn");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("region", { name: "Ada Varn" })).toBeVisible();
  await expect(focusedRow(/^Ada Varn/)).toBeFocused();
  await expect(said).toHaveText(/^Ada Varn, character, 1 of \d+$/);

  // j and k, the arrows too: the next and previous, opened, said.
  await page.keyboard.press("j");
  await expect(page.getByRole("region", { name: "Ben Varn" })).toBeVisible();
  await expect(focusedRow(/^Ben Varn/)).toBeFocused();
  await expect(said).toHaveText(/^Ben Varn, character, 2 of \d+$/);
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("region", { name: "Ada Varn" })).toBeVisible();
  await expect(focusedRow(/^Ada Varn/)).toBeFocused();

  // Enter goes into the entry; e edits its summary; Escape leaves the part, then the entry, back to its row.
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Ada Varn" })).toBeFocused();
  await page.keyboard.press("e");
  await expect(page.getByRole("textbox", { name: "Summary" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Edit summary" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(focusedRow(/^Ada Varn/)).toBeFocused();

  // In the notes, the keys are the text's.
  const notes = page.getByRole("textbox", { name: "Notes on Ada Varn" });
  await caretAtEnd(page, notes);
  await page.keyboard.type(" jk/");
  await expect.poll(() => novel.read("bible/characters/ada.md")).toContain(" jk/");
  await expect(page.getByRole("region", { name: "Ada Varn" })).toBeVisible();

  // n: a new one of the open one's type.
  await focusedRow(/^Ada Varn/).focus();
  await page.keyboard.press("n");
  await expect(page.getByRole("dialog", { name: "New character" }).getByRole("textbox", { name: "Name" })).toBeFocused();
  await page.keyboard.press("Escape");

  // [ folds the list away (the entry's name is then the page's heading) and back.
  await page.keyboard.press("[");
  await expect(page.getByRole("heading", { level: 1, name: "Ada Varn" })).toBeVisible();
  await page.keyboard.press("[");
  await expect(page.getByRole("heading", { level: 1, name: "Story bible" })).toBeVisible();

  // The two just opened, newest first, under the Story bible in the sidebar.
  await expect(page.getByRole("list", { name: "Recent in the bible" }).getByRole("link")).toHaveText(["Ada Varn", "Ben Varn"]);
  await axe(page);

  // Every key is in the palette too.
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("next entry");
  await expect(page.getByRole("dialog", { name: "Command palette" }).getByRole("option", { name: /Next entry/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Ben Varn" })).toBeVisible();
});
