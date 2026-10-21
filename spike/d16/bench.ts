import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodePort } from "./node-port.ts";
import type { GitPort } from "./port.ts";
import { rustPort } from "./rust-port.ts";

/**
 * D16 spike (#45): how long each port takes over a large book, for what the app does on a save, a
 * sync and the stats page. `node spike/d16/bench.ts` after building git2-port. Prints a table.
 */

const tmp = mkdtempSync(join(tmpdir(), "d16-bench-"));
const home = join(tmp, "home");
mkdirSync(home);
writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = Ada Writer\n\temail = ada@example.com\n");
process.env.HOME = home;
process.env.GIT_CONFIG_GLOBAL = join(home, ".gitconfig");
process.env.GIT_CONFIG_NOSYSTEM = "1";

const FILES = 150;
const COMMITS = 400;
const paragraph = (i: number, v: number) => `Paragraph ${i}, version ${v}: ${"the river ran under the bridge and the town listened ".repeat(4)}`;
const scene = (f: number, v: number) => Array.from({ length: 12 }, (_, i) => paragraph(i + f, i === v % 12 ? v : 0)).join("\n\n") + "\n";

// The book, made with git: 150 scenes (~800 words each), then 400 commits each changing three.
const source = join(tmp, "source");
const g = (...args: string[]) => execFileSync("git", ["-C", source, ...args], { stdio: "ignore" });
mkdirSync(join(source, "manuscript"), { recursive: true });
g("init", "-q", "-b", "main");
for (let f = 0; f < FILES; f++) writeFileSync(join(source, "manuscript", `scene-${f}.md`), scene(f, 0));
g("add", "-A");
g("commit", "-q", "-m", "Start");
for (let c = 1; c <= COMMITS; c++) {
  for (const f of [c % FILES, (c * 7) % FILES, (c * 13) % FILES]) writeFileSync(join(source, "manuscript", `scene-${f}.md`), scene(f, c));
  g("add", "-A");
  g("commit", "-q", "-m", `Save ${c}`);
}
g("branch", "theirs", "HEAD~20");

async function time(label: string, fn: () => Promise<unknown>, runs = 3): Promise<[string, number]> {
  await fn();
  const start = performance.now();
  for (let i = 0; i < runs; i++) await fn();
  return [label, (performance.now() - start) / runs];
}

async function measure(p: GitPort): Promise<[string, number][]> {
  const dir = join(tmp, p.name);
  cpSync(source, dir, { recursive: true });
  let v = 10_000;
  return [
    await time("status", () => p.status(dir)),
    await time("save: a scene staged and committed", async () => {
      writeFileSync(join(dir, "manuscript/scene-1.md"), scene(1, ++v));
      await p.stage(dir);
      await p.commit(dir, `Save ${v}`);
    }),
    await time("open: tree and every blob at HEAD", async () => {
      const tree = await p.listTree(dir, "HEAD");
      await p.readBlobs(dir, tree.map((e) => e.oid));
    }),
    await time("a scene's history (log -- path)", () => p.log(dir, { path: "manuscript/scene-3.md" })),
    await time("stats: every commit's changes (log --raw -M)", () => p.history(dir), 1),
    await time("sync: ahead/behind and an in-memory merge", async () => {
      await p.aheadBehind(dir, "HEAD", "theirs");
      await p.mergeTrees(dir, "HEAD", "theirs");
    }),
  ];
}

const rust = rustPort();
try {
  const [node, git2] = [await measure(nodePort), await measure(rust)];
  console.log(`${FILES} scenes, ${COMMITS + 1} commits. Milliseconds, mean of 3 (stats: 1).\n`);
  console.log(`| Operation | git (${await nodePort.version()}) | git2 (${await rust.version()}) |`);
  console.log("|---|---:|---:|");
  for (const [i, [label, ms]] of node.entries()) console.log(`| ${label} | ${ms.toFixed(0)} | ${git2[i]![1].toFixed(0)} |`);
} finally {
  rust.close();
  rmSync(tmp, { recursive: true, force: true });
}
