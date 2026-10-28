import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { axe, expect, launch, test } from "./fixtures.ts";

const dialog = (page: Page) => page.getByRole("dialog", { name: "New book" });

test("starts a novel from the shelf's + and opens it, ready to write", async ({ page, app }) => {
  await launch(page, app);
  await page.getByRole("list", { name: "Books" }).getByRole("button", { name: "New book" }).click();
  await expect(dialog(page).getByRole("textbox", { name: "Title" })).toBeFocused();
  await page.keyboard.type("The Salt Road");
  await expect(dialog(page).getByRole("textbox", { name: "Folder" })).toHaveAttribute("placeholder", "~/writer/the-salt-road");
  await dialog(page).getByRole("textbox", { name: "Author" }).fill("Ada Writer");
  await axe(page);
  await page.keyboard.press("Enter");

  await expect(page).toHaveTitle("The Salt Road · Writer");
  const text = page.getByRole("textbox", { name: "Chapter text" });
  await expect(text).toBeFocused();
  const dir = join(app.home, "writer", "the-salt-road");
  expect(app.git(dir, "log", "--format=%s").trim()).toBe("Start The Salt Road");

  // The opening scene is empty, with what to do there greyed (#99): typing goes straight in, and
  // it's the scene's only text, saved and committed.
  await expect(text.locator("p.ghw-empty-scene")).toHaveAttribute("data-placeholder", "Write the first line here…");
  await page.keyboard.type("The road ran white with salt.");
  await expect(text.locator("p.ghw-empty-scene")).toHaveCount(0);
  const scene = join(dir, "manuscript/01-chapter-one/01-opening.md");
  await expect.poll(() => readFileSync(scene, "utf8").split("---\n")[2], { timeout: 10_000 }).toBe("The road ran white with salt.\n");

  await page.getByRole("link", { name: "writer" }).click();
  await expect(page.getByRole("link", { name: "The Salt Road, by Ada Writer" })).toBeVisible();
});

test("asks who's writing when git doesn't know, for this novel only", async ({ page, app }) => {
  writeFileSync(join(app.home, ".gitconfig"), "[init]\n\tdefaultBranch = main\n");
  await launch(page, app);
  await page.getByRole("button", { name: "New book" }).first().click();
  await dialog(page).getByRole("textbox", { name: "Title" }).fill("Nobody Knows");
  await dialog(page).getByRole("button", { name: "Create" }).click();

  const who = dialog(page).getByRole("group", { name: "Who's writing?" });
  await expect(who).toBeVisible();
  await expect(dialog(page).getByRole("alert")).toHaveCount(0);
  await expect(who.getByRole("textbox", { name: "Name" })).toBeFocused();
  await page.keyboard.type("Ada Writer");
  await expect(dialog(page).getByRole("button", { name: "Create" })).toBeDisabled();
  await who.getByRole("textbox", { name: "Email" }).fill("ada@example.com");
  await axe(page);
  await dialog(page).getByRole("button", { name: "Create" }).click();

  await expect(page).toHaveTitle("Nobody Knows · Writer");
  const dir = join(app.home, "writer", "nobody-knows");
  expect(app.git(dir, "log", "--format=%an <%ae>").trim()).toBe("Ada Writer <ada@example.com>");
  expect(readFileSync(join(app.home, ".gitconfig"), "utf8")).not.toContain("Ada");
});

test("says so when the folder is taken, and from the palette too", async ({ page, app }) => {
  await launch(page, app);
  const r = await page.request.post(`${app.url}/api/library/new`, { data: { title: "Varn" }, headers: { origin: app.url } });
  expect(r.status()).toBe(201);
  await page.reload();

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("new book");
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.type("Varn");
  await page.keyboard.press("Enter");
  await expect(dialog(page).getByRole("alert")).toContainText("already exists and isn't empty");

  // Another folder works.
  await dialog(page).getByRole("textbox", { name: "Folder" }).fill("~/writer/varn-again");
  await dialog(page).getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveTitle("Varn · Writer");
  expect(app.git(join(app.home, "writer", "varn-again"), "log", "--format=%s").trim()).toBe("Start Varn");
});

test("starts a journal from the shelf's +, of the kind chosen, in its own folders and words (#37)", async ({ page, app }) => {
  await launch(page, app);
  await page.getByRole("list", { name: "Books" }).getByRole("button", { name: "New book" }).click();
  const kinds = dialog(page).getByRole("group", { name: "Kind of book" });
  await expect(kinds.getByRole("radio", { name: "Novel" })).toBeChecked();
  await kinds.getByRole("radio", { name: "Journal" }).check();
  await dialog(page).getByRole("textbox", { name: "Title" }).fill("Days");
  await expect(dialog(page).getByRole("textbox", { name: "Folder" })).toHaveAttribute("placeholder", "~/writer/days");
  await axe(page);
  await dialog(page).getByRole("button", { name: "Create" }).click();

  await expect(page).toHaveTitle("Days · Writer");
  // On its journal page (#64), today's place ready to type in: nothing written, nothing made.
  await expect(page.getByRole("heading", { level: 1, name: "Day by day" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Write today's entry" })).toBeFocused();
  const dir = join(app.home, "writer", "days");
  expect(readFileSync(join(dir, "book.yaml"), "utf8")).toMatch(/^kind: journal\n/m);
  expect(app.git(dir, "log", "--format=%s").trim()).toBe("Start Days");
});
