import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { axe, expect, inPiece, openView, palette, test, type App } from "./fixtures.ts";

/**
 * The Campaign kind on screen (#41): the sample campaign's arc and sessions, its codex of NPCs,
 * player characters, locations, factions, items and quests, its outline, story map and graph, in a
 * game master's words, with nothing of the Novel's story-only modules.
 */

const sample = fileURLToPath(new URL("../../../examples/sample-campaign", import.meta.url));
/** No novel's words anywhere on the page. */
const novelWords = /\b(scenes?|chapters?|manuscript|story bible|novel|off the page|plotlines?|point of view|drafting board)\b/i;

async function open(page: Page, app: App) {
  await app.restart(app.bookRepo(sample, "campaign"));
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Arc text" })).toBeFocused();
}

test("opens in its arc and sessions, in a game master's words", async ({ page, app }) => {
  await open(page, app);
  await expect(page.getByRole("heading", { level: 1, name: "The Drowned Bell" })).toBeVisible();
  const tree = page.getByRole("tree");
  for (const name of ["The Drowned Bell", "Session 1", "Session 2"]) await expect(tree.getByRole("treeitem", { name, exact: false }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(novelWords);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }
});

test("its codex, outline and story map say its words too", async ({ page, app }) => {
  await open(page, app);
  await palette(page, "codex");
  await expect(page.getByRole("heading", { level: 1, name: "Codex" })).toBeVisible();
  for (const type of ["NPCs", "Player characters", "Locations", "Factions", "Items", "Quests"]) await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^${type}`) })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(novelWords);

  await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Outline" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Outline" })).toBeVisible();
  // Table and Cards: no drafting board for a campaign.
  await expect(page.getByRole("radiogroup", { name: "Show the outline as" }).getByRole("radio")).toHaveCount(2);
  await expect(page.locator("main")).not.toContainText(novelWords);

  await palette(page, "story map: timeline");
  await expect(page.getByRole("tabpanel", { name: "Timeline" }).getByRole("link", { name: "Session 2" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(novelWords);
});

test("the graph shows an NPC change sides at a session", async ({ page, app }) => {
  await open(page, app);
  await openView(page, "Relationships");
  await expect(page.getByRole("heading", { level: 1, name: "Relationships" })).toBeVisible();
  const slider = page.getByRole("slider", { name: "Position in the campaign" });
  await expect(slider).toHaveAttribute("aria-valuetext", "Session 1 of 2: Session 1, in The Drowned Bell");
  const edge = (name: string) => page.locator(`.react-flow__edge[aria-label="${name}"]`);
  await expect(edge("Marta Hollin, Member of, The Watch")).toHaveCount(1);
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(edge("Marta Hollin, Member of, The Tide Choir")).toHaveCount(1);
  await expect(edge("Marta Hollin, Member of, The Watch")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(novelWords);
  await axe(page);
});

test("its outline adds a session in place, in a game master's words (#117)", async ({ page, app }) => {
  await open(page, app);
  await openView(page, "Outline");
  await page.getByRole("button", { name: /^New session in / }).first().click();
  await page.getByRole("textbox", { name: /^Title: New session in / }).fill("The next session");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name: "The next session" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New arc" })).toBeVisible();
});

test("an NPC's fields are ready; a faction picked from its list is written by its ID, a new location made from the picker, and the faction lists the NPC (#138)", async ({ page, app }) => {
  const dir = app.bookRepo(sample, "campaign");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Arc text" })).toBeFocused();
  const read = (path: string) => readFileSync(join(dir, path), "utf8");

  await palette(page, "new npc");
  await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("Orrin");
  await page.keyboard.press("Enter");
  const profile = page.getByRole("region", { name: "Orrin" });
  await expect(profile.getByRole("heading", { level: 2, name: "Orrin" })).toBeVisible();
  await expect(profile.locator('dl[aria-label="Fields"]').first().locator("dt")).toHaveText(["Status", "Faction", "Disposition", "Location", "Voice"]);
  // Nothing written until a field is filled.
  const file = "codex/npcs/orrin.md";
  expect(read(file)).not.toContain("fields:");

  // Faction from its picker: chosen by typing, saved at once, its ID and nothing else written.
  await page.getByRole("button", { name: "Add faction" }).click();
  await expect(page.getByRole("button", { name: /^Faction/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.type("tide");
  await page.keyboard.press("Enter");
  await expect(profile.getByRole("link", { name: "The Tide Choir" })).toBeVisible();
  await expect.poll(() => read(file)).toMatch(/^---\nid: npc_[0-9a-z]{6}\nname: Orrin\nfields:\n {2}faction: fac_t1de00\n---\n$/);
  await expect(page.getByRole("button", { name: "Edit faction" })).toBeFocused();

  // Status, one of its options; a location that isn't in the codex yet, made from the picker.
  await page.getByRole("button", { name: "Add status" }).click();
  await page.getByRole("combobox", { name: "Status" }).selectOption("missing");
  await page.keyboard.press("Enter");
  await expect.poll(() => read(file)).toContain("  status: missing\n");
  await page.getByRole("button", { name: "Add location" }).click();
  await page.keyboard.press("Enter");
  await page.keyboard.type("The Lighthouse");
  await page.getByRole("option", { name: "New location “The Lighthouse”" }).click();
  await expect(profile.getByRole("link", { name: "The Lighthouse" })).toBeVisible();
  await expect.poll(() => read(file)).toMatch(/ {2}location: loc_[0-9a-z]{6}\n/);
  const location = /location: (loc_[0-9a-z]{6})/.exec(read(file))![1]!;
  expect(read("codex/locations/the-lighthouse.md")).toContain(`id: ${location}\nname: The Lighthouse\n`);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }
  await page.emulateMedia({ colorScheme: "light" });

  // The faction names Orrin among its NPCs, as a link to him.
  await profile.getByRole("link", { name: "The Tide Choir" }).click();
  const named = page.getByRole("region", { name: "Named in their fields" });
  await expect(named.locator("dt")).toHaveText(["NPCs · Faction"]);
  await expect(named.getByRole("link", { name: "Orrin" })).toBeVisible();
});

test("the Fields dialog: a field added and moved by keyboard, one renamed with its values in every NPC, saved in one commit (#164)", async ({ page, app }) => {
  const dir = app.bookRepo(sample, "campaign");
  const voss = join(dir, "codex/npcs/voss.md");
  writeFileSync(voss, readFileSync(voss, "utf8").replace("summary: Choirmaster of the Tide Choir.\n", "summary: Choirmaster of the Tide Choir.\nfields:\n  voice: low and slow\n"));
  app.git(dir, "commit", "-qam", "Voss's voice");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Arc text" })).toBeFocused();
  await palette(page, "codex");
  await page.getByRole("button", { name: "Fields of NPCs" }).click();
  const dialog = page.getByRole("dialog", { name: "Fields of NPCs" });
  const fields = dialog.getByRole("list", { name: "Fields of NPCs" }).getByRole("listitem");
  const names = () => fields.evaluateAll((items) => items.map((i) => i.getAttribute("aria-label")));
  expect(await names()).toEqual(["Status", "Faction", "Disposition", "Location", "Voice"]);

  // Added, its key following its label; moved up a place from the keyboard, said as it moves.
  await dialog.getByRole("button", { name: "Add a field" }).click();
  await expect(fields.last().getByRole("textbox", { name: "Label" })).toBeFocused();
  await page.keyboard.type("Oath");
  await expect(fields.last().getByRole("textbox", { name: "Key" })).toHaveValue("oath");
  await page.keyboard.press("Alt+ArrowUp");
  await expect(dialog.getByRole("status")).toHaveText("Oath moved to 5 of 6.");
  expect(await names()).toEqual(["Status", "Faction", "Disposition", "Location", "Oath", "Voice"]);

  // Voice renamed: offered to take Voss's value with it.
  const voice = dialog.getByRole("listitem", { name: "Voice" });
  await voice.getByRole("textbox", { name: "Key" }).fill("accent");
  await voice.getByRole("textbox", { name: "Label" }).fill("Accent");
  await expect(dialog.getByRole("checkbox", { name: "Rename “voice” to “accent” in 1 NPC" })).toBeChecked();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await dialog.getByRole("button", { name: "Save the fields" }).click();
  await expect(dialog).toHaveCount(0);
  expect(app.git(dir, "log", "-1", "--format=%s").trim()).toBe("Codex: the fields of NPCs, renaming “voice” in its entries");
  const manifest = readFileSync(join(dir, "book.yaml"), "utf8");
  expect([...manifest.slice(manifest.indexOf("entity_fields:")).matchAll(/- key: (\w+)/g)].map((m) => m[1])).toEqual(["status", "faction", "disposition", "location", "oath", "accent"]);
  expect(readFileSync(voss, "utf8")).toContain("fields:\n  accent: low and slow\n");

  // The profile reads the new list.
  await palette(page, "npc: voss");
  const profile = page.getByRole("region", { name: "Voss" });
  await expect(profile.locator('dl[aria-label="Fields"]').first().locator("dt")).toHaveText(["Status", "Faction", "Disposition", "Location", "Oath", "Accent"]);
  await expect(profile.getByRole("definition").filter({ hasText: "low and slow" })).toBeVisible();
});

test("a value that changes at a session: set from the profile read there, read at each session on the profile, the mention card and the Scene tab, drawn across the campaign (#140)", async ({ page, app }) => {
  const dir = app.bookRepo(sample, "campaign");
  const file = join(dir, "codex/npcs/marta.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("in her sleep.\n", "in her sleep.\nfields:\n  status: alive\n"));
  app.git(dir, "commit", "-qam", "Marta is alive");
  const before = readFileSync(file, "utf8");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Arc text" })).toBeFocused();

  // Read at Session 2, her status set: from there on.
  await palette(page, "npc: marta");
  const profile = page.getByRole("region", { name: "Marta Hollin" });
  const status = profile.locator('dl[aria-label="Fields"]').first().getByRole("definition").first();
  const readAt = profile.getByRole("combobox", { name: "Read at" });
  await readAt.selectOption({ label: "Session 2" });
  await profile.getByRole("button", { name: "Edit status" }).click();
  await expect(profile.getByText("From “Session 2” on")).toBeVisible();
  await profile.getByRole("combobox", { name: "Status" }).selectOption("missing");
  await page.keyboard.press("Enter");
  await expect(status).toHaveText(/^missing · from “Session 2”/);
  await expect.poll(() => readFileSync(file, "utf8")).toBe(before.replace("---\n", "").replace(/\n---\n/, "\nchanges:\n  - field: status\n    value: missing\n    since: ses_tw0002\n---\n").replace(/^/, "---\n"));

  // Read at Session 1, the start's; over the whole campaign, the latest, with its change listed and drawn.
  await readAt.selectOption({ label: "Session 1" });
  await expect(status).toHaveText(/^alive/);
  await readAt.selectOption({ label: "The whole campaign: the latest" });
  await expect(status).toHaveText(/^missing · from “Session 2”/);
  await expect(profile.getByRole("list", { name: "Changes of status" })).toHaveText(/From “Session 2”: missing/);
  await expect(profile.getByRole("list", { name: "How its fields change" })).toHaveText("Status: alive from the start, missing from “Session 2”");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }
  await page.emulateMedia({ colorScheme: "light" });

  // Beside each session's text, as she is there: on the Scene tab's card and the mention card.
  const tree = page.getByRole("tree");
  const sidebar = page.getByRole("complementary", { name: "Right sidebar" });
  const mention = page.locator('.ghw-mention[data-mention="npc_ma7ra1"]').first();
  for (const [session, said] of [["Session 1", "alive"], ["Session 2", "missing"]] as const) {
    await tree.getByRole("treeitem", { name: new RegExp(`^${session}`) }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: session })).toBeVisible();
    await expect(inPiece(sidebar, "Marta Hollin")).toContainText(said);
    await mention.hover();
    const card = page.getByRole("dialog", { name: "Marta Hollin" });
    await expect(card).toContainText(`status${said}`);
    await page.mouse.move(5, 5);
    await expect(card).toHaveCount(0);
  }
});
