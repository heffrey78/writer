import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import type { Page } from "@playwright/test";
import { axe, expect, palette, test, type App } from "./fixtures.ts";

/**
 * A mood board's page (#207): boards made from the Boards page, listed under it in the sidebar, renamed
 * and deleted from the palette; a board's cards of each kind where its file puts them, moved and resized
 * by mouse a line of the file at a time, brought to the front and sent to the back, taken off and put
 * back with Undo, its picture's file with it.
 */

const sample = fileURLToPath(new URL("../../../examples/sample-campaign", import.meta.url));
const BOARD = "boards/the-belfry.yaml";
const NOTE = "note_tab1e0";

/** A real PNG of one colour. */
function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.concat(Array.from({ length: height }, () => Buffer.from([0, ...Array.from({ length: width }, () => rgb).flat()])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

const CARDS = [
  `  - { picture: images/the-belfry-at-dusk.png, description: "The Belfry at dusk, a light in its window", at: [ 36, 30 ], size: [ 480, 320 ] }`,
  `  - { note: ${NOTE}, at: [ 556, 36 ], size: [ 252, 300 ] }`,
  `  - { note: ${NOTE}, picture: images/the-bell.png, at: [ 872, 232 ], size: [ 210, 230 ] }`,
  `  - { entry: npc_ma7ra1, at: [ 48, 392 ], size: [ 196, 230 ] }`,
];
const boardText = (cards: string[]) => `# A mood board. Kept by Writer.\nid: board_be1fry\ntitle: The Belfry\ncards:\n${cards.map((c) => `${c}\n`).join("")}`;

/** The sample campaign with a board of each kind of card, its pictures, and a note showing the bell. */
async function openBoard(page: Page, app: App) {
  const dir = app.bookRepo(sample, "campaign");
  mkdirSync(join(dir, "images"), { recursive: true });
  mkdirSync(join(dir, "boards"));
  writeFileSync(join(dir, "images/the-belfry-at-dusk.png"), png(48, 32, [61, 74, 92]));
  writeFileSync(join(dir, "images/the-bell.png"), png(21, 23, [95, 125, 98]));
  const note = join(dir, "notes/at-the-table.md");
  writeFileSync(note, `${readFileSync(note, "utf8")}\n![A great green bell](/images/the-bell.png)\n`);
  writeFileSync(join(dir, BOARD), boardText(CARDS));
  app.git(dir, "add", "-A");
  app.git(dir, "commit", "-qm", "A board");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  await page.getByRole("navigation", { name: "Views" }).getByRole("list", { name: "Boards" }).getByRole("link", { name: "The Belfry" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "The Belfry" })).toBeVisible();
  return { dir, read: () => readFileSync(join(dir, BOARD), "utf8") };
}

const card = (page: Page, label: string) => page.locator(`.react-flow__node[aria-label="${label}"]`);
const SAVED = { intervals: [100, 250] };

test("a board is made from the Boards page, listed under it in the sidebar, renamed and deleted from the palette (#207)", async ({ page, app }) => {
  const dir = app.bookRepo(sample, "campaign");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  const sidebar = page.getByRole("navigation", { name: "Views" });
  await sidebar.getByRole("link", { name: "Boards", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Boards" })).toBeVisible();
  await expect(page.getByText(/No boards yet/)).toBeVisible();
  await page.getByRole("button", { name: "New board" }).click();
  const naming = page.getByRole("dialog", { name: "New board" });
  await naming.getByLabel("Title").fill("The Belfry");
  await naming.getByRole("button", { name: "Make the board" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "The Belfry" })).toBeVisible();
  await expect(page.getByText("Nothing on this board yet.")).toBeVisible();
  await expect(sidebar.getByRole("list", { name: "Boards" }).getByRole("link", { name: "The Belfry" })).toHaveAttribute("aria-current", "page");
  const file = join(dir, BOARD);
  expect(readFileSync(file, "utf8")).toMatch(/^# A mood board\. Kept by Writer\.\nid: board_[0-9a-hjkmnp-tv-z]{6}\ntitle: The Belfry\ncards: \[\]\n$/);
  expect(app.git(dir, "log", "-1", "--format=%s").trim()).toBe("Boards: add “The Belfry”");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }

  await palette(page, "rename the board");
  const renaming = page.getByRole("dialog", { name: "Rename the board" });
  await renaming.getByLabel("Title").fill("The Drowned Belfry");
  await renaming.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "The Drowned Belfry" })).toBeVisible();
  await expect(sidebar.getByRole("list", { name: "Boards" }).getByRole("link", { name: "The Drowned Belfry" })).toBeVisible();
  expect(readFileSync(file, "utf8")).toContain("\ntitle: The Drowned Belfry\n");

  await palette(page, "delete the board");
  await page.getByRole("alertdialog", { name: "Delete “The Drowned Belfry”?" }).getByRole("button", { name: "Delete the board" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Boards" })).toBeVisible();
  await expect(sidebar.getByRole("list", { name: "Boards" })).toHaveCount(0);
  expect(existsSync(file)).toBe(false);
  expect(app.git(dir, "log", "-1", "--format=%s").trim()).toBe("Boards: remove “The Drowned Belfry”");
});

test("a board's cards where its file puts them: moved and resized by mouse a line at a time, reordered, taken off and put back with Undo (#207)", async ({ page, app }) => {
  const { dir, read } = await openBoard(page, app);
  await expect(page.getByRole("region", { name: "Board: The Belfry, 4 cards" })).toBeVisible();
  const picture = card(page, "Picture: The Belfry at dusk, a light in its window");
  const note = card(page, "Note: Jo wants Aya's debt to come back");
  const bell = card(page, "Picture from the note Jo wants Aya's debt to come back: A great green bell");
  const marta = card(page, "NPC: Marta Hollin");
  for (const c of [picture, note, bell, marta]) await expect(c).toBeVisible();
  await expect(picture.getByRole("img", { name: "The Belfry at dusk, a light in its window" })).toBeVisible();
  await expect(note).toContainText("1 picture, 1 on this board");
  await expect(marta).toContainText("Marta Hollin");
  // The note's tether to its picture's card.
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }

  // Moved by mouse: its line, and only its line, changes.
  const box = (await marta.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(read, SAVED).not.toBe(boardText(CARDS));
  const moved = read().split("\n");
  expect(moved.slice(0, 7)).toEqual(boardText(CARDS).split("\n").slice(0, 7));
  expect(moved[7]).toMatch(/^ {2}- \{ entry: npc_ma7ra1, at: \[ \d+, \d+ \], size: \[ 196, 230 \] \}$/);
  expect(moved[7]).not.toBe(CARDS[3]);

  // Resized from its corner, once selected.
  await picture.click();
  const toolbar = page.getByRole("toolbar", { name: "Card" });
  await expect(toolbar).toBeVisible();
  const corner = page.locator(".react-flow__resize-control.bottom.right");
  const handle = (await corner.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x - 40, handle.y - 30, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => read().split("\n")[4], SAVED).not.toBe(CARDS[0]);
  expect(read().split("\n")[4]).toMatch(/^ {2}- \{ picture: images\/the-belfry-at-dusk\.png, description: "The Belfry at dusk, a light in its window", at: \[ 36, 30 \], size: \[ \d+, \d+ \] \}$/);

  // Brought to the front: drawn over the rest, and last in the file; then sent to the back again.
  await toolbar.getByRole("button", { name: "Bring to front" }).click();
  await expect.poll(() => read().trimEnd().split("\n").at(-1), SAVED).toMatch(/picture: images\/the-belfry-at-dusk\.png/);
  await expect(page.getByRole("toolbar", { name: "Card" }).getByRole("button", { name: "Bring to front" })).toBeDisabled();
  await page.getByRole("toolbar", { name: "Card" }).getByRole("button", { name: "Send to back" }).click();
  await expect.poll(() => read().split("\n")[4], SAVED).toMatch(/picture: images\/the-belfry-at-dusk\.png/);

  // Taken off: its line goes, and its picture with it, which nothing else shows; Undo brings both back.
  await picture.click();
  await page.getByRole("toolbar", { name: "Card" }).getByRole("button", { name: "Take off the board" }).click();
  await expect(picture).toHaveCount(0);
  await expect.poll(() => read().includes("the-belfry-at-dusk"), SAVED).toBe(false);
  await expect.poll(() => existsSync(join(dir, "images/the-belfry-at-dusk.png"))).toBe(false);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(picture).toBeVisible();
  await expect.poll(() => existsSync(join(dir, "images/the-belfry-at-dusk.png"))).toBe(true);
  expect(read().split("\n")[4]).toMatch(/picture: images\/the-belfry-at-dusk\.png/);

  // A note's picture, its note taken off: it says which note it's from, and its picture stays.
  await note.click();
  await page.getByRole("toolbar", { name: "Card" }).getByRole("button", { name: "Take off the board" }).click();
  await expect(note).toHaveCount(0);
  await expect(bell).toContainText("From “Jo wants Aya's debt to come back”");
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  expect(existsSync(join(dir, "images/the-bell.png"))).toBe(true);

  // Kept after a reload.
  const kept = read();
  await page.reload();
  await expect(page.getByRole("region", { name: "Board: The Belfry, 3 cards" })).toBeVisible();
  await expect(bell).toContainText("From “Jo wants Aya's debt to come back”");
  expect(read()).toBe(kept);

  // Fit all, and zoom by the buttons.
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByLabel(/^Zoom \d+%$/)).not.toHaveAccessibleName("Zoom 100%");
  await page.getByRole("button", { name: "Fit all" }).click();
  for (const c of [picture, bell, marta]) await expect(c).toBeInViewport();
});

test("a journal has boards too, in Look back, its cards in the journal's words", async ({ page, app }) => {
  const dir = app.bookRepo(fileURLToPath(new URL("../../../examples/sample-journal", import.meta.url)), "journal");
  mkdirSync(join(dir, "boards"));
  writeFileSync(join(dir, "boards/the-sluice.yaml"), `id: board_s1uice\ntitle: The sluice\ncards:\n  - { note: note_h1de99, at: [ 0, 0 ], size: [ 252, 300 ] }\n  - { entry: per_m1ra00, at: [ 300, 0 ], size: [ 196, 230 ] }\n`);
  app.git(dir, "add", "-A");
  app.git(dir, "commit", "-qm", "A board");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  const lookBack = page.getByRole("navigation", { name: "Views" }).getByRole("group", { name: "Look back" });
  await lookBack.getByRole("list", { name: "Boards" }).getByRole("link", { name: "The sluice" }).click();
  await expect(page.getByRole("region", { name: "Board: The sluice, 2 cards" })).toBeVisible();
  await expect(card(page, "Note: Ask about a hide at the sluice")).toBeVisible();
  await expect(card(page, "Person: Mira Hale")).toContainText("Mira Hale");
  await expect(page.locator("main")).not.toContainText(/\b(scenes?|chapters?|manuscript|story bible|novel|codex)\b/i);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }
});

/** The sample campaign with a note of three pictures and an empty board, for putting things on it (#208). */
async function forAdding(page: Page, app: App) {
  const dir = app.bookRepo(sample, "campaign");
  mkdirSync(join(dir, "images"), { recursive: true });
  mkdirSync(join(dir, "boards"));
  writeFileSync(join(dir, "images/causeway.png"), png(48, 27, [201, 214, 220]));
  writeFileSync(join(dir, "images/saltmere.png"), png(33, 20, [235, 225, 203]));
  writeFileSync(join(dir, "images/the-bell.png"), png(21, 23, [95, 125, 98]));
  writeFileSync(
    join(dir, "notes/the-belfry-at-low-tide.md"),
    "---\nid: note_be1f7y\ntitle: The Belfry at low tide\ncreated: 2026-11-20T10:00:00\n---\nWhen the party reaches the causeway, the tide is out.\n\n![The Belfry from the causeway](/images/causeway.png)\n\n![Saltmere to the Belfry](/images/saltmere.png)\n\n![The bell, if they climb](/images/the-bell.png)\n",
  );
  writeFileSync(join(dir, BOARD), boardText([]).replace("cards:\n", "cards: []\n"));
  app.git(dir, "add", "-A");
  app.git(dir, "commit", "-qm", "A note and a board");
  await app.restart(dir);
  await page.goto(app.launchUrl);
  const book = `${app.url}${new URL(app.launchUrl).pathname.replace(/^(\/novels\/[^/]+).*$/, "$1")}`;
  return { dir, book, read: () => readFileSync(join(dir, BOARD), "utf8") };
}

const openTheBelfry = async (page: Page) => {
  await page.getByRole("navigation", { name: "Views" }).getByRole("list", { name: "Boards" }).getByRole("link", { name: "The Belfry" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "The Belfry" })).toBeVisible();
};

const pick = async (page: Page, dialog: ReturnType<Page["getByRole"]>, label: string, name: string) => {
  await dialog.getByRole("button", { name: new RegExp(`^${label}`) }).click();
  await page.getByRole("dialog", { name: label }).getByRole("combobox").fill(name);
  await page.getByRole("option", { name }).click();
};

test("from the board: a picture added and described, a note and two of its three pictures tethered to it, and an entry (#208)", async ({ page, app }) => {
  const { read } = await forAdding(page, app);
  await openTheBelfry(page);
  await expect(page.getByText(/Nothing on this board yet/)).toBeVisible();

  await page.getByRole("button", { name: "Add a picture" }).click();
  const adding = page.getByRole("dialog", { name: "Add a picture to the board" });
  await adding.getByLabel("Picture file").setInputFiles({ name: "harbour.png", mimeType: "image/png", buffer: png(40, 30, [61, 74, 92]) });
  await adding.getByLabel("Description").fill("The harbour at night");
  await expect(adding.getByLabel(/Caption/)).toHaveCount(0);
  await adding.getByRole("button", { name: "Add", exact: true }).click();
  await expect(card(page, "Picture: The harbour at night")).toBeVisible();
  await expect.poll(read, SAVED).toMatch(/\n {2}- \{ picture: images\/the-harbour-at-night\.jpg, description: "?The harbour at night"?, at: \[ -?\d+, -?\d+ \], size: \[ 280, 210 \] \}\n$/);

  await page.getByRole("button", { name: "Add a note" }).click();
  const note = page.getByRole("dialog", { name: "Add a note" });
  await pick(page, note, "Note", "The Belfry at low tide");
  // The first picture is on the note's card: the other two are cards of their own unless unticked.
  await expect(note.getByRole("checkbox", { name: "The note, as a card" })).toBeChecked();
  await expect(note.getByRole("checkbox", { name: /The Belfry from the causeway/ })).not.toBeChecked();
  await expect(note.getByRole("checkbox", { name: "Saltmere to the Belfry" })).toBeChecked();
  await expect(note.getByRole("checkbox", { name: "The bell, if they climb" })).toBeChecked();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page);
  }
  await note.getByRole("button", { name: "Put 3 cards on the board" }).click();
  await expect(note).toHaveCount(0);
  await expect(card(page, "Note: The Belfry at low tide")).toBeVisible();
  await expect(card(page, "Picture from the note The Belfry at low tide: Saltmere to the Belfry")).toBeVisible();
  await expect(card(page, "Picture from the note The Belfry at low tide: The bell, if they climb")).toBeVisible();
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await expect.poll(read, SAVED).toContain("  - { note: note_be1f7y, at:");
  expect(read()).toContain("  - { note: note_be1f7y, picture: images/saltmere.png, at:");
  expect(read()).toContain("  - { note: note_be1f7y, picture: images/the-bell.png, at:");

  await page.getByRole("button", { name: "Add from the codex" }).click();
  const entry = page.getByRole("dialog", { name: "Add from the codex" });
  await pick(page, entry, "Entry", "Marta Hollin");
  await entry.getByRole("button", { name: "Put 1 card on the board" }).click();
  await expect(card(page, "NPC: Marta Hollin")).toBeVisible();
  await expect(page.getByRole("region", { name: "Board: The Belfry, 5 cards" })).toBeVisible();
  await expect.poll(read, SAVED).toMatch(/\n {2}- \{ entry: npc_ma7ra1, at: \[ -?\d+, -?\d+ \], size: \[ 196, 230 \] \}\n$/);
});

test("Put on a board… from a note's page, and from an entry's by the palette onto a new board (#208)", async ({ page, app }) => {
  const { dir, book, read } = await forAdding(page, app);
  await page.goto(`${book}/note/note_be1f7y`);
  await page.getByRole("button", { name: "Put on a board…" }).click();
  const dialog = page.getByRole("dialog", { name: "Put “The Belfry at low tide” on a board" });
  await expect(dialog.getByRole("combobox", { name: "Board" })).toHaveValue("board_be1fry");
  await dialog.getByRole("checkbox", { name: "The bell, if they climb" }).uncheck();
  await dialog.getByRole("button", { name: "Put 2 cards on the board" }).click();
  const notice = page.getByRole("status").filter({ hasText: "2 cards put on “The Belfry”." });
  await expect(notice).toBeVisible();
  expect(read().match(/note_be1f7y/g)).toHaveLength(2);
  await notice.getByRole("button", { name: "Open the board" }).click();
  await expect(page.getByRole("region", { name: "Board: The Belfry, 2 cards" })).toBeVisible();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  await page.goto(`${book}/bible/npc_ma7ra1/page`);
  await expect(page.getByRole("button", { name: "Put on a board…" })).toBeVisible();
  await palette(page, "put on a board");
  const entry = page.getByRole("dialog", { name: "Put “Marta Hollin” on a board" });
  await entry.getByRole("combobox", { name: "Board" }).selectOption({ label: "New board…" });
  await entry.getByLabel("The new board's title").fill("Saltmere");
  await entry.getByRole("button", { name: "Put 1 card on the board" }).click();
  await expect(page.getByRole("status").filter({ hasText: "1 card put on “Saltmere”." })).toBeVisible();
  await expect.poll(() => existsSync(join(dir, "boards/saltmere.yaml"))).toBe(true);
  await expect.poll(() => readFileSync(join(dir, "boards/saltmere.yaml"), "utf8"), SAVED).toMatch(/\ntitle: Saltmere\ncards:\n {2}- \{ entry: npc_ma7ra1, at: \[ 0, 0 \], size: \[ 196, 230 \] \}\n$/);
});

test("a picture dragged out of a note is a card of that note's picture; a file dropped is described and saved (#208)", async ({ page, app }) => {
  const { book, read } = await forAdding(page, app);
  await openTheBelfry(page);
  const bellUrl = `/api/novels/${new URL(book).pathname.split("/")[2]}/images/the-bell.png`;
  const drop = (data: { uri?: string; file?: boolean }) =>
    page.evaluate(async ({ uri, file }) => {
      const board = document.querySelector("[data-board]")!;
      const box = board.getBoundingClientRect();
      const dt = new DataTransfer();
      if (uri) dt.setData("text/uri-list", uri);
      if (file) {
        const canvas = Object.assign(document.createElement("canvas"), { width: 30, height: 20 });
        canvas.getContext("2d")!.fillRect(0, 0, 30, 20);
        const blob = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), "image/png"));
        dt.items.add(new File([blob], "dropped.png", { type: "image/png" }));
      }
      const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, dataTransfer: dt, bubbles: true, cancelable: true };
      board.dispatchEvent(new DragEvent("dragover", at));
      board.dispatchEvent(new DragEvent("drop", at));
    }, data);

  await drop({ uri: bellUrl });
  await expect(card(page, "Picture from the note The Belfry at low tide: The bell, if they climb")).toBeVisible();
  await expect.poll(read, SAVED).toMatch(/\n {2}- \{ note: note_be1f7y, picture: images\/the-bell\.png, at: \[ -?\d+, -?\d+ \], size: \[ 256, 280 \] \}\n$/);

  await drop({ file: true });
  const adding = page.getByRole("dialog", { name: "Add a picture to the board" });
  await expect(adding.getByText("dropped.png")).toBeVisible();
  await adding.getByLabel("Description").fill("A dark square");
  await adding.getByRole("button", { name: "Add", exact: true }).click();
  await expect(card(page, "Picture: A dark square")).toBeVisible();
  await expect.poll(read, SAVED).toContain("picture: images/a-dark-square.jpg");
});
