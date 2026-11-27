import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { axe, expect, palette, selectionSettled, test, type App } from "./fixtures.ts";

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

test("adds a character, fills in its details, all saved to its file", async ({ page, app }) => {
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
  // A character's fields are ready (#138): Age, a number, filled from its Add….
  await expect(page.getByRole("region", { name: "Ilse Varn" }).locator('dl[aria-label="Fields"]').first().locator("dt")).toHaveText(["Age", "Occupation", "Appearance", "Wants", "Fears"]);
  await page.getByRole("button", { name: "Add age" }).click();
  await expect(page.getByRole("textbox", { name: "Age" })).toBeFocused();
  await page.keyboard.type("67");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Edit age" })).toBeFocused();
  await expect(page.getByRole("definition").filter({ hasText: "67" })).toBeVisible();
  await page.getByRole("button", { name: "Add tags" }).click();
  await page.keyboard.type("family, Varn");
  await page.keyboard.press("Enter");
  await expect.poll(() => novel.read(file)).toMatch(/tags:\n {2}- family\n {2}- Varn\n/);
  expect(novel.read(file)).toContain("summary: Ada's aunt, who never left.");
  expect(novel.read(file)).toMatch(/aliases:\n {2}- Ilse\n {2}- the Aunt\n/);
  expect(novel.read(file)).toMatch(/fields:\n {2}age: 67\n/);
  expect(novel.read(file)).toMatch(/tags:\n {2}- family\n {2}- Varn\n/);
  expect(novel.lastCommit()).toBe("Bible: edit Ilse Varn");

  // Escape leaves a part as it was.
  await page.getByRole("button", { name: "Edit summary" }).click();
  await page.keyboard.type(" Not this.");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Edit summary" })).toBeFocused();
  await expect(page.getByRole("region", { name: "Ilse Varn" }).getByText("Ada's aunt, who never left.", { exact: true })).toBeVisible();

  // A field of its own, under Other: added, renamed and changed, another refused and it removed.
  await page.getByRole("button", { name: "Add a field" }).click();
  await page.getByRole("textbox", { name: "Field name" }).fill("nickname");
  await page.getByRole("textbox", { name: "Value" }).fill("Ils");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Other" })).toBeVisible();
  await expect.poll(() => novel.read(file)).toMatch(/fields:\n {2}age: 67\n {2}nickname: Ils\n/);
  await page.getByRole("button", { name: "Edit nickname" }).click();
  await page.getByRole("textbox", { name: "Field name" }).fill("born");
  await page.getByRole("textbox", { name: "Value" }).fill("1958");
  await page.keyboard.press("Enter");
  await expect.poll(() => novel.read(file)).toMatch(/fields:\n {2}age: 67\n {2}born: "1958"\n/);
  await expect(page.getByRole("button", { name: "Edit born" })).toBeFocused();
  await page.getByRole("button", { name: "Add a field" }).click();
  await page.getByRole("textbox", { name: "Field name" }).fill("occupation");
  await page.keyboard.press("Enter");
  await expect(page.getByText("There's already a field “occupation”.")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add a field" }).click();
  await page.getByRole("textbox", { name: "Field name" }).fill("born");
  await page.keyboard.press("Enter");
  await expect(page.getByText("There's already a field “born”.")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Edit born" }).click();
  await page.getByRole("button", { name: "Remove the field" }).click();
  await expect.poll(() => novel.read(file)).not.toContain("born");

  // No notes of its own (D20): what's said about it goes in the book's notes.
  await expect(page.getByRole("textbox", { name: /^Notes on/ })).toHaveCount(0);
  expect(await novel.read(file)).toMatch(/\n---\n$/);
  await axe(page);
});

test("notes still in an entry's file show on its profile until they're moved into a note about it, in one commit (D20, #181)", async ({ page, app }) => {
  const dir = app.novelRepo("varn");
  const MIRELA = "bible/characters/mirela-kost.md";
  writeFileSync(join(dir, MIRELA), `${readFileSync(join(dir, MIRELA), "utf8")}Owes the bank more than she says.\n`);
  app.git(dir, "commit", "-qam", "Mirela's notes");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused();
  await palette(page, "character: mirela");
  const kept = page.getByRole("region", { name: "Notes kept in the entry's file" });
  await expect(kept).toContainText("Owes the bank more than she says.");
  await axe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page);
  await page.emulateMedia({ colorScheme: "light" });
  await kept.getByRole("button", { name: "Move them into your notes…" }).click();
  const ask = page.getByRole("alertdialog", { name: "Move entries' notes into your notes?" });
  await expect(ask).toContainText("Every word is kept, in one commit");
  await ask.getByRole("button", { name: "Move them" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Moved: the entries' notes are in your notes now" })).toBeVisible();
  await expect(kept).toHaveCount(0);
  expect(app.git(dir, "log", "-1", "--format=%s").trim()).toBe("An entry's notes moved into the book's notes, each in a note that mentions it");
  // A gh-writer novel stays one: only the notes moved.
  expect(app.git(dir, "show", "--name-status", "--format=", "HEAD").trim().split("\n").sort()).toEqual(["A\tnotes/mirela-kost-2.md", "M\tbible/characters/mirela-kost.md"]);
  expect(readFileSync(join(dir, MIRELA), "utf8")).toMatch(/\n---\n$/);
  const about = page.getByRole("region", { name: "In your notes" }).getByRole("link");
  await expect(about.first()).toHaveText("Mirela Kost");
  expect(readFileSync(join(dir, "notes/mirela-kost-2.md"), "utf8")).toMatch(/\n\[Mirela Kost\]\(#char_m1re1a\)\n\nOwes the bank more than she says\.\n$/);
  // Nothing left to move: the palette no longer offers it.
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("move entries");
  await expect(page.getByRole("option", { name: /Move entries' notes/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
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

test("searches the bible by anything an entry says: names, other names, summaries and fields", async ({ page, app }) => {
  await open(page, app);
  await palette(page, "story bible");
  const search = page.getByRole("searchbox", { name: "Search the bible" });
  const results = page.getByRole("main").getByRole("region", { name: /^Characters/ });
  // A field's value: only Ada's eyes are grey.
  await search.fill("GREY");
  await expect(page.getByText(/entr(y|ies) match(es)? “GREY”/)).toBeVisible();
  await expect(results.getByRole("link")).toHaveCount(1);
  await expect(results.getByRole("link", { name: /^Ada Varn/ })).toBeVisible();
  // Another name, in any case; and a summary: Ben is “Ada's younger brother”. Not the notes about an entry, which are the book's (D20): Tomas's “taught Ada to read a gauge”.
  await search.fill("m. k.");
  await expect(results.getByRole("link", { name: /^Mirela Kost/ })).toBeVisible();
  await search.fill("ada");
  await expect(results.getByRole("link", { name: /^Ada Varn/ })).toBeVisible();
  await expect(results.getByRole("link", { name: /^Ben Varn/ })).toBeVisible();
  await expect(results.getByRole("link", { name: /^Tomas Hale/ })).toHaveCount(0);
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
  // Each passage, without its Link it (#154).
  const passages = part.getByRole("list", { name: "Passages naming Ben Varn" }).getByRole("button").filter({ hasNotText: /^(Link it|Not a name here)$/ });
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
  await expect(strip.getByRole("button")).toHaveText(["Profile", "In your notes · 1", "In the story", "Appears in · 6", "Relationships · 5"]);
  await strip.getByRole("button", { name: "Appears in · 6" }).click();
  await expect(part.getByRole("heading", { name: "Appears in · 6" })).toBeFocused();
  await expect(strip.getByRole("button", { name: "Appears in · 6" })).toHaveAttribute("aria-current", "true");

  // Enter on a passage: its scene, with the sentence selected and the caret in the text.
  await passages.first().focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/scene\/sc_br1dg3$/);
  await expect(page.getByRole("textbox", { name: "Scene text" })).toBeFocused();
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe("Ben met her at the toll house with two coffees and a grin that was a size too large for him.");
});

test("a name written without a link is linked from the entry's profile: only its bytes change, the scene lists him, Undo puts it back (#154)", async ({ page, app }) => {
  const { read } = await open(page, app);
  const LEDGER = "manuscript/01-return/02-old-debts/02-bens-ledger.md";
  const FLOOD = "manuscript/02-the-sale/01-night-crossing/02-the-flood.md";
  const was = read(LEDGER);
  await page.goto(`${app.url}${new URL(app.launchUrl).pathname.replace(/\/chapter.*$/, "")}/bible/char_b3n0vs/page`);
  const part = page.getByRole("region", { name: "Appears in · 6" });
  const notLinked = part.getByRole("group", { name: "Show" }).getByRole("button", { name: /^Not linked/ });
  await expect(notLinked).toHaveText("Not linked · 3");

  // Link it: the name becomes a mention, as the editor writes one, and Ben's Ledger lists him; nothing else changes.
  await part.getByRole("button", { name: "Link “Ben” in “Ben's Ledger” to Ben Varn" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Linked “Ben” to Ben Varn in “Ben's Ledger”." })).toBeVisible();
  await expect.poll(() => read(LEDGER)).toBe(was.replace("which meant Ben had", "which meant [Ben](#char_b3n0vs) had").replace("characters: [char_7f3k2q]", "characters: [char_7f3k2q, char_b3n0vs]"));
  await expect(notLinked).toHaveText("Not linked · 2");

  // Undo: the scene byte for byte as it was.
  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => read(LEDGER)).toBe(was);
  await expect(notLinked).toHaveText("Not linked · 3");

  // Alt+Enter on a passage links it too; opened, the text shows the mention.
  const flood = part.getByRole("button", { name: /^The Flood, point of view, not linked: Ben was fourteen/ });
  await flood.focus();
  await page.keyboard.press("Alt+Enter");
  await expect.poll(() => read(FLOOD)).toContain("[Ben](#char_b3n0vs) was fourteen");
  await expect(notLinked).toHaveText("Not linked · 2");
  await part.getByRole("button", { name: /^The Flood, point of view: Ben was fourteen/ }).click();
  const text = page.getByRole("textbox", { name: "Scene text" });
  await expect(text).toBeFocused();
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe("Ben was fourteen, and the river was louder than he had known a river could be.");
  await expect(text.locator('[data-mention="char_b3n0vs"]').first()).toHaveText("Ben");
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

  // Where each matched: Ada and the house in their summaries, each with the word marked.
  await search.fill("family");
  await expect(characters.getByRole("link", { name: /^Ada Varn/ })).toContainText("summary");
  await expect(characters.getByRole("link", { name: /^Ada Varn/ }).locator("mark")).toHaveText("family");
  await expect(locations.getByRole("link", { name: /^The Varn House/ })).toContainText("summary");
  await expect(found).toHaveText("5 entries match “family” (and the off-page events below that do)");

  // A filter by type, from + Filter: only characters, said as a chip; the count says so.
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  const adding = page.getByRole("dialog", { name: "Filter the bible" });
  await expect(adding.getByRole("combobox", { name: "By" })).toHaveValue("type");
  await adding.getByRole("combobox", { name: "Type" }).selectOption("character");
  await adding.getByRole("button", { name: "Add the filter" }).click();
  await expect(page.getByRole("button", { name: "Remove the filter: Characters" })).toBeVisible();
  await expect(locations).toHaveCount(0);
  await expect(found).toHaveText("3 entries match “family” and the filters");
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

  // A new entry made from the filtered index keeps the filter, under the modal and beside the entry once
  // made; New offers the type filtered to.
  await page.getByRole("button", { name: /^New (?!type$)/ }).first().click();
  const naming = page.getByRole("dialog");
  await expect(naming.getByRole("combobox", { name: "Type" })).toHaveValue("location");
  await expect(page).toHaveURL(/\/bible\/new\?type=location$/);
  await naming.getByRole("textbox", { name: "Name" }).fill("The Ferry Steps");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "The Ferry Steps" })).toBeVisible();
  await expect(page).toHaveURL(/\/bible\/[^/?]+\?type=location$/);
  await expect(page.getByRole("button", { name: "Remove the filter: Locations" })).toBeVisible();
  await expect(characters).toHaveCount(0);
  await expect(locations.getByRole("link", { name: /^The Ferry Steps/ })).toBeVisible();

  // Not in the story yet: an entry no scene uses. From the palette too, the filter is kept.
  await palette(page, "new location");
  await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("The Old Mill");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "The Old Mill" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove the filter: Locations" })).toBeVisible();
  await page.getByRole("link", { name: "Close the entry" }).click();
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await adding.getByRole("combobox", { name: "By" }).selectOption("absent");
  await adding.getByRole("button", { name: "Add the filter" }).click();
  await expect(locations.getByRole("link").locator("span.font-semibold:not([aria-hidden])")).toHaveText(["The Ferry Steps", "The Old Mill"]);
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

  // In a part being edited, the keys are the text's.
  await page.getByRole("button", { name: "Edit summary" }).click();
  const summary = page.getByRole("textbox", { name: "Summary" });
  await summary.press("Control+End");
  await page.keyboard.type(" jk/");
  await expect(summary).toHaveValue(/ jk\/$/);
  await expect(page.getByRole("region", { name: "Ada Varn" })).toBeVisible();
  await page.keyboard.press("Escape");

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

test("a type's fields in a novel in gh-writer's format: the dialog asks to move it to the new format first (#164)", async ({ page, app }) => {
  await open(page, app);
  await palette(page, "fields of characters");
  const dialog = page.getByRole("dialog", { name: "Fields of characters" });
  await expect(dialog).toContainText("Move it to the new format first.");
  await dialog.getByRole("button", { name: "Move to the new format…" }).click();
  await expect(page.getByRole("alertdialog", { name: "Move this book to the new format?" })).toBeVisible();
});

test("the index as a table: one type's entries side by side, sorted by a column, gaps counted, a cell edited in place by keyboard (#139, #168)", async ({ page, app }) => {
  const novel = await open(page, app);
  await palette(page, "story bible");
  await page.getByRole("button", { name: "Table" }).click();
  await expect(page.getByRole("button", { name: "Table" })).toHaveAttribute("aria-pressed", "true");
  // One type at a time: chosen here, it's the type chip.
  await page.getByRole("button", { name: /^Characters/ }).click();
  await expect(page).toHaveURL(/type=character/);
  const grid = page.getByRole("grid", { name: /^Characters/ });
  await expect(grid.getByRole("columnheader")).toHaveText(["", "Name", "Age", "Occupation", "Appearance", "Wants", "Fears", "Scenes", "First seen", "Tags"]);
  const names = grid.locator("tbody tr td:nth-child(2)");
  await expect(names).toHaveText(["Ada Varn", "Ben Varn", "Tomas Hale", "Mirela Kost"]);
  // Tomas Hale has no occupation: a gap, counted with the rest (every empty declared field).
  const row = (name: string) => grid.getByRole("row").filter({ has: page.getByRole("link", { name }) });
  await expect(row("Tomas Hale").getByRole("gridcell").nth(3)).toHaveText("—Empty");
  await expect(page.getByText("4 characters · 14 gaps")).toBeVisible();
  await axe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page);
  await page.emulateMedia({ colorScheme: "light" });

  // Sorted by age, as numbers: Ben (29) before Ada (31) and Tomas (68); Mirela, with none, last. Again, the other way.
  await grid.getByRole("button", { name: "Age" }).click();
  await expect(grid.getByRole("columnheader", { name: "Age" })).toHaveAttribute("aria-sort", "ascending");
  await expect(names).toHaveText(["Ben Varn", "Ada Varn", "Tomas Hale", "Mirela Kost"]);
  await grid.getByRole("button", { name: "Age" }).click();
  await expect(names).toHaveText(["Tomas Hale", "Ada Varn", "Ben Varn", "Mirela Kost"]);
  await grid.getByRole("button", { name: "Age" }).click();

  // By keyboard: down from the header into Ben's age, right to his occupation; Enter edits it, Enter saves it.
  await expect(grid.getByRole("button", { name: "Age" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  const occupation = row("Ben Varn").getByRole("gridcell").nth(3);
  await expect(occupation).toBeFocused();
  await page.keyboard.press("Enter");
  const box = page.getByRole("textbox", { name: "Occupation of Ben Varn" });
  await expect(box).toBeFocused();
  await box.fill("Ferryman");
  await page.keyboard.press("Enter");
  await expect(occupation).toHaveText("Ferryman");
  await expect(occupation).toBeFocused();
  expect(novel.read("bible/characters/ben.md")).toContain("  occupation: Ferryman\n");
  expect(novel.lastCommit()).toBe("Bible: edit Ben Varn");
  // Escape leaves it as it was; Tab saves and moves on.
  await page.keyboard.press("Enter");
  await box.fill("Smuggler");
  await page.keyboard.press("Escape");
  await expect(occupation).toHaveText("Ferryman");
  await expect(occupation).toBeFocused();
  await page.keyboard.press("Enter");
  await box.fill("Toll keeper");
  await page.keyboard.press("Tab");
  await expect(row("Ben Varn").getByRole("gridcell").nth(4)).toBeFocused();
  await expect(occupation).toHaveText("Toll keeper");
  expect(novel.read("bible/characters/ben.md")).toContain("  occupation: Toll keeper\n");

  // A file that changed since its cell was opened isn't written over: the cell says why.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(row("Ada Varn").getByRole("gridcell").nth(2)).toBeFocused();
  const opened = page.waitForResponse((r) => r.request().method() === "GET" && decodeURIComponent(r.url()).includes("characters/ada.md"));
  await page.keyboard.press("Enter");
  await opened;
  const age = page.getByRole("textbox", { name: "Age of Ada Varn" });
  await expect(age).toBeFocused();
  writeFileSync(join(novel.dir, "bible/characters/ada.md"), novel.read("bible/characters/ada.md").replace("eyes: grey", "eyes: green"));
  await age.fill("32");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("changed since it was read");
  expect(novel.read("bible/characters/ada.md")).toContain("  age: 31\n");
  await page.keyboard.press("Escape");

  // Columns: Wants taken off and Eyes (a field of Ada's own) put on, kept for next time.
  await page.getByRole("button", { name: "Columns" }).click();
  await page.getByRole("checkbox", { name: "Wants" }).uncheck();
  await page.getByRole("checkbox", { name: /^Eyes/ }).check();
  await page.keyboard.press("Escape");
  await expect(grid.getByRole("columnheader")).toHaveText(["", "Name", "Age", "Occupation", "Appearance", "Fears", "Scenes", "First seen", "Tags", "Eyes"]);
  await page.reload();
  await expect(grid.getByRole("columnheader")).toHaveText(["", "Name", "Age", "Occupation", "Appearance", "Fears", "Scenes", "First seen", "Tags", "Eyes"]);
  await expect(row("Ada Varn").getByRole("gridcell").nth(9)).toHaveText("green");
});

test("rows of the table chosen and changed together in one commit, undone as one, and copied for a spreadsheet (#139, #169)", async ({ page, app }) => {
  const novel = await open(page, app);
  const files = ["bible/characters/ada.md", "bible/characters/ben.md", "bible/characters/tomas-hale.md"];
  const before = files.map((f) => novel.read(f));
  await palette(page, "story bible");
  await page.getByRole("button", { name: "Table" }).click();
  await page.getByRole("button", { name: /^Characters/ }).click();
  const grid = page.getByRole("grid", { name: /^Characters/ });
  await page.getByRole("checkbox", { name: "Select Ada Varn" }).check();
  await page.getByRole("checkbox", { name: "Select Ben Varn" }).check();
  const bar = page.getByRole("toolbar", { name: "The selected rows" });
  await expect(bar).toContainText("2 selected");
  await expect(grid.getByRole("row", { selected: true })).toHaveCount(2);

  // Eyes set on both: one commit, both files, Undo puts both back byte for byte.
  await bar.getByRole("button", { name: "Set a field…" }).click();
  const dialog = page.getByRole("dialog", { name: "Set a field on Ada Varn and Ben Varn" });
  await dialog.getByRole("combobox", { name: "Field" }).selectOption({ label: "Eyes" });
  await dialog.getByRole("textbox", { name: "Eyes" }).fill("brown");
  await axe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page);
  await page.emulateMedia({ colorScheme: "light" });
  await dialog.getByRole("button", { name: "Set it" }).click();
  await expect(dialog).toBeHidden();
  expect(novel.lastCommit()).toBe("Bible: set Eyes on Ada Varn and Ben Varn");
  expect(app.git(novel.dir, "show", "--name-only", "--format=", "HEAD").trim().split("\n").sort()).toEqual(files.slice(0, 2));
  expect(novel.read(files[1]!)).toContain("  eyes: brown\n");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => novel.lastCommit()).toBe("Undo “Bible: set Eyes on Ada Varn and Ben Varn”");
  expect(files.map((f) => novel.read(f))).toEqual(before);

  // By keyboard: three rows chosen with Space and Shift+Down, then tagged.
  await bar.getByRole("button", { name: "Clear" }).click();
  await expect(bar).toBeHidden();
  await page.getByRole("checkbox", { name: "Select Ada Varn" }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(bar).toContainText("3 selected");
  await expect(page.getByRole("checkbox", { name: "Select Tomas Hale" })).toBeChecked();
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+Tab");
  await expect(bar.getByRole("button", { name: "Add a tag…" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.type("family");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(novel.lastCommit()).toBe("Bible: tag Ada Varn, Ben Varn and Tomas Hale “family”");
  await expect(grid.getByRole("row").filter({ hasText: "Tomas Hale" })).toContainText("family");

  // A relationship from each of two to Mirela, in one commit.
  await page.getByRole("checkbox", { name: "Select Tomas Hale" }).uncheck();
  await bar.getByRole("button", { name: "Add a relationship…" }).click();
  await page.getByRole("combobox", { name: "Relationship" }).selectOption("rivals");
  await page.getByRole("combobox", { name: "With" }).selectOption({ label: "Mirela Kost" });
  await page.getByRole("button", { name: "Add it" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(novel.lastCommit()).toBe("Bible: add 2 “rivals” relationships");

  // Copy as a table: the selected rows, tab-separated, as shown.
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => void ((window as unknown as { copied: string }).copied = t) } }));
  await page.getByRole("button", { name: "Copy as a table" }).click();
  await expect(page.getByText("Copied 2 characters as a table.")).toBeVisible();
  const copied = await page.evaluate(() => (window as unknown as { copied: string }).copied);
  expect(copied.split("\n")[0]).toBe("Name\tAge\tOccupation\tAppearance\tWants\tFears\tScenes\tFirst seen\tTags");
  expect(copied.split("\n")[1]).toMatch(/^Ada Varn\t31\tStructural engineer\t\t\t\t\d+\tThe Station\t.*family$/);
  expect(copied.split("\n")).toHaveLength(4);
});

test("Not a name here, from an entry's profile, a scene's Not linked here and the text: kept in the index's own file, never offered there again, and undone (#171, D19)", async ({ page, app }) => {
  const { read, lastCommit } = await open(page, app);
  const book = new URL(app.launchUrl).pathname.replace(/\/chapter.*$/, "");
  await page.goto(`${app.url}${book}/bible/char_b3n0vs/page`);
  const part = page.getByRole("region", { name: /^Appears in/ });
  const notLinked = part.getByRole("group", { name: "Show" }).getByRole("button", { name: /^Not linked/ });
  await expect(notLinked).toHaveText("Not linked · 3");

  // From the profile: the word in Ben's Ledger isn't him there. It's kept, one line, and merges line by line.
  await part.getByRole("button", { name: "“Ben” in “Ben's Ledger” isn't Ben Varn: not a name here" }).click();
  await expect(page.getByRole("status").filter({ hasText: "“Ben” in “Ben's Ledger” isn't Ben Varn" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Appears in · 5" })).toBeVisible();
  await expect(notLinked).toHaveText("Not linked · 2");
  expect(read("bible/not-names.yaml")).toContain('- { entry: char_b3n0vs, piece: sc_1edger, sentence: "The ledger was where their mother had kept the egg money, behind the loose board under the stairs, which meant Ben had wanted it found by someone, someday.", nth: 0 }\n');
  expect(read(".gitattributes")).toContain("bible/not-names.yaml merge=union\n");
  expect(lastCommit()).toBe("Bible: a word in “Ben's Ledger” isn't Ben Varn");
  await axe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page);
  await page.emulateMedia({ colorScheme: "light" });

  // Undo: offered again.
  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect(notLinked).toHaveText("Not linked · 3");
  expect(read("bible/not-names.yaml")).not.toContain("sc_1edger");
  await part.getByRole("button", { name: "“Ben” in “Ben's Ledger” isn't Ben Varn: not a name here" }).click();
  await expect(notLinked).toHaveText("Not linked · 2");

  // The text doesn't underline it either.
  await page.goto(`${app.url}${book}/scene/sc_1edger`);
  const text = page.getByRole("textbox", { name: "Scene text" });
  await expect(text).toBeFocused();
  await palette(page, "suggest links");
  await expect(text.locator(".ghw-unlinked").first()).toBeVisible();
  await expect(text.locator(".ghw-unlinked", { hasText: /^Ben$/ })).toHaveCount(0);

  // In The Flood, from the scene's Not linked here: the first of two.
  await page.goto(`${app.url}${book}/scene/sc_f100d0`);
  await expect(text).toBeFocused();
  await expect(text.locator(".ghw-unlinked", { hasText: /^Ben$/ })).toHaveCount(2);
  const sidebar = page.getByRole("complementary", { name: "Right sidebar" });
  await expect(sidebar.getByRole("button", { name: /^Link “Ben” to Ben Varn: 2 not linked/ })).toBeVisible();
  await sidebar.getByRole("button", { name: "The first “Ben” isn't Ben Varn: not a name here" }).click();
  await expect(sidebar.getByRole("button", { name: /^Link “Ben” to Ben Varn: 1 not linked/ })).toBeVisible();
  await expect(text.locator(".ghw-unlinked", { hasText: /^Ben$/ })).toHaveCount(1);

  // And from the text: the caret on the other, then Not a name here from the palette.
  await text.locator(".ghw-unlinked", { hasText: /^Ben$/ }).click();
  await selectionSettled(page);
  await palette(page, "not a name here");
  await expect(text.locator(".ghw-unlinked", { hasText: /^Ben$/ })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: /^Link “Ben” to Ben Varn/ })).toHaveCount(0);
  expect(read("bible/not-names.yaml").match(/^- /gm)).toHaveLength(3);
  expect(read("bible/not-names.yaml")).toContain('sentence: "Nobody gave Ben anything to hold.", nth: 0 }');
});

test("Tidy up: the index's counts, each opening its list with the fix beside each; Link all in one commit, undone; reviewed one by one in the text; a quiet dot when a count rises (#137, #172)", async ({ page, app }) => {
  test.setTimeout(60_000);
  const dir = app.novelRepo("varn");
  // A quick entry made twice: Benjamin, beside Ben Varn, in no scene and with no summary.
  writeFileSync(join(dir, "bible/characters/benjamin.md"), "---\nid: char_b3nj4m\nname: Benjamin\n---\n");
  app.git(dir, "add", "-A");
  app.git(dir, "commit", "-qm", "Benjamin");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused();
  const read = (path: string) => readFileSync(join(dir, path), "utf8");
  const lastCommit = () => app.git(dir, "log", "-1", "--format=%s").trim();
  const LEDGER = "manuscript/01-return/02-old-debts/02-bens-ledger.md";
  const FLOOD = "manuscript/02-the-sale/01-night-crossing/02-the-flood.md";
  const was = [read(LEDGER), read(FLOOD)];

  await palette(page, "tidy up");
  await expect(page.getByRole("heading", { level: 1, name: "Tidy up the bible" })).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "What to tidy" }).getByRole("tab");
  await expect(tabs).toHaveText(["18Names not linked", "1Not in the manuscript yet", "1Might be the same", "1No summary", "27Empty fields"]);
  await axe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page);
  await page.emulateMedia({ colorScheme: "light" });

  // Link all: Ben's three plain names, mentions in one commit; nothing else in those scenes changes. Undo puts both back.
  const ben = page.getByRole("list", { name: "Names not linked" }).getByRole("listitem").filter({ hasText: /^Ben Varn/ });
  await expect(ben).toContainText("3 not linked in 2 scenes");
  await ben.getByRole("button", { name: "Link all 3 to Ben Varn" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Linked Ben Varn in 2 scenes: 3 places." })).toBeVisible();
  expect(lastCommit()).toBe("Bible: link Ben Varn in 2 scenes");
  expect(read(LEDGER)).toBe(was[0]!.replace("which meant Ben had", "which meant [Ben](#char_b3n0vs) had").replace("characters: [char_7f3k2q]", "characters: [char_7f3k2q, char_b3n0vs]"));
  expect(read(FLOOD)).toBe(was[1]!.replace("Ben was fourteen", "[Ben](#char_b3n0vs) was fourteen").replace("Nobody gave Ben anything", "Nobody gave [Ben](#char_b3n0vs) anything"));
  await expect(tabs.first()).toHaveText("15Names not linked");
  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect(tabs.first()).toHaveText("18Names not linked");
  expect([read(LEDGER), read(FLOOD)]).toEqual(was);

  // The tabs by keyboard; might be the same: Ben Varn and Benjamin, judged different, kept in the index's file.
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(2)).toBeFocused();
  await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel");
  await expect(panel).toContainText("Ben Varn and Benjamin · characters · one begins the other");
  await panel.getByRole("button", { name: "Ben Varn and Benjamin are different" }).click();
  await expect(tabs.nth(2)).toHaveText("0Might be the same");
  expect(read("bible/different.yaml")).toContain("- [char_b3n0vs, char_b3nj4m]\n");

  // No summary: given one where it's listed.
  await tabs.nth(3).click();
  await panel.getByRole("textbox", { name: "Benjamin" }).fill("A boy at the ferry, nobody's brother.");
  await page.keyboard.press("Enter");
  await expect(tabs.nth(3)).toHaveText("0No summary");
  expect(read("bible/characters/benjamin.md")).toContain("summary: A boy at the ferry, nobody's brother.");

  // Review one by one: Ben's three in the text, linked, not a name, skipped.
  await tabs.first().click();
  await ben.getByRole("button", { name: "Review Ben Varn's 3 one by one" }).click();
  const bar = page.getByRole("region", { name: "Review names not linked" });
  await expect(bar).toContainText("Ben Varn, not linked: 1 of 3, in “Ben's Ledger”");
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toContain("which meant Ben had wanted it found");
  await bar.getByRole("button", { name: "Link it" }).click();
  await expect(bar).toContainText("2 of 3, in “The Flood”");
  await expect.poll(() => read(LEDGER)).toContain("which meant [Ben](#char_b3n0vs) had");
  await bar.getByRole("button", { name: "Not a name here" }).click();
  await expect(bar).toContainText("3 of 3");
  await expect.poll(() => read("bible/not-names.yaml")).toContain('sentence: "Ben was fourteen, and the river was louder than he had known a river could be.", nth: 0 }');
  await bar.getByRole("button", { name: "Skip" }).click();
  await expect(bar).toBeHidden();

  // The sidebar's quiet dot: none while nothing has risen since Tidy up was opened; one when a count does.
  const index = page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: /^Story bible/ });
  await expect(index).toHaveAccessibleName("Story bible");
  writeFileSync(join(dir, "bible/characters/nobody.md"), "---\nid: char_n0b0dy\nname: Nobody Yet\n---\n");
  await expect(index).toHaveAccessibleName(/^Story bible ?, something to tidy up$/, { timeout: 10_000 });
});

test("merging two entries that are one: from Tidy up's pair or the profile, told first what it changes, every reference moved in one commit, undone (#137, #173)", async ({ page, app }) => {
  const dir = app.novelRepo("varn");
  const STATION = "manuscript/01-return/01-arrival/01-the-station.md";
  // Benjamin, made from @ mid-scene: in The Station's prose and its characters.
  writeFileSync(join(dir, "bible/characters/benjamin.md"), "---\nid: char_b3nj4m\nname: Benjamin\n---\nAlways at the toll house.\n");
  writeFileSync(join(dir, STATION), readFileSync(join(dir, STATION), "utf8").replace(/characters: \[([^\]]*)\]/, "characters: [$1, char_b3nj4m]").replace(/\n$/, "\n\nThen [Benjamin](#char_b3nj4m) waved.\n"));
  app.git(dir, "add", "-A");
  app.git(dir, "commit", "-qm", "Benjamin");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused();
  const read = (path: string) => readFileSync(join(dir, path), "utf8");
  const before = { station: read(STATION), ben: read("bible/characters/ben.md"), benjamin: read("bible/characters/benjamin.md") };

  // From Tidy up's pair: Ben Varn kept, told what changes.
  await palette(page, "tidy up");
  await page.getByRole("tab", { name: /Might be the same/ }).click();
  await page.getByRole("button", { name: "Merge Ben Varn and Benjamin…" }).click();
  const dialog = page.getByRole("dialog", { name: "Merge Benjamin and Ben Varn" });
  await expect(dialog.getByRole("radio", { name: "Ben Varn" })).toBeChecked();
  await expect(dialog).toContainText("Mentions and lists in 1 scene");
  await expect(dialog).toContainText("The notes kept in Benjamin's file become a note about Ben Varn.");
  await axe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page);
  await page.emulateMedia({ colorScheme: "light" });
  await dialog.getByRole("button", { name: "Merge into Ben Varn" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Merged Benjamin into Ben Varn." })).toBeVisible();
  expect(app.git(dir, "log", "-1", "--format=%s").trim()).toBe("Bible: merge Benjamin into Ben Varn");
  expect(existsSync(join(dir, "bible/characters/benjamin.md"))).toBe(false);
  expect(read(STATION)).not.toContain("char_b3nj4m");
  expect(read(STATION)).toContain("Then [Benjamin](#char_b3n0vs) waved.");
  expect(read("bible/characters/ben.md")).toContain("aliases: [Ben, Benjamin]");
  // Benjamin's notes, still in his file from before D20: a note about Ben, which Ben's profile lists.
  expect(read("notes/benjamin.md")).toMatch(/\n\[Ben Varn\]\(#char_b3n0vs\)\n\nAlways at the toll house\.\n$/);
  await expect(page.getByRole("tab", { name: /Might be the same/ })).toHaveText("0Might be the same");

  // Undo: every file back, byte for byte.
  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  // The files come back one after another: wait for them all, not just the first.
  await expect.poll(() => existsSync(join(dir, "bible/characters/benjamin.md")) && { station: read(STATION), ben: read("bible/characters/ben.md"), benjamin: read("bible/characters/benjamin.md") }).toEqual(before);
  expect(existsSync(join(dir, "notes/benjamin.md"))).toBe(false);

  // From the profile, by keyboard: Merge into…, the one to keep chosen; its page follows to the one kept.
  await page.goto(`${app.url}${new URL(app.launchUrl).pathname.replace(/\/chapter.*$/, "")}/bible/char_b3nj4m/page`);
  await page.getByRole("button", { name: "Merge into…" }).click();
  const into = page.getByRole("dialog", { name: "Merge Benjamin into…" });
  await expect(into.getByRole("combobox", { name: "Into" })).toBeFocused();
  await into.getByRole("combobox", { name: "Into" }).selectOption({ label: "Ben Varn" });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/bible\/char_b3n0vs$/);
  expect(existsSync(join(dir, "bible/characters/benjamin.md"))).toBe(false);
});
