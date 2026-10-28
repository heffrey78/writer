import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { _android, expect as baseExpect, type AndroidDevice, type Page } from "@playwright/test";
import { fakeGitHub } from "../server/test/fake-github.ts";

/**
 * Writer on Android, end to end (#52): the app on a device or the emulator, its webview driven by
 * Playwright, against a fake GitHub on this computer that the device
 * reaches through `adb reverse`. It signs in with a code, starts a journal and writes in it,
 * dictates into it (#86: Writer's own speech model on the device, hearing a recording in place of
 * the microphone), puts it on GitHub and syncs; clones a novel, takes a change made elsewhere by
 * syncing, and checks the files on the device and on GitHub.
 *
 * `node packages/mobile/e2e.ts [APK]`, with one device attached, or the one ANDROID_SERIAL names
 * (ADB names adb, if not on PATH). The
 * APK is installed and the app's data cleared first. The speech model comes from
 * packages/dictation/models (its fetch-models.sh), pushed once and copied into the app each run.
 */

const PACKAGE = "io.github.heffrey78.writer";
const ADB = process.env.ADB ?? "adb";
const repo = fileURLToPath(new URL("../../", import.meta.url));
const adb = (...args: string[]) => execFileSync(ADB, args, { encoding: "utf8" });
/** A shell command in the app's own folder on the device. */
const inApp = (command: string, input?: string) => execFileSync(ADB, ["shell", `run-as ${PACKAGE} sh -c '${command}'`], { encoding: "utf8", ...(input !== undefined ? { input } : {}) });
// A phone, or the emulator, is slower than this computer.
const expect = baseExpect.configure({ timeout: 20_000 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** What Android shows now, outside the webview too: each node's text, description, class and bounds. */
function androidUi() {
  const ui = execFileSync(ADB, ["exec-out", "uiautomator", "dump", "/dev/tty"], { encoding: "utf8" });
  return [...ui.matchAll(/<node [^>]*>/g)].map(([n]) => {
    const [x1, y1, x2, y2] = (/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(n) ?? []).slice(1).map(Number) as [number, number, number, number];
    const attr = (name: string) => new RegExp(` ${name}="([^"]*)"`).exec(n)?.[1] ?? "";
    return { text: attr("text"), desc: attr("content-desc"), cls: attr("class"), x1, y1, x2, y2 };
  });
}

/** Whether Writer's window keeps the screen on (with Playwright let go of the webview: its connection keeps it on too). */
function screenOn() {
  const windows = execFileSync(ADB, ["shell", "dumpsys", "window", "windows"], { encoding: "utf8" }).split(/\n(?=  Window #)/);
  return windows.some((w) => w.includes(`${PACKAGE}/`) && /\bKEEP_SCREEN_ON\b/.test(w));
}

const tapAt = (n: { x1: number; y1: number; x2: number; y2: number }) => adb("shell", "input", "tap", String((n.x1 + n.x2) >> 1), String((n.y1 + n.y2) >> 1));

/** Tap what Android shows with text matching `text` (its own dialogs, outside the webview), once it's there. */
async function tapAndroid(text: RegExp) {
  for (let i = 0; i < 40; i++, await sleep(500)) {
    const node = androidUi().find((n) => text.test(n.text));
    if (node) return void tapAt(node);
  }
  throw new Error(`Android showed nothing matching ${text}.`);
}

/** Long-press the first `word` in `page`'s element `selector`, at its place on the screen. */
async function longPress(page: Page, selector: string, word: string) {
  // Measured once it holds still: the page scrolls as the keyboard comes up.
  let at = await where(page, selector, word);
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    const now = await where(page, selector, word);
    const still = now.x === at.x && now.y === at.y;
    at = now;
    if (still) break;
  }
  const view = androidUi().find((n) => n.cls === "android.webkit.WebView")!;
  const x = Math.round(view.x1 + at.x * at.dpr);
  const y = Math.round(view.y1 + at.y * at.dpr);
  adb("shell", "input", "swipe", String(x), String(y), String(x), String(y), "900");
}

/** Where the first `word` in `selector` is in the page, and the page's pixel ratio. */
function where(page: Page, selector: string, word: string) {
  return page.evaluate(
    ([selector, word]) => {
      const el = document.querySelector(selector)!;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const i = t.textContent!.indexOf(word);
        if (i < 0) continue;
        const range = document.createRange();
        range.setStart(t, i);
        range.setEnd(t, i + word.length);
        const r = range.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, dpr: devicePixelRatio };
      }
      throw new Error(`No “${word}” in ${selector}`);
    },
    [selector, word] as const,
  );
}

const tmp = mkdtempSync(join(tmpdir(), "writer-mobile-"));
const fake = await fakeGitHub({ gitRoot: join(tmp, "github") });
const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=Ada Writer", "-c", "user.email=ada@example.com", ...args], { encoding: "utf8" });

// The sample novel on GitHub, as ada/varn, to clone.
mkdirSync(join(tmp, "github/ada"), { recursive: true });
const varn = fake.repoPath("ada", "varn");
execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch=main", varn]);
const seed = join(tmp, "varn");
execFileSync("cp", ["-r", join(repo, "examples/sample-novel"), seed]);
git(seed, "init", "-q", "-b", "main");
git(seed, "add", "-A");
git(seed, "commit", "-q", "-m", "The Bridge at Varn");
git(seed, "push", "-q", varn, "main");
fake.repos.push({ owner: "ada", name: "varn", private: true, pushedAt: new Date().toISOString() });

// What dictation hears in place of the microphone: the first sentence of the speech crate's clip,
// "Then dear, said Missus Whitney, you must be kinder to her than ever…", and a moment's quiet.
const wav = readFileSync(join(repo, "packages/dictation/tests/clips/librispeech.wav"));
const data = wav.indexOf("data") + 8;
const sentence = join(tmp, "dictated.wav");
const pcm = wav.subarray(data, data + 2 * 16_000 * 11);
const header = Buffer.from(wav.subarray(0, data));
header.writeUInt32LE(header.length - 8 + pcm.length, 4);
header.writeUInt32LE(pcm.length, data - 4);
writeFileSync(sentence, Buffer.concat([header, pcm]));
const MODELS = "/data/local/tmp/writer-dictation";

const port = new URL(fake.url).port;
const steps: [string, number][] = [];
let started = Date.now();
const step = (name: string) => {
  steps.push([name, Date.now() - started]);
  console.log(`ok   ${name} (${Date.now() - started} ms)`);
  started = Date.now();
};

let android: AndroidDevice | undefined;
/** The device, as Playwright's driver sees it. */
const attach = async () => (await _android.devices()).find((d) => !process.env.ANDROID_SERIAL || d.serial() === process.env.ANDROID_SERIAL);
try {
  const device = adb("devices").split("\n").slice(1).find((l) => /\tdevice$/.test(l) && (!process.env.ANDROID_SERIAL || l.startsWith(`${process.env.ANDROID_SERIAL}\t`)));
  if (!device) throw new Error("No Android device: start the emulator, or connect a phone with USB debugging on.");
  // The same port on both sides: the fake's own URLs (a new repository's clone URL) work on the device.
  adb("reverse", `tcp:${port}`, `tcp:${port}`);
  const apk = process.argv[2];
  if (apk) adb("install", "-r", apk);
  adb("shell", "am", "force-stop", PACKAGE);
  adb("shell", "pm", "clear", PACKAGE);
  inApp("cat > env.json", JSON.stringify({ WRITER_GITHUB_URL: fake.url, WRITER_GITHUB_API_URL: fake.url, WRITER_GITHUB_CLIENT_ID: fake.clientId, WRITER_DICTATION_CLIP: "dictated.wav" }));
  // The speech model, as its download leaves it (pushed once: 208 MB), and the recording.
  if (adb("shell", `test -f ${MODELS}/models/parakeet/encoder.int8.onnx && echo there || true`).trim() !== "there") {
    adb("shell", "mkdir", "-p", `${MODELS}/models`);
    for (const part of ["parakeet", "zipformer", "silero_vad.onnx"]) adb("push", "-q", join(repo, "packages/dictation/models", part), `${MODELS}/models/`);
  }
  adb("push", "-q", sentence, `${MODELS}/dictated.wav`);
  inApp(`cp -r ${MODELS}/models ${MODELS}/dictated.wav .`);
  adb("shell", "pm", "revoke", PACKAGE, "android.permission.RECORD_AUDIO");
  adb("shell", "monkey", "-p", PACKAGE, "-c", "android.intent.category.LAUNCHER", "1");

  // The app's webview, through Playwright's own adb driver (its CDP connection wants a browser's
  // contexts, which a webview hasn't).
  android = await attach();
  if (!android) throw new Error("Playwright sees no Android device.");
  let page: Page = await (await android.webView({ pkg: PACKAGE }, { timeout: 30_000 })).page();

  await expect(page.getByRole("heading", { level: 1, name: "Your books" })).toBeVisible();
  await expect(page.getByText("No books yet. Start one, or clone one from GitHub.")).toBeVisible();
  // No folders of the writer's to open on a phone.
  await expect(page.getByRole("button", { name: "Open a folder" })).toHaveCount(0);
  step("the shelf, from the engine in the page");

  // Signed in with a code; the name and email git signs with, as GitHub suggests them.
  await page.getByRole("banner").getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: /Connect GitHub/ }).click();
  const connect = page.getByRole("dialog", { name: "Connect to GitHub" });
  await connect.getByRole("button", { name: "Sign in with a code" }).click();
  await expect(connect.getByLabel("Your code")).toHaveText(fake.userCode);
  // GitHub's page opens outside the app (the phone's browser): the app stays where it was, waiting.
  // Clicked from the page: Playwright's own click would wait for a navigation here that never comes.
  await connect.getByRole("link", { name: /login\/device/ }).evaluate((a: HTMLElement) => a.click());
  const top = () => /topResumedActivity=\S+ \S+ (\S+)\//.exec(adb("shell", "dumpsys", "activity", "activities"))?.[1];
  for (let i = 0; i < 40 && top() === PACKAGE; i++) await sleep(250);
  if (top() === PACKAGE) throw new Error("Nothing opened GitHub's page outside the app.");
  adb("shell", "monkey", "-p", PACKAGE, "-c", "android.intent.category.LAUNCHER", "1");
  for (let i = 0; i < 40 && top() !== PACKAGE; i++) await sleep(250);
  if (!page.url().startsWith("http://tauri.localhost/")) throw new Error(`GitHub's page opened in the app: ${page.url()}`);
  // Connected afresh: after the link's cancelled navigation, Playwright's Android driver finds nothing
  // with the old connection's locators, though the page shows it all.
  await android.close();
  android = await attach();
  page = await (await android!.webView({ pkg: PACKAGE }, { timeout: 30_000 })).page();
  const waiting = page.getByRole("dialog", { name: "Connect to GitHub" });
  await expect(waiting.getByLabel("Your code")).toHaveText(fake.userCode);
  fake.approve();
  await expect(waiting).toHaveCount(0);
  const identity = page.getByRole("dialog", { name: "Your name and email" });
  await expect(identity.getByLabel("Name")).toHaveValue("Ada Writer");
  await identity.getByRole("button", { name: "Save" }).click();
  await expect(identity).toHaveCount(0);
  if (!/name = Ada Writer/.test(inApp("cat .gitconfig"))) throw new Error("The name and email weren't kept in the app's git configuration.");
  const token = inApp("cat secrets/github | base64");
  if (!token.trim() || Buffer.from(token, "base64").includes(fake.deviceToken)) throw new Error("The token isn't kept sealed.");
  step("signed in with a code, GitHub's page opened outside the app; the token sealed by the keystore; the name git signs with kept");

  // A journal, and today's entry written in. The page's height first, before a field brings the keyboard up.
  const tall = await page.evaluate(() => innerHeight);
  await page.getByRole("list", { name: "Books" }).getByRole("button", { name: "New book" }).click();
  const making = page.getByRole("dialog", { name: "New book" });
  await making.getByRole("radio", { name: "Journal" }).check();
  await making.getByRole("textbox", { name: "Title" }).fill("Days");
  await making.getByRole("button", { name: "Create" }).click();
  // A journal opens on its journal page (#64), today's place at the top.
  await expect(page.getByRole("heading", { level: 1, name: "Day by day" })).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "Command palette" }).getByRole("combobox").fill("today's entry");
  await page.keyboard.press("Enter");
  const text = page.getByRole("textbox", { name: "Write today's entry" });
  await expect(text).toBeFocused();
  // The keyboard's voice typing (#85), as Gboard sends it: each phrase one composition, rewritten
  // whole as more is heard (an earlier word corrected on the way), committed at a sentence's end;
  // then the last word heard again, composed over where it was. The first words make today's entry,
  // mid-composition. Replayed with the device's keyboards switched off: a keyboard ends a
  // composition it didn't start, as its own voice typing's never are.
  const keyboard = adb("shell", "settings", "get", "secure", "default_input_method").trim();
  const keyboards = adb("shell", "ime", "list", "-s").trim().split(/\s+/);
  for (const k of keyboards) adb("shell", "ime", "disable", k);
  try {
    const ime = await page.context().newCDPSession(page);
    const compose = async (text: string) => {
      await ime.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
      await sleep(150);
    };
    const commit = (text: string) => ime.send("Input.insertText", { text });
    for (const heard of ["Spoken ", "Spoken to ", "Spoken to a ", "Spoken to the keyboard ", "Spoken to the keyboard every ", "Spoken to the keyboard, every word "]) await compose(heard);
    // A pause longer than the editor's (300 ms): what's composed so far is reported mid-phrase.
    await sleep(600);
    await compose("Spoken to the keyboard, every word.");
    await commit("Spoken to the keyboard, every word.");
    for (const heard of [" Kept ", " Kept as ", " Kept as sad"]) await compose(heard);
    await commit(" Kept as sad");
    await text.evaluate((el) => {
      const words = [...el.querySelectorAll("p")].at(-1)!.lastChild!;
      const at = words.textContent!.lastIndexOf("sad");
      getSelection()!.setBaseAndExtent(words, at, words, at + 3);
    });
    await compose("said");
    await commit("said.");
    await ime.detach();
  } finally {
    for (const k of keyboards) adb("shell", "ime", "enable", k);
    adb("shell", "ime", "set", keyboard);
  }
  await expect(text).toHaveText("Spoken to the keyboard, every word. Kept as said.");
  const spoken = () => inApp("grep -rh \"Spoken to\" books/days/entries/*/*/*.md || true").trim();
  await expect.poll(spoken).toBe("Spoken to the keyboard, every word. Kept as said.");
  step("voice typing from the keyboard: today's entry made from the first words, every word kept");

  // A tap on today's place, as a person would: the page has put the caret there already, and a click
  // here raises the keyboard only if it moves the focus.
  await text.evaluate((el) => el.blur());
  await text.click();
  // Typing once Android has the keyboard up.
  await expect.poll(() => /mInputShown=true/.test(adb("shell", "dumpsys", "input_method")), { timeout: 10_000 }).toBe(true);
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Written on the phone.");
  let entry = "";
  for (let i = 0; i < 40 && !entry; i++, await sleep(250)) entry = inApp("grep -rl \"Written on the phone.\" books/days/entries/*/*/*.md || true").trim();
  if (!entry) throw new Error("The entry wasn't saved in the app's storage.");
  // The keyboard takes room from the page rather than covering it.
  await expect.poll(() => page.evaluate(() => innerHeight)).toBeLessThan(tall);
  step("a journal started, and today's entry saved on the device");

  // Dictated (#86): Writer says why it wants the microphone, Android asks, and the sentence is heard
  // by the speech model on the device and written into the entry.
  await page.keyboard.press("Control+End");
  await page.getByRole("button", { name: "Dictate", exact: true }).click();
  const why = page.getByRole("status").filter({ hasText: "Writer hears you through the phone's microphone." });
  await expect(why).toContainText("What you say is heard on this phone and never leaves it, and nothing is recorded.");
  await why.getByRole("button", { name: "Allow the microphone" }).click();
  await tapAndroid(/^While using the app$/i);
  const dictating = page.getByRole("group", { name: "Dictation" });
  await expect(dictating).toContainText("Listening…", { timeout: 30_000 });
  await expect(page.locator(".ghw-heard")).toBeVisible({ timeout: 30_000 });
  await expect(text).toContainText(/kinder to her than ever/i, { timeout: 60_000 });
  await dictating.getByRole("button", { name: "Stop dictating" }).click();
  await expect(dictating).toHaveCount(0);
  let dictated = "";
  for (let i = 0; i < 40 && !dictated; i++, await sleep(250)) dictated = inApp("grep -rli \"kinder to her than ever\" books/days/entries/*/*/*.md || true").trim();
  if (!dictated) throw new Error("The dictated words weren't saved.");
  console.log(`     heard: ${inApp(`cat ${dictated}`).split("Written on the phone.")[1]?.trim()}`);
  step("dictated: the microphone allowed when asked, the words heard on the device and saved");

  // To the background mid-phrase: the words heard so far are written and saved at once, and it
  // stops; the phrase the speech model settles as it stops takes their place, with its capitals and
  // punctuation (#97), not the greyed words' lower case.
  const said = () => Number(inApp(`grep -oi "dear" ${dictated} | wc -l`).trim());
  // Settled, it's punctuated ("…dear, said Mrs Whitney"); the greyed words never are.
  const settled = () => Number(inApp(`grep -o "dear, said" ${dictated} | wc -l`).trim());
  await page.getByRole("button", { name: "Dictate", exact: true }).click();
  await expect(dictating).toContainText("Listening…", { timeout: 30_000 });
  await expect(page.locator(".ghw-heard")).toContainText(/dear/i, { timeout: 30_000 });
  // The screen kept on while listening (#97): set down, the phone would time out, and that stops
  // it. Read with Playwright let go of the webview, whose connection keeps the screen on too.
  await android!.close();
  if (!screenOn()) throw new Error("The screen isn't kept on while listening.");
  adb("shell", "input", "keyevent", "KEYCODE_HOME");
  await expect.poll(said, { timeout: 20_000 }).toBe(2);
  adb("shell", "monkey", "-p", PACKAGE, "-c", "android.intent.category.LAUNCHER", "1");
  for (let i = 0; i < 40 && top() !== PACKAGE; i++) await sleep(250);
  if (screenOn()) throw new Error("The screen is still kept on once listening stopped.");
  android = await attach();
  page = await (await android!.webView({ pkg: PACKAGE }, { timeout: 30_000 })).page();
  await expect(page.getByRole("group", { name: "Dictation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dictate", exact: true })).toBeVisible();
  await expect.poll(settled, { timeout: 20_000, message: "the settled phrase in place of the greyed words" }).toBe(2);
  if (/dear said/.test(inApp(`cat ${dictated}`))) throw new Error("The greyed words are still in the entry.");
  console.log(`     after the background: ${inApp(`cat ${dictated}`).split("Think what it would").at(-1)?.trim().slice(0, 60)}`);
  step("to the background mid-phrase: the screen kept on till then; what was heard saved, settled in place, and listening stopped");

  // Put on GitHub, then synced.
  const badge = page.getByRole("button", { name: /^Sync: / });
  await badge.click();
  await page.getByRole("dialog").getByRole("button", { name: "Put on GitHub…" }).click();
  await page.getByRole("dialog", { name: "Put on GitHub" }).getByRole("button", { name: "Create and push" }).click();
  await expect(badge).toHaveAccessibleName("Sync: Synced", { timeout: 30_000 });
  const days = fake.repoPath("ada", "days");
  const pushed = execFileSync("git", ["--git-dir", days, "grep", "-l", "Written on the phone.", "main"], { encoding: "utf8" });
  if (!pushed.trim()) throw new Error("The entry isn't on GitHub.");
  const author = execFileSync("git", ["--git-dir", days, "log", "-1", "--format=%an <%ae>", "main"], { encoding: "utf8" }).trim();
  if (author !== "Ada Writer <4242+ada@users.noreply.127.0.0.1>") throw new Error(`The commits are by ${author}.`);
  step("put on GitHub: the entry there");

  // A word selected by long-press: Android's own toolbar, with Writer's Raise an issue… in it (#95),
  // and the keyboard still up.
  await (await page.getByRole("textbox", { name: /Write today's entry|Entry text/ }).first()).click();
  await expect.poll(() => /mInputShown=true/.test(adb("shell", "dumpsys", "input_method")), { timeout: 10_000, message: "the keyboard up" }).toBe(true);
  await longPress(page, ".ghw-prose", "phone");
  await expect.poll(() => page.evaluate(() => getSelection()?.toString()), { timeout: 10_000, message: "the word selected" }).toBe("phone");
  // Android's toolbar is a window of its own: Playwright's driver sees it, uiautomator's dump doesn't.
  await android!.wait({ text: "Copy" }, { timeout: 10_000 });
  // No menu of Writer's own over it.
  await expect(page.getByRole("menu", { name: "Selected text" })).toHaveCount(0);
  if (!/mInputShown=true/.test(adb("shell", "dumpsys", "input_method"))) throw new Error("The keyboard went away as the word was selected.");
  // Writer's item after Android's, under More options when the toolbar is full.
  const raise = { text: "Raise an issue…" };
  if (!(await android!.wait(raise, { timeout: 2_000 }).then(() => true, () => false))) await android!.tap({ desc: "More options" });
  await android!.tap(raise);
  const raising = page.getByRole("complementary", { name: "Raise an issue" });
  await expect(raising).toBeVisible();
  await raising.getByRole("button", { name: "Back to the text" }).click();
  step("a word selected by long-press: Android's toolbar, Raise an issue… in it, the keyboard kept");

  // Writing: the bar on top of the keyboard (#96); its Commands opens the palette, the keyboard kept.
  await (await page.getByRole("textbox", { name: /Write today's entry|Entry text/ }).first()).click();
  const bar = page.getByRole("toolbar", { name: "Writing" });
  await expect(bar).toBeVisible();
  writeFileSync(join(tmp, "..", "writing-bar.png"), execFileSync(ADB, ["exec-out", "screencap", "-p"]));
  await bar.getByRole("button", { name: "Commands" }).click();
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  if (!/mInputShown=true/.test(adb("shell", "dumpsys", "input_method"))) throw new Error("The keyboard went away as the palette opened.");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);
  step("writing: the bar on top of the keyboard, Commands from it with the keyboard kept");


  // A novel cloned from GitHub, opened; a change made elsewhere, taken by a sync.
  await page.goto("http://tauri.localhost/");
  await page.getByRole("button", { name: "Clone from GitHub" }).click();
  const clone = page.getByRole("dialog", { name: "Clone from GitHub" });
  // Picked from the account's repositories: their clone URLs are the fake's ("ada/varn" typed is github.com's).
  await clone.getByRole("button", { name: /^ada\/varn/ }).click();
  await clone.getByRole("button", { name: "Clone", exact: true }).click();
  await expect(page).toHaveTitle("The Bridge at Varn · Writer", { timeout: 60_000 });
  step("a novel cloned from GitHub and opened");

  git(seed, "pull", "-q", varn, "main");
  execFileSync("sh", ["-c", `printf '\\nA line from the desktop.\\n' >> ${JSON.stringify(join(seed, "README.md"))}`]);
  git(seed, "commit", "-q", "-am", "From the desktop");
  git(seed, "push", "-q", varn, "main");
  await page.getByRole("button", { name: /^Sync: / }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sync now" }).click();
  let taken = "";
  for (let i = 0; i < 80 && !taken; i++, await sleep(250)) taken = inApp("grep -l \"A line from the desktop.\" books/*/README.md || true").trim();
  if (!taken) throw new Error("The change from GitHub didn't arrive.");
  step("synced: a change made elsewhere arrived");

  // Typing, then the app killed before the autosave lands; opened again, the text is there and saved.
  const todaysEntry = async (p: Page) => {
    await p.goto("http://tauri.localhost/");
    await p.getByRole("list", { name: "Books" }).getByRole("link", { name: /Days/ }).click();
    await p.keyboard.press("Control+k");
    const palette = p.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox").fill("today's entry");
    await palette.getByRole("option", { name: "Today's entry" }).click();
    return p.getByRole("textbox", { name: /^Entry text: / }).first();
  };
  await (await todaysEntry(page)).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Typed as Android closed the app.");
  // Killed past the editor's pause (300 ms), well inside the autosave interval (2 s). A backgrounded
  // app that Android kills has had its page hidden first, which hands the editor's text on at once.
  await sleep(1000);
  adb("shell", "am", "force-stop", PACKAGE);
  if (inApp("grep -rl \"closed the app\" books/days/entries/*/*/*.md || true").trim()) throw new Error("The text was saved before the app was killed: nothing to recover.");
  // Playwright lets go of the killed app's webview before it's asked for the new one's.
  const killed = android;
  await expect.poll(() => killed.webViews().length).toBe(0);
  adb("shell", "monkey", "-p", PACKAGE, "-c", "android.intent.category.LAUNCHER", "1");
  const again: Page = await (await android.webView({ pkg: PACKAGE }, { timeout: 30_000 })).page();
  await expect(await todaysEntry(again)).toContainText("Typed as Android closed the app.");
  let recovered = "";
  for (let i = 0; i < 40 && !recovered; i++, await sleep(250)) recovered = inApp("grep -rl \"Typed as Android closed the app.\" books/days/entries/*/*/*.md || true").trim();
  if (!recovered) throw new Error("The recovered text wasn't saved.");
  step("killed mid-sentence: reopened, the text was there and saved");

  // Books on the phone (#98): taken off the shelf, a book is offered under On this phone, to add
  // back or delete; deleted, its folder is gone from the app's storage.
  await again.goto("http://tauri.localhost/");
  const bookMenu = (title: string) => again.getByRole("button", { name: `More for “${title}”` }).click();
  await bookMenu("The Bridge at Varn");
  await again.getByRole("menuitem", { name: "Remove from library…" }).click();
  await expect(again.getByRole("alertdialog")).toContainText("It stays on this phone, under On this phone below the shelf");
  await again.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  const onPhone = again.getByRole("list", { name: "On this phone" });
  await expect(onPhone).toContainText("The Bridge at Varn");
  await onPhone.getByRole("button", { name: "Add “The Bridge at Varn” back to the shelf" }).click();
  await expect(again.getByRole("list", { name: "Books" }).getByRole("link", { name: /The Bridge at Varn/ })).toBeVisible();
  const varnHere = () => inApp("ls books").split(/\s+/).includes("varn");
  if (!varnHere()) throw new Error("The novel's folder isn't in the app's storage.");
  await bookMenu("The Bridge at Varn");
  await again.getByRole("menuitem", { name: "Delete the book…" }).click();
  await expect(again.getByRole("alertdialog")).toContainText("The copy on GitHub stays");
  await again.getByRole("alertdialog").getByRole("button", { name: "Delete the book" }).click();
  await expect(again.getByRole("status").filter({ hasText: "Deleted “The Bridge at Varn” from this phone." })).toBeVisible();
  if (varnHere()) throw new Error("The deleted novel's folder is still in the app's storage.");
  step("books on the phone: one taken off the shelf offered to add back, and one deleted, folder and all");

  console.log(`\nAll ${steps.length} steps passed on ${device.split("\t")[0]}.`);
} catch (e) {
  console.error(`FAIL ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await android?.close();
  try {
    adb("reverse", "--remove", `tcp:${port}`);
  } catch {}
  await fake.close();
  rmSync(tmp, { recursive: true, force: true });
}
