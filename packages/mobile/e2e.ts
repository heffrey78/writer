import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { _android, expect, type AndroidDevice, type Page } from "@playwright/test";
import { fakeGitHub } from "../server/test/fake-github.ts";

/**
 * Writer on Android, end to end (#52): the app on a device or the emulator, its webview driven by
 * Playwright, against a fake GitHub on this computer that the device
 * reaches through `adb reverse`. It signs in with a code, starts a journal and writes in it, puts it
 * on GitHub and syncs; clones a novel, takes a change made elsewhere by syncing, and checks the
 * files on the device and on GitHub.
 *
 * `node packages/mobile/e2e.ts [APK]`, with one device attached (ADB names adb, if not on PATH). The
 * APK is installed and the app's data cleared first.
 */

const PACKAGE = "io.github.heffrey78.writer";
const ADB = process.env.ADB ?? "adb";
const repo = fileURLToPath(new URL("../../", import.meta.url));
const adb = (...args: string[]) => execFileSync(ADB, args, { encoding: "utf8" });
/** A shell command in the app's own folder on the device. */
const inApp = (command: string, input?: string) => execFileSync(ADB, ["shell", `run-as ${PACKAGE} sh -c '${command}'`], { encoding: "utf8", ...(input !== undefined ? { input } : {}) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

const port = new URL(fake.url).port;
const steps: [string, number][] = [];
let started = Date.now();
const step = (name: string) => {
  steps.push([name, Date.now() - started]);
  console.log(`ok   ${name} (${Date.now() - started} ms)`);
  started = Date.now();
};

let android: AndroidDevice | undefined;
try {
  const device = adb("devices").split("\n").slice(1).find((l) => /\tdevice$/.test(l));
  if (!device) throw new Error("No Android device: start the emulator, or connect a phone with USB debugging on.");
  // The same port on both sides: the fake's own URLs (a new repository's clone URL) work on the device.
  adb("reverse", `tcp:${port}`, `tcp:${port}`);
  const apk = process.argv[2];
  if (apk) adb("install", "-r", apk);
  adb("shell", "am", "force-stop", PACKAGE);
  adb("shell", "pm", "clear", PACKAGE);
  inApp("cat > env.json", JSON.stringify({ WRITER_GITHUB_URL: fake.url, WRITER_GITHUB_API_URL: fake.url, WRITER_GITHUB_CLIENT_ID: fake.clientId }));
  adb("shell", "monkey", "-p", PACKAGE, "-c", "android.intent.category.LAUNCHER", "1");

  // The app's webview, through Playwright's own adb driver (its CDP connection wants a browser's
  // contexts, which a webview hasn't).
  [android] = await _android.devices();
  if (!android) throw new Error("Playwright sees no Android device.");
  const page: Page = await (await android.webView({ pkg: PACKAGE }, { timeout: 30_000 })).page();
  expect.configure({ timeout: 20_000 });

  await expect(page.getByRole("heading", { level: 1, name: "Your books" })).toBeVisible();
  await expect(page.getByText("No books yet")).toBeVisible();
  step("the shelf, from the engine in the page");

  // Signed in with a code; the name and email git signs with, as GitHub suggests them.
  await page.getByRole("banner").getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: /Connect GitHub/ }).click();
  const connect = page.getByRole("dialog", { name: "Connect to GitHub" });
  await connect.getByRole("button", { name: "Sign in with a code" }).click();
  await expect(connect.getByLabel("Your code")).toHaveText(fake.userCode);
  fake.approve();
  await expect(connect).toHaveCount(0);
  const identity = page.getByRole("dialog", { name: "Your name and email" });
  await expect(identity.getByLabel("Name")).toHaveValue("Ada Writer");
  await identity.getByRole("button", { name: "Save" }).click();
  await expect(identity).toHaveCount(0);
  if (!/name = Ada Writer/.test(inApp("cat .gitconfig"))) throw new Error("The name and email weren't kept in the app's git configuration.");
  const token = inApp("cat secrets/github | base64");
  if (!token.trim() || Buffer.from(token, "base64").includes(fake.deviceToken)) throw new Error("The token isn't kept sealed.");
  step("signed in with a code, the token sealed by the keystore; the name git signs with kept");

  // A journal, and today's entry written in.
  await page.getByRole("list", { name: "Books" }).getByRole("button", { name: "New book" }).click();
  const making = page.getByRole("dialog", { name: "New book" });
  await making.getByRole("radio", { name: "Journal" }).check();
  await making.getByRole("textbox", { name: "Title" }).fill("Days");
  await making.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "No months yet" })).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "Command palette" }).getByRole("combobox").fill("today's entry");
  await page.keyboard.press("Enter");
  const text = page.getByRole("textbox", { name: "Entry text" });
  await text.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Written on the phone.");
  let entry = "";
  for (let i = 0; i < 40 && !entry; i++, await sleep(250)) entry = inApp("grep -rl \"Written on the phone.\" books/days/entries || true").trim();
  if (!entry) throw new Error("The entry wasn't saved in the app's storage.");
  step("a journal started, and today's entry saved on the device");

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
