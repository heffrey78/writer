import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeGitHub } from "../../../packages/server/test/fake-github.ts";

/**
 * D16 spike (#46), end to end on an Android device: the fake GitHub on this PC with a book in
 * ada/book, reached from the device as 127.0.0.1:47811 (adb reverse); the spike app installed,
 * started, and left to run its round trip (page/scenario.js); then its report read back and the
 * remote checked. `node spike/d16/android/run.ts` after building the APK (see README in this folder).
 */

const PACKAGE = "io.github.heffrey78.writer.d16";
const DEVICE_PORT = 47811;
const TOKEN = "gho_quest_spike";
const here = fileURLToPath(new URL(".", import.meta.url));
const adb = (...args: string[]) => execFileSync("adb", args, { encoding: "utf8" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const prose = (a: string, b: string, c: string) => `${a}\n\n${b}\n\n${c}\n`;

function apk(): string {
  const root = join(here, "src-tauri/gen/android/app/build/outputs/apk");
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (e.name.endsWith(".apk")) found.push(join(dir, e.name));
    }
  };
  walk(root);
  if (!found.length) throw new Error(`No APK under ${root}: build it first.`);
  return found[0]!;
}

const device = adb("devices", "-l").split("\n").slice(1).find((l) => /\bdevice\b/.test(l));
if (!device) throw new Error("No Android device: connect the Quest over USB (or `make connect` in row_vr) and accept the prompt.");
console.log(`Device: ${device.replace(/\s+/g, " ").trim()}`);

// The book on the fake GitHub: an opening both copies will change, and 150 scenes with history.
const tmp = mkdtempSync(join(tmpdir(), "d16-android-"));
const gitRoot = join(tmp, "github");
const fake = await fakeGitHub({ gitRoot });
fake.users.set(TOKEN, { login: "ada" });
mkdirSync(join(gitRoot, "ada"), { recursive: true });
const bare = fake.repoPath("ada", "book");
execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch=main", bare]);
const seed = join(tmp, "seed");
const g = (...args: string[]) => execFileSync("git", ["-C", seed, "-c", "user.name=Ada Writer", "-c", "user.email=ada@example.com", ...args], { stdio: "ignore" });
mkdirSync(join(seed, "book"), { recursive: true });
g("init", "-q", "-b", "main");
writeFileSync(join(seed, "book/opening.md"), prose("One.", "Two.", "Three."));
const scene = (i: number, v: number) => Array.from({ length: 12 }, (_, p) => `Scene ${i}, paragraph ${p}, version ${p === v % 12 ? v : 0}: the river ran under the bridge.`).join("\n\n") + "\n";
for (let i = 0; i < 150; i++) writeFileSync(join(seed, `book/scene-${i}.md`), scene(i, 0));
g("add", "-A");
g("commit", "-q", "-m", "Start");
for (let c = 1; c <= 60; c++) {
  for (const i of [c % 150, (c * 7) % 150]) writeFileSync(join(seed, `book/scene-${i}.md`), scene(i, c));
  g("add", "-A");
  g("commit", "-q", "-m", `Save ${c}`);
}
g("push", "-q", bare, "main");
const port = new URL(fake.url).port;
console.log(`Fake GitHub on ${fake.url}, the device's 127.0.0.1:${DEVICE_PORT} reversed to it.`);

try {
  adb("reverse", `tcp:${DEVICE_PORT}`, `tcp:${port}`);
  const file = apk();
  console.log(`Installing ${file.replace(here, "")}`);
  adb("install", "-r", file);
  adb("shell", "am", "force-stop", PACKAGE);
  adb("shell", "run-as", PACKAGE, "sh", "-c", "rm -f $(find . -name report.json)");
  adb("shell", "monkey", "-p", PACKAGE, "-c", "android.intent.category.LAUNCHER", "1");

  // The report, once the page has written it.
  let report: { ok: boolean; userAgent: string; steps: { name: string; ok: boolean; ms: number; detail?: unknown }[] } | undefined;
  for (let i = 0; i < 90 && !report; i++) {
    await sleep(2000);
    const text = (() => {
      try {
        return adb("shell", "run-as", PACKAGE, "sh", "-c", "cat $(find . -name report.json) 2>/dev/null");
      } catch {
        return "";
      }
    })();
    if (text.trim().startsWith("{")) report = JSON.parse(text);
  }
  if (!report) throw new Error("No report from the device after 3 minutes.");

  console.log(`\nWebView: ${report.userAgent}\n`);
  console.log("| Step | ms | |");
  console.log("|---|---:|---|");
  for (const s of report.steps) console.log(`| ${s.name} | ${s.ms} | ${s.ok ? "ok" : `FAILED: ${String(s.detail)}`}${s.ok && s.detail !== undefined ? ` (${JSON.stringify(s.detail)})` : ""} |`);

  // GitHub's copy, as the device left it.
  const remote = (...args: string[]) => execFileSync("git", ["--git-dir", bare, ...args], { encoding: "utf8" });
  const checks: [string, boolean][] = [
    ["the device's report says every step passed", report.ok],
    ["main is a merge of A's and B's commits", remote("log", "-1", "--format=%P", "main").trim().split(" ").length === 2],
    ["its message is the app's", remote("log", "-1", "--format=%B", "main").trim() === "Merge changes from origin"],
    ["the opening is as settled on the device", remote("show", "main:book/opening.md") === prose("One, as both had it: settled on the Quest.", "Two.", "Three.")],
    ["the checkpoint tag is there, annotated", remote("cat-file", "-t", "checkpoint/on-the-quest").trim() === "tag"],
    ["the commits are by the name the engine gave", remote("log", "-3", "--format=%an", "main").trim().split("\n").every((n) => n === "Ada Writer")],
  ];
  console.log();
  for (const [what, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
} finally {
  try {
    adb("reverse", "--remove", `tcp:${DEVICE_PORT}`);
  } catch {}
  await fake.close();
  rmSync(tmp, { recursive: true, force: true });
}
