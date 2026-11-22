import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { axe, editField, expect, inPiece, palette, test, type App } from "./fixtures.ts";

const BETRAYAL = "manuscript/02-the-sale/01-night-crossing/01-the-betrayal.md";
const STATION = "manuscript/01-return/01-arrival/01-the-station.md";

async function open(page: Page, app: App) {
  const dir = app.novelRepo("varn");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused();
  return { dir, read: (path: string) => readFileSync(join(dir, path), "utf8") };
}

async function pick(page: Page, picker: string | RegExp, search: string) {
  await page.getByRole("button", { name: picker }).click();
  await page.keyboard.type(search);
  await page.keyboard.press("Enter");
}

/** A row of the card, by its label: what it reads. */
const row = (panel: Locator, label: string) => panel.locator("dl > div").filter({ has: panel.page().locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd > div");

const frontMatter = (text: string) => text.slice(0, text.indexOf("\n---\n", 4) + 5);
const body = (text: string) => text.slice(text.indexOf("\n---\n", 4) + 5);

test("edits every detail of a scene, changing only those lines of its front matter", async ({ page, app }) => {
  const novel = await open(page, app);
  const before = novel.read(BETRAYAL);
  await page.getByRole("tree", { name: "Manuscript" }).getByRole("treeitem", { name: /^The Betrayal,/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "The Betrayal" })).toBeVisible();
  await palette(page, "show the scene's details");
  const panel = page.getByRole("region", { name: "Details of “The Betrayal”" });
  await expect(panel).toBeVisible();
  await axe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page);

  // Read as a card: the scene's place, its synopsis, status, a row for each detail that isn't an
  // entry, and everyone and everything in it as cards, each with its role there (#160).
  await expect(panel.getByRole("heading", { level: 2, name: "The Betrayal" })).toBeVisible();
  await expect(panel).toContainText("Night Crossing · scene 1 of");
  await expect(panel).toContainText("On the bridge at dusk, Ada learns Ben sold the plans to Mirela.");
  await expect(panel.getByRole("img", { name: "Status: revised" })).toBeVisible();
  await expect(panel.locator("dt")).toHaveText(["When"]);
  await expect(row(panel, "When")).toHaveText("Day 3, 18:30 · 45 min");
  await expect(inPiece(panel, "The Sale")).toContainText("plotline (major) “The plans have been sold”");
  await expect(inPiece(panel, "Ben's Debt")).toContainText("plotline (major) “Ben confesses the debt”");
  await expect(inPiece(panel, "Trust")).toContainText("theme (strong)");
  await expect(inPiece(panel, "Inheritance")).toContainText("theme (medium)");

  // Each row edited in place from its pencil; Enter saves a single field and returns to the row.
  await panel.getByRole("button", { name: "Edit synopsis" }).click();
  await expect(panel.getByRole("textbox", { name: "Synopsis" })).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Ada finds Ben on the bridge.");
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("button", { name: "Edit synopsis" })).toBeFocused();
  await expect(panel).toContainText("Ada finds Ben on the bridge.");
  // Escape returns to the row without saving.
  await page.keyboard.press("Enter");
  await page.keyboard.type(" Not this.");
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("button", { name: "Edit synopsis" })).toBeFocused();
  await expect(panel).not.toContainText("Not this.");

  await panel.getByRole("button", { name: "Edit status" }).click();
  await panel.getByRole("combobox", { name: "Status" }).selectOption("drafted");
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("img", { name: "Status: drafted" })).toBeVisible();

  // A card's pencil edits the field that names it here; Done returns to that pencil.
  const pencil = inPiece(panel, "Ada Varn").getByRole("button", { name: "Edit point of view" });
  await pencil.click();
  await pick(page, /^Point of view/, "ben");
  await expect(panel.getByRole("button", { name: /^Point of view/ })).toHaveAccessibleName("Point of view Ben Varn");
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(inPiece(panel, "Ben Varn")).toContainText("point of view");
  await expect(inPiece(panel, "Ada Varn")).toContainText("present");
  await expect(inPiece(panel, "Ada Varn").getByRole("button", { name: "Edit characters" })).toBeFocused();

  // Any entry field from Add… over the cards: what's added shows at once.
  await editField(panel, "Characters");
  await pick(page, /^Add to characters/, "kost"); // by alias
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(inPiece(panel, "Mirela Kost")).toContainText("present");
  await expect(panel.getByRole("button", { name: "Add to this scene…" })).toBeFocused();
  await editField(panel, "Where");
  await pick(page, /^Add to locations/, "the station");
  await panel.getByRole("button", { name: "Remove “The Varn Bridge”" }).click();
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(inPiece(panel, "Varn Station")).toContainText("set here");

  await editField(panel, "Plotlines");
  await panel.getByRole("textbox", { name: "Beat of “The Sale”" }).fill("Ben has sold the plans");
  await page.keyboard.press("Tab");
  await panel.getByRole("combobox", { name: "Weight of “Ben's Debt”" }).selectOption("minor");
  await panel.getByRole("button", { name: "Done" }).click();
  await editField(panel, "Themes");
  await panel.getByRole("combobox", { name: "Strength of “Inheritance”" }).selectOption("1");
  await panel.getByRole("button", { name: "Done" }).click();

  // Several fields: Enter saves one and stays.
  await panel.getByRole("button", { name: "Edit when" }).click();
  await panel.getByRole("textbox", { name: "Day" }).fill("4");
  await page.keyboard.press("Enter");
  // A time that isn't one is not saved, and says why.
  await panel.getByRole("textbox", { name: "Time" }).fill("7pm");
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("textbox", { name: "Time" })).toHaveAccessibleDescription("Like 18:30");
  await panel.getByRole("textbox", { name: "Time" }).fill("19:00");
  await page.keyboard.press("Enter");
  await panel.getByRole("textbox", { name: "Duration" }).fill("PT1H");
  await page.keyboard.press("Enter");
  await axe(page);
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(row(panel, "When")).toHaveText("Day 4, 19:00 · 1 h");

  // A detail it hasn't yet: behind Add….
  await panel.getByRole("button", { name: "Add…", exact: true }).click();
  await page.getByRole("menuitem", { name: "Tags" }).click();
  await panel.getByRole("textbox", { name: "Tags" }).fill("turning point, night");
  await page.keyboard.press("Enter");
  await expect(row(panel, "Tags")).toHaveText("turning point, night");

  await expect
    .poll(() => frontMatter(novel.read(BETRAYAL)), { timeout: 10_000 })
    .toBe(
      [
        "---",
        "id: sc_0d9wm4",
        "title: The Betrayal",
        "synopsis: Ada finds Ben on the bridge.",
        "status: drafted",
        "pov: char_b3n0vs",
        "characters: [char_7f3k2q, char_b3n0vs, char_m1re1a]",
        "locations: [loc_5tat10]",
        "entities: [art_p1an5x]",
        "plotlines:",
        "  - id: plot_h315tz",
        "    beat: Ben has sold the plans",
        "  - id: plot_gr1efa",
        "    beat: Ben confesses the debt",
        "    weight: minor",
        "themes:",
        "  - id: theme_trvst5",
        "    strength: 3",
        "  - id: theme_1nher1",
        "    strength: 1",
        "when:",
        "  day: 4",
        '  time: "19:00"',
        "duration: PT1H",
        "tags:",
        "  - turning point",
        "  - night",
        "---",
        "",
      ].join("\n"),
    );
  expect(body(novel.read(BETRAYAL))).toBe(body(before));
  for (const name of ["Ada Varn", "Ben Varn", "Mirela Kost"]) await expect(inPiece(panel, name)).toHaveCount(1);

  await palette(page, "hide the right sidebar");
  await expect(panel).toHaveCount(0);
});

test("in a chapter, follows the scene the caret is in; steps to others; names open the Entry tab", async ({ page, app }) => {
  const novel = await open(page, app);
  await palette(page, "show the scene's details");
  const station = page.getByRole("region", { name: "Details of “The Station”" });
  await expect(station).toBeVisible();
  // What the rest of the book says about it.
  await expect(station.getByRole("region", { name: "From the story" }).getByRole("listitem")).toHaveText(["The book's first scene.", "6 days after the off-page event “The plans are stolen”.", "First appearance of Ada Varn.", "The Sale begins here."]);
  await expect(station.getByRole("button", { name: "Previous scene" })).toBeDisabled();
  await page.getByRole("textbox", { name: "Chapter text" }).getByText(/met her at the toll house/).click();
  const bridge = page.getByRole("region", { name: "Details of “Walking the Span”" });
  await expect(bridge).toBeVisible();

  // Stepped back without moving the caret, and edited there: saved to that scene.
  await bridge.getByRole("button", { name: "Previous scene" }).click();
  await expect(station).toContainText("Arrival · scene 1 of 2");
  await station.getByRole("button", { name: "Edit status" }).click();
  await station.getByRole("combobox", { name: "Status" }).selectOption("revised");
  await page.keyboard.press("Escape");
  await expect.poll(() => frontMatter(novel.read(STATION)), { timeout: 10_000 }).toContain("status: revised");
  await station.getByRole("button", { name: "Next scene" }).click();
  await expect(bridge).toBeVisible();

  // A name opens its entry on the Entry tab.
  await inPiece(bridge, "Ada Varn").getByRole("button", { name: /^Ada Varn/ }).click();
  await expect(page.getByRole("tab", { name: "Entry", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "Ada Varn" })).toBeFocused();
  await page.getByRole("tab", { name: "Scene", exact: true }).click();
  await expect(bridge).toBeVisible();
  // Remembered across a reload.
  await page.reload();
  await expect(page.getByRole("region", { name: /^Details of/ })).toBeVisible();
});

test("makes a new entry from a picker, and lists custom types in groups of their own", async ({ page, app }) => {
  const novel = await open(page, app);
  await page.getByRole("tree", { name: "Manuscript" }).getByRole("treeitem", { name: /^The Betrayal,/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "The Betrayal" })).toBeVisible();
  await palette(page, "show the scene's details");
  const panel = page.getByRole("region", { name: "Details of “The Betrayal”" });
  const url = page.url();

  // Someone new, from the characters picker: made, and in the scene at once.
  await editField(panel, "Characters");
  await panel.getByRole("button", { name: /^Add to characters/ }).click();
  await page.keyboard.type("Lena Dray");
  await expect(page.getByRole("option", { name: "New character “Lena Dray”" })).toBeVisible();
  await expect(page.getByText("Nothing matches")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("group", { name: "Characters" })).toContainText("Lena Dray");
  await expect.poll(() => existsSync(join(novel.dir, "bible/characters/lena-dray.md")), { timeout: 10_000 }).toBe(true);
  const lena = /^id: (char_\w{6})$/m.exec(novel.read("bible/characters/lena-dray.md"))![1]!;
  await expect.poll(() => frontMatter(novel.read(BETRAYAL))).toContain(`characters: [char_7f3k2q, char_b3n0vs, ${lena}]`);
  expect(page.url()).toBe(url);

  await panel.getByRole("button", { name: "Done" }).click();
  await expect(inPiece(panel, "Lena Dray")).toContainText("present");

  // Artifacts: a field of their own, kept in the scene's entities.
  await editField(panel, "Artifacts");
  const artifacts = panel.getByRole("group", { name: "Artifacts" });
  await expect(artifacts).toContainText("The Original Plans");
  await artifacts.getByRole("button", { name: "Remove “The Original Plans”" }).click();
  await expect.poll(() => frontMatter(novel.read(BETRAYAL))).toContain("entities: []");
  await pick(page, /^Add to artifacts/, "the plans");
  await expect.poll(() => frontMatter(novel.read(BETRAYAL))).toContain("entities:\n  - art_p1an5x\n");
  await pick(page, /^Add to artifacts/, "The Ledger");
  await expect.poll(() => existsSync(join(novel.dir, "bible/artifacts/the-ledger.md")), { timeout: 10_000 }).toBe(true);
  const ledger = /^id: (art_\w{6})$/m.exec(novel.read("bible/artifacts/the-ledger.md"))![1]!;
  await expect.poll(() => frontMatter(novel.read(BETRAYAL))).toContain(`entities:\n  - art_p1an5x\n  - ${ledger}\n`);
  await expect(artifacts).toContainText("The Ledger");
  // No "New type" here: types are made in the story bible.
  await expect(panel.getByRole("button", { name: /new type/i })).toHaveCount(0);
  await axe(page);
});

test("lists the built-in fields first, then custom types by name", async ({ page, app }) => {
  await open(page, app);
  const id = new URL(page.url()).pathname.split("/")[2]!;
  // From the page, as the app asks: the engine may be in it (#51).
  const status = await page.evaluate(
    async (url) => (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "prize", prefix: "prz", label: "Prize" }) })).status,
    `/api/novels/${id}/bible/entity-types`,
  );
  expect(status).toBe(201);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused();
  await palette(page, "show the scene's details");
  const panel = page.getByRole("region", { name: /^Details of/ });
  // Every entry field behind Add… over who's in it, in the card's order; the other details as rows
  // or behind their own Add….
  await panel.getByRole("button", { name: "Add to this scene…" }).click();
  await expect(page.getByRole("menu", { name: "Add to this scene…" }).getByRole("menuitem")).toHaveText(["Point of view", "Where", "Characters", "Plotlines", "Artifacts", "Prizes", "Themes"]);
  await page.keyboard.press("Escape");
  const rows = await panel.locator("dt").allTextContents();
  await panel.getByRole("button", { name: "Add…", exact: true }).click();
  const empty = await page.getByRole("menu", { name: "Add…" }).getByRole("menuitem").allTextContents();
  expect([...rows, ...empty]).toEqual(["When", "Tags"]);
  await axe(page);
});
