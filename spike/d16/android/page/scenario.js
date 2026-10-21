// D16 spike (#46): what an engine in the webview would do through the git port, in process. With a PC
// attached (spike/d16/android/run.ts), its fake GitHub answers on 127.0.0.1:47811 through adb reverse,
// with a book in ada/book and this token, and the PC reads report.json afterwards. On its own, the
// app makes a remote on the device, with the same book, and runs the same round trip against it.
const PC_PORT = 47811;
const PC_REMOTE = `http://127.0.0.1:${PC_PORT}/ada/book.git`;
const TOKEN = "gho_quest_spike";
// Small and public, for an https clone through libgit2's own OpenSSL and Android's certificates.
const HTTPS_CLONE = "https://github.com/octocat/Hello-World.git";
const HTTPS_LIST = "https://github.com/heffrey78/writer.git";

const { invoke } = window.__TAURI__.core;
const log = (line) => (document.getElementById("log").textContent += `${line}\n`);
const steps = [];

/** One port operation, as the engine would call it: the server's error codes on failure. */
async function git(op, dir, args = {}) {
  const r = await invoke("git", { op, dir, args });
  if (r.err) throw Object.assign(new Error(`${r.err.code}: ${r.err.message}`), { code: r.err.code });
  return r.ok;
}

async function step(name, fn) {
  const start = performance.now();
  try {
    const detail = await fn();
    const ms = Math.round(performance.now() - start);
    steps.push({ name, ok: true, ms, ...(detail === undefined ? {} : { detail }) });
    log(`ok    ${String(ms).padStart(5)} ms  ${name}`);
    return detail;
  } catch (e) {
    steps.push({ name, ok: false, ms: Math.round(performance.now() - start), detail: String(e.message ?? e) });
    log(`FAIL  ${name}: ${e.message ?? e}`);
    throw e;
  }
}

const prose = (a, b, c) => `${a}\n\n${b}\n\n${c}\n`;
const base64 = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const expect = (what, actual, wanted) => {
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${what}: ${JSON.stringify(actual)}, not ${JSON.stringify(wanted)}`);
  return actual;
};
let REMOTE = PC_REMOTE;
let auth = { token: TOKEN };
const SETTLED = prose("One, as both had it: settled on the Quest.", "Two.", "Three.");

const scene = (i, v) => Array.from({ length: 12 }, (_, p) => `Scene ${i}, paragraph ${p}, version ${p === v % 12 ? v : 0}: the river ran under the bridge.`).join("\n\n") + "\n";

/** No PC: a bare repository on the device as the remote, holding the book the PC would serve. */
async function deviceRemote(root) {
  REMOTE = `${root}/remote.git`;
  auth = {};
  await step("make a remote on the device", () => git("init", "remote.git", { branch: "main", bare: true }));
  await step("write a book of 150 scenes, with 60 saves", async () => {
    await git("init", "seed", { branch: "main" });
    await git("setConfig", "seed", { key: "user.name", value: "Ada Writer" });
    await git("setConfig", "seed", { key: "user.email", value: "ada@example.com" });
    await invoke("write_file", { path: "seed/book/opening.md", text: prose("One.", "Two.", "Three.") });
    for (let i = 0; i < 150; i++) await invoke("write_file", { path: `seed/book/scene-${i}.md`, text: scene(i, 0) });
    await git("stage", "seed", { paths: [] });
    await git("commit", "seed", { message: "Start" });
    for (let c = 1; c <= 60; c++) {
      for (const i of [c % 150, (c * 7) % 150]) await invoke("write_file", { path: `seed/book/scene-${i}.md`, text: scene(i, c) });
      await git("stage", "seed", { paths: [] });
      await git("commit", "seed", { message: `Save ${c}` });
    }
    await git("addRemote", "seed", { name: "origin", url: REMOTE });
    await git("push", "seed", { remote: "origin", refspecs: ["HEAD:refs/heads/main"] });
  });
}

async function roundTrip() {
  const root = await step("start afresh", () => invoke("reset"));
  await step("libgit2 version", () => git("version", "."));
  const pc = await invoke("reachable", { port: PC_PORT });
  log(pc ? `Remote: the PC's fake GitHub (${PC_REMOTE})` : "Remote: on this device (no PC attached)");
  if (!pc) await deviceRemote(root);
  await step("clone the book (A)", () => git("clone", "a", { url: REMOTE, ...auth }));
  await step("clone it again (B)", () => git("clone", "b", { url: REMOTE, ...auth }));
  // No global git config on a phone: the engine gives each repository the writer's name.
  for (const dir of ["a", "b"]) {
    await step(`who's writing, in ${dir.toUpperCase()}`, async () => {
      await git("setConfig", dir, { key: "user.name", value: "Ada Writer" });
      await git("setConfig", dir, { key: "user.email", value: "ada@example.com" });
    });
  }
  await step("the book as cloned", async () => (await git("listTree", "a", { rev: "HEAD" })).length);

  await step("A writes, commits, makes a checkpoint and syncs", async () => {
    await invoke("write_file", { path: "a/book/opening.md", text: prose("One, as A had it.", "Two.", "Three.") });
    await git("stage", "a", { paths: [] });
    await git("commit", "a", { message: "From A" });
    await git("tag", "a", { name: "checkpoint/on-the-quest", message: "On the Quest\n\nwords: 9" });
    await git("push", "a", { remote: "origin", refspecs: ["HEAD:refs/heads/main", "refs/tags/checkpoint/*:refs/tags/checkpoint/*"], setUpstream: true, ...auth });
  });
  await step("B writes the same paragraph, commits, and is refused", async () => {
    await invoke("write_file", { path: "b/book/opening.md", text: prose("One, as B had it.", "Two.", "Three.") });
    await git("stage", "b", { paths: [] });
    await git("commit", "b", { message: "From B" });
    const refused = await git("push", "b", { remote: "origin", refspecs: ["HEAD:refs/heads/main"], ...auth }).then(
      () => "pushed",
      (e) => e.code,
    );
    return expect("B's push", refused, "REJECTED");
  });
  const { ours, theirs, conflicts } = await step("B fetches and merges in memory", async () => {
    await git("fetch", "b", { remote: "origin", refspecs: ["+refs/heads/main:refs/remotes/origin/main"], ...auth });
    const ours = await git("resolve", "b", { rev: "HEAD" });
    const theirs = await git("resolve", "b", { rev: "refs/remotes/origin/main" });
    expect("ahead and behind", await git("aheadBehind", "b", { a: ours, b: theirs }), { ahead: 1, behind: 1 });
    const merged = await git("mergeTrees", "b", { ours, theirs });
    return { ours, theirs, conflicts: expect("conflicts", merged.conflicts, ["book/opening.md"]), tree: merged.tree };
  }).then((d) => d);
  await step("B commits the settled merge and syncs", async () => {
    const merged = await git("mergeTrees", "b", { ours, theirs });
    const tree = await git("buildTree", "b", { base: merged.tree, edits: conflicts.map((path) => ({ path, content: base64(SETTLED) })) });
    const commit = await git("commitTree", "b", { tree, parents: [ours, theirs], message: "Merge changes from origin\n" });
    await git("fastForward", "b", { rev: commit });
    await git("push", "b", { remote: "origin", refspecs: ["HEAD:refs/heads/main"], ...auth });
    return commit;
  });
  await step("A syncs and has the settled text", async () => {
    await git("fetch", "a", { remote: "origin", refspecs: ["+refs/heads/main:refs/remotes/origin/main"], ...auth });
    await git("fastForward", "a", { rev: "refs/remotes/origin/main" });
    expect("A's opening", await invoke("read_file", { path: "a/book/opening.md" }), SETTLED);
  });

  // What the app does most often, timed on the device.
  await step("status", async () => (await git("status", "a")).length);
  await step("open: tree and every blob at HEAD", async () => {
    const tree = await git("listTree", "a", { rev: "HEAD" });
    return Object.keys(await git("readBlobs", "a", { oids: tree.map((e) => e.oid) })).length;
  });
  await step("a scene's history", async () => (await git("log", "a", { path: "book/scene-3.md" })).length);
  await step("stats: every commit's changes", async () => (await git("history", "a")).length);
  await step("save: a scene staged and committed", async () => {
    await invoke("write_file", { path: "a/book/scene-1.md", text: prose("Saved on the Quest.", "Two.", "Three.") });
    await git("stage", "a", { paths: [] });
    await git("commit", "a", { message: "Save" });
  });
}

async function https() {
  const trust = await invoke("trust");
  log(`Trusted for https: ${JSON.stringify(trust)}`);
  steps.push({ name: "certificates trusted", ok: !trust?.error, ms: 0, detail: trust });
  // Each tried on its own: one failing doesn't hide the other.
  let ok = true;
  await step("https: libgit2 lists a GitHub repository's refs", () => invoke("https_probe", { url: HTTPS_LIST })).catch(() => (ok = false));
  await step("https: libgit2 clones from github.com", async () => {
    await git("clone", "hello", { url: HTTPS_CLONE });
    return (await git("log", "hello", { limit: 1 }))[0]?.summary;
  }).catch(() => (ok = false));
  if (!ok || trust?.error) throw new Error("https");
}

async function run() {
  const status = document.getElementById("status");
  const again = document.getElementById("again");
  again.disabled = true;
  steps.length = 0;
  document.getElementById("log").textContent = "";
  status.textContent = "Running…";
  status.className = "";
  let ok = true;
  // The round trip stops at its first failure; https is tried either way.
  for (const part of [roundTrip, https]) {
    try {
      await part();
    } catch {
      ok = false;
    }
  }
  status.textContent = ok ? "Done: every step passed." : "Finished, with a step that failed: see below.";
  status.className = ok ? "ok" : "bad";
  const where = await invoke("report", { json: JSON.stringify({ ok, remote: REMOTE, userAgent: navigator.userAgent, steps }, null, 2) });
  log(`\nWebView: ${navigator.userAgent}\nReport: ${where}`);
  again.disabled = false;
}

document.getElementById("again").addEventListener("click", run);
run();
