import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, launch, openView, palette, selectionSettled, test, type App } from "./fixtures.ts";

/**
 * The Campaign end to end (#43, #6): a new campaign from the shelf, two sessions prepped from the
 * template with the NPC, faction and quest in them made from mentions, a note from the table, an
 * NPC's standing with a faction changed at the second session and seen on the graph as of each, then
 * put on GitHub and synced.
 */

const badge = (page: Page) => page.getByRole("button", { name: /^Sync: / });
const session = (page: Page) => page.getByRole("textbox", { name: "Session text" });
const listbox = (page: Page) => page.getByRole("listbox", { name: "Mention suggestions" });
const dialog = (page: Page) => page.getByRole("dialog");
const edge = (page: Page, name: string) => page.locator(`.react-flow__edge[aria-label="${name}"]`);

/** Sign in to the fake GitHub with a code, from the ⋯ menu. */
async function signIn(page: Page, app: App) {
  await page.getByRole("banner").getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: /Connect GitHub/ }).click();
  const signing = page.getByRole("dialog", { name: "Connect to GitHub" });
  await signing.getByRole("button", { name: "Sign in with a code" }).click();
  await expect(signing.getByLabel("Your code")).toHaveText(app.github.userCode);
  app.github.approve();
  await expect(signing).toHaveCount(0);
}

/** @ and a new name, made a codex entry of the type in the `row`th New row (NPC, player character, location, faction, item, quest). */
async function newEntry(page: Page, name: string, row: number) {
  await page.keyboard.type(`@${name}`);
  await expect(listbox(page)).toBeVisible();
  await expect(listbox(page).getByRole("option", { name: new RegExp(`New .*${name}`) }).nth(row)).toBeVisible();
  for (let i = 0; i <= row; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
}

/** The caret on a new line under one of the prep's headings. */
async function under(page: Page, heading: string) {
  await session(page).getByRole("heading", { name: heading }).click();
  await selectionSettled(page);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
}

/** Open a picker, type, and take the best match. */
async function pick(page: Page, label: string, query: string) {
  await dialog(page).getByRole("button", { name: new RegExp(`^${label}`) }).click();
  await page.keyboard.type(query);
  await page.keyboard.press("Enter");
}

test("a new campaign: two sessions prepped and played, an NPC turning on a faction, synced to GitHub", async ({ page, app }) => {
  await launch(page, app);
  await signIn(page, app);
  await page.getByRole("list", { name: "Books" }).getByRole("button", { name: "New book" }).click();
  const making = page.getByRole("dialog", { name: "New book" });
  await making.getByRole("radio", { name: "Campaign" }).check();
  await making.getByRole("textbox", { name: "Title" }).fill("The Salt Coast");
  await making.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "The First Arc" })).toBeVisible();
  const dir = join(app.home, "writer", "the-salt-coast");
  const read = (path: string) => readFileSync(join(dir, path), "utf8");

  // Session 1, prepped from the template: its NPC, her faction and the quest made as they're mentioned.
  await page.getByRole("tree").getByRole("treeitem", { name: /^Session 1/ }).click();
  await under(page, "Strong start");
  await newEntry(page, "Marta Hollin", 0);
  await page.keyboard.type("of ");
  await newEntry(page, "The Tide Choir", 3);
  await page.keyboard.type("asks the party to find ");
  await newEntry(page, "The Drowned Bell", 5);
  await page.keyboard.press("Backspace");
  await page.keyboard.type(".");
  const first = "sessions/01-the-first-arc/01-session-1.md";
  await expect.poll(() => read(first), { timeout: 10_000 }).toMatch(/## Strong start\n\n\[Marta Hollin\]\(#npc_\w{6}\) of \[The Tide Choir\]\(#fac_\w{6}\) asks the party to find \[The Drowned Bell\]\(#qst_\w{6}\)\.\n\n## Scenes\n/);
  const marta = /\[Marta Hollin\]\(#(npc_\w{6})\)/.exec(read(first))![1]!;
  await expect.poll(() => read(first)).toMatch(new RegExp(`npcs:\\n {2}- ${marta}\\n`));
  await expect.poll(() => read(first)).toMatch(/quests:\n {2}- qst_\w{6}\n/);

  // Session 2, from the palette after it: the prep again, and Marta back.
  await palette(page, "new session");
  await dialog(page).getByRole("textbox", { name: "Title" }).fill("Session 2");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Session 2" })).toBeVisible();
  await under(page, "Secrets and clues");
  await page.keyboard.type("@Marta");
  await expect(listbox(page).getByRole("option", { name: /Marta Hollin/ }).first()).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type("rang the bell herself.");
  const second = "sessions/01-the-first-arc/02-session-2.md";
  await expect.poll(() => read(second), { timeout: 10_000 }).toMatch(new RegExp(`## Secrets and clues\\n\\n\\[Marta Hollin\\]\\(#${marta}\\) rang the bell herself\\.\\n\\n## NPCs\\n`));
  const ses2 = /^id: (ses_\w{6})$/m.exec(read(second))![1]!;

  // At the table: a note, pinned to the session, typed at once.
  await under(page, "At the table");
  await palette(page, "note from the table");
  await expect(page.getByRole("textbox", { name: "Note: At the table: Session 2" })).toBeFocused();
  await page.keyboard.type("Aya swore she'd see Marta hanged.");
  await expect.poll(() => read("notes/at-the-table-session-2.md"), { timeout: 10_000 }).toMatch(new RegExp(`pinned:\\n {2}- ${ses2}\\n[\\s\\S]*Aya swore she'd see Marta hanged\\.\\n$`));

  // Marta stands with the Tide Choir, until Session 2, when she turns on it.
  await palette(page, "npc: marta");
  const relationships = page.getByRole("region", { name: "Relationships" });
  await relationships.getByRole("button", { name: "Add a relationship" }).click();
  await dialog(page).getByRole("combobox", { name: "Relationship" }).selectOption({ label: "Allied with" });
  await pick(page, "With", "tide");
  await dialog(page).getByRole("button", { name: "Add relationship" }).click();
  await expect(relationships.getByRole("list", { name: "All relationships" })).toContainText("Allied with The Tide Choir");
  await relationships.getByRole("button", { name: /^Allied with The Tide Choir/ }).click();
  await page.getByRole("menuitem", { name: "Change at…" }).click();
  await pick(page, "It changes at", "session 2");
  await dialog(page).getByRole("combobox", { name: "From then on" }).selectOption({ label: "Rival of" });
  await dialog(page).getByRole("button", { name: "Change it" }).click();
  await expect.poll(() => read("codex/relationships.yaml")).toMatch(new RegExp(`type: rival\\n {4}since: ${ses2}\\n`));

  // The graph, as of each session (Marta's entry, opened over the session, closed first).
  // Focus came back to her relationships, so Escape closes it.
  await expect(relationships.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Marta Hollin" })).toHaveCount(0);
  await openView(page, "Relationships");
  const slider = page.getByRole("slider", { name: "Position in the campaign" });
  await expect(slider).toHaveAttribute("aria-valuetext", "Session 1 of 2: Session 1, in The First Arc");
  await expect(edge(page, "Marta Hollin, Allied with, The Tide Choir")).toHaveCount(1);
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuetext", "Session 2 of 2: Session 2, in The First Arc");
  await expect(edge(page, "Marta Hollin, Rival of, The Tide Choir")).toHaveCount(1);
  await expect(edge(page, "Marta Hollin, Allied with, The Tide Choir")).toHaveCount(0);

  // Put on GitHub, from the sync badge, then synced: everything there.
  await badge(page).click();
  await dialog(page).getByRole("button", { name: "Put on GitHub…" }).click();
  const publish = page.getByRole("dialog", { name: "Put on GitHub" });
  await publish.getByRole("button", { name: "Create and push" }).click();
  await expect(badge(page)).toHaveAccessibleName("Sync: Synced", { timeout: 15_000 });
  const remote = app.github.repoPath("ada", "the-salt-coast");
  expect(app.git(remote, "show", "main:book.yaml")).toMatch(/^kind: campaign$/m);
  expect(app.git(remote, "show", `main:${second}`)).toContain("rang the bell herself.");
  expect(app.git(remote, "show", "main:codex/npcs/marta-hollin.md")).toContain(`id: ${marta}\n`);
  expect(app.git(remote, "show", "main:codex/relationships.yaml")).toContain(`since: ${ses2}`);
  expect(app.git(remote, "show", "main:notes/at-the-table-session-2.md")).toContain("see Marta hanged.");
});
