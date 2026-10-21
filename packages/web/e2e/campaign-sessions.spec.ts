import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { axe, expect, palette, selectionSettled, test, type App } from "./fixtures.ts";

/** A session's prep and its notes from the table (#42): a new session starts from the Campaign's template, and a note made in play is pinned to it. */

const sample = fileURLToPath(new URL("../../../examples/sample-campaign", import.meta.url));
const sidebar = (page: Page) => page.getByRole("complementary", { name: "Right sidebar" });

async function open(page: Page, app: App) {
  const dir = app.bookRepo(sample, "campaign");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Arc text" })).toBeFocused();
  // Nothing yet, for a file still to be written.
  return (path: string) => (existsSync(join(dir, path)) ? readFileSync(join(dir, path), "utf8") : "");
}

test("a new session starts with the prep, and a note from the table is pinned to it, ready to type", async ({ page, app }) => {
  const read = await open(page, app);
  const text = page.getByRole("textbox", { name: "Arc text" });

  // From the palette, after the session the caret is in.
  await text.getByText(/^In the belfry/).click();
  await selectionSettled(page);
  await palette(page, "new session");
  await page.getByRole("dialog", { name: "New session" }).getByRole("textbox", { name: "Title" }).fill("Session 3");
  await page.keyboard.press("Enter");
  const file = "sessions/01-the-drowned-bell/03-session-3.md";
  await expect.poll(() => read(file)).toMatch(/^---\nid: ses_[0-9a-z]{6}\ntitle: Session 3\nstatus: planned\n---\n## Strong start\n\n## Scenes\n\n## Secrets and clues\n\n## NPCs\n\n## Locations\n\n## Treasure\n\n## At the table\n$/);
  // It opens on its own, the prep in its text.
  const session = page.getByRole("textbox", { name: "Session text" });
  for (const heading of ["Strong start", "Secrets and clues", "At the table"]) await expect(session.getByRole("heading", { name: heading })).toBeVisible();

  // In play: one action, and the caret is in a note on the session, pinned on top of its notes.
  await session.getByRole("heading", { name: "At the table" }).click();
  await selectionSettled(page);
  await palette(page, "note from the table");
  const note = page.getByRole("textbox", { name: "Note: At the table: Session 3" });
  await expect(note).toBeFocused();
  await page.keyboard.type("Aya bargained with Voss for the clapper.");
  const notes = sidebar(page).getByRole("list", { name: "Notes on “Session 3”" });
  await expect(notes.getByRole("listitem").first().getByLabel("Pinned here")).toBeVisible();
  await expect.poll(() => read("notes/at-the-table-session-3.md")).toMatch(/scenes:\n {2}- (ses_\w{6})\npinned:\n {2}- \1\n[\s\S]*---\n\n?Aya bargained with Voss for the clapper\.\n$/);
  // The session's prep is as it was.
  expect(read(file)).toMatch(/## At the table\n$/);
  await axe(page);
});
