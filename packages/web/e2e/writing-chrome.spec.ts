import { axe, caretAtEnd, expect, test } from "./fixtures.ts";

/** What surrounds the text, kept quiet: the counts where they belong, the card's buttons until pointed at. */

test("the length of what's open by its title, a scene's on its card, the session's and today's in the bar under the text", async ({ page, app }) => {
  await app.restart(app.novelRepo("varn"));
  await page.goto(app.launchUrl);
  const text = page.getByRole("textbox", { name: "Chapter text" });
  await expect(text).toBeFocused();

  const header = page.getByRole("group", { name: "Word count" });
  await expect(header).toHaveText("Words 231");
  const card = page.getByRole("region", { name: "Details of “The Station”" });
  await expect(card).toContainText("Arrival · scene 1 of 2 · 113 words");
  const bar = page.getByRole("group", { name: "This session" });
  await expect(bar).toContainText("Session 0");
  await expect(page.getByRole("link", { name: /^Today: / })).toBeVisible();

  // Written at the end of the chapter (its last scene, on the card now), the counts follow.
  await caretAtEnd(page, text);
  await page.keyboard.type(" Four more words here.");
  await expect(bar).toContainText("Session +4");
  const span = page.getByRole("region", { name: "Details of “Walking the Span”" });
  await expect(span).toContainText("scene 2 of 2 · 122 words");
  await expect(header).toHaveText("Words 235");

  // The card's pencils and pins: out of the way until their row is pointed at.
  const pencil = span.getByRole("button", { name: "Edit where" });
  await expect(pencil).toHaveCSS("opacity", "0");
  await span.getByText("Where", { exact: true }).hover();
  await expect(pencil).toHaveCSS("opacity", "1");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }
});

test("Compile… is in the ⋯ menu and the palette, except with the engine in the page, which can't compile", async ({ page, app, serveArgs }) => {
  await app.restart(app.novelRepo("varn"));
  await page.goto(app.launchUrl);
  await expect(page.getByRole("textbox", { name: "Chapter text" })).toBeFocused();
  const offered = serveArgs.includes("--engine-in-page") ? 0 : 1;

  await page.getByRole("banner").getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menuitem", { name: "Checkpoints…" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Compile…" })).toHaveCount(offered);
  await page.keyboard.press("Escape");

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("compile");
  await expect(palette.getByRole("option", { name: /^Compile the manuscript/ })).toHaveCount(offered);
});

test("the count by a title is of what's open, and says Words: a chapter's, or a scene's alone", async ({ page, app }) => {
  await app.restart(app.novelRepo("varn"));
  await page.goto(app.launchUrl);
  const header = page.getByRole("group", { name: "Word count" });
  await expect(header).toHaveText("Words 231");
  await page.getByRole("tree").getByRole("treeitem", { name: /The Station/ }).click();
  await expect(page.getByRole("textbox", { name: "Scene text" })).toBeVisible();
  await expect(header).toHaveText("Words 113");
});
