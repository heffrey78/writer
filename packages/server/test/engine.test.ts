import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, describe, expect, it } from "vitest";
import { createEngine, GitHub, hashText, Library, memoryFilesPort, memoryStore, setPorts, Workspaces, type GitPort, type Host } from "../src/engine-index.ts";
import { useNodePorts } from "../src/node-ports.ts";

/**
 * The engine runs where Node doesn't (D16, #50): bundled for a browser, it and everything an Android
 * entry point would load with it (the kinds, the modules' server halves) import nothing of Node, and
 * use none of Node's globals.
 */

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const modules = ["daily", "drafting-board", "off-page-events", "story-time"];

/** What a host other than Node loads: the engine's exports (@writer/server/engine), the kinds and the modules' servers. */
const entry = [
  `export * from "./packages/server/src/engine-index.ts";`,
  `export { registerKinds } from "@writer/kinds";`,
  ...modules.map((m, i) => `export * as m${i} from "./packages/modules/${m}/src/server/index.ts";`),
].join("\n");

describe("the engine", () => {
  it("bundles for a browser: nothing it loads imports node:", async () => {
    const result = await build({
      stdin: { contents: entry, resolveDir: repo, loader: "ts" },
      bundle: true,
      platform: "browser",
      format: "esm",
      write: false,
      metafile: true,
      logLevel: "silent",
    }).catch((e: { errors?: { text: string; location?: { file: string } | null }[] }) => ({ failed: (e.errors ?? []).map((x) => `${x.location?.file ?? "?"}: ${x.text}`) }));
    expect("failed" in result ? result.failed : []).toEqual([]);
    if ("failed" in result) return;

    // Its own sources, as the bundle took them: none uses Node's globals.
    const ours = Object.keys(result.metafile.inputs).filter((f) => f.startsWith("packages/"));
    expect(ours.length).toBeGreaterThan(50);
    const globals = ours.filter((f) => /\b(process\.(env|platform|pid|versions|cwd)|Buffer\.(from|alloc|byteLength|concat))\b|[a-z]\.unref\(\)/.test(readFileSync(join(repo, f), "utf8")));
    expect(globals).toEqual([]);
  }, 60_000);
});

/** A git that's there and has nothing to say: enough for a book to be opened, read and written. Anything else is refused by name. */
function quietGit(): GitPort {
  const answers: Partial<GitPort> = {
    isRepo: async () => true,
    inProgress: async () => false,
    stage: async () => {},
    stagedChanges: async () => [],
    status: async () => [],
    commit: async () => null,
    getConfig: async () => null,
    remoteUrl: async () => null,
    listConfig: async () => [],
    currentBranch: async () => "main",
    refs: async () => [],
    tags: async () => [],
  };
  return new Proxy(answers as GitPort, {
    get: (target, op: string) => (op in target ? target[op as keyof GitPort] : () => Promise.reject(new Error(`The engine asked git for ${op}, which this test doesn't give.`))),
  });
}

describe("the engine on in-memory ports", () => {
  afterAll(() => useNodePorts());

  it("opens a book that lives in memory, serves its model and files, and refuses a write over a change", async () => {
    // The sample novel, every file of it, at /books/varn in memory.
    const sample = join(repo, "examples/sample-novel");
    const seed: Record<string, Uint8Array> = {};
    for (const e of readdirSync(sample, { recursive: true, withFileTypes: true })) {
      if (e.isFile()) seed[`/books/varn/${relative(sample, join(e.parentPath, e.name))}`] = readFileSync(join(e.parentPath, e.name));
    }
    const files = memoryFilesPort(seed);
    const host: Host = {
      env: () => ({}),
      configDir: () => "/config",
      booksDir: () => "/books",
      ghWriterConfigDir: () => undefined,
      templates: () => "/templates",
      absolute: (path) => path,
      shown: (path) => path,
    };
    setPorts({ git: quietGit(), files, host });

    const library = await Library.open();
    const { id } = await library.add("/books/varn");
    const workspaces = new Workspaces(library, { commit: false, sync: false });
    const github = new GitHub({ clientId: "", store: memoryStore(), fetch: () => Promise.reject(new TypeError("offline")) });
    const engine = createEngine({ library, workspaces, github });

    const shelf = (await (await engine.request("/api/library")).json()) as { novels: { id: string; title: string }[] };
    expect(shelf.novels.map((n) => n.title)).toEqual(["The Bridge at Varn"]);
    const model = (await (await engine.request(`/api/novels/${id}`)).json()) as { novel: { pieces: { title: string; file: string }[] } };
    expect(model.novel.pieces.length).toBeGreaterThan(3);
    const scene = model.novel.pieces[0]!;

    const file = (await (await engine.request(`/api/novels/${id}/files/${scene.file}`)).json()) as { content: string; hash: string };
    expect(file.hash).toBe(hashText(file.content));
    const put = (content: string, base: string) => engine.request(`/api/novels/${id}/files/${scene.file}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content, base }) });
    const saved = `${file.content}\nWritten in memory.\n`;
    expect(await (await put(saved, file.hash)).json()).toEqual({ hash: hashText(saved) });
    expect(new TextDecoder().decode(files.files.get(`/books/varn/${scene.file}`))).toBe(saved);
    // Based on the text before: refused, and the file as it is now comes back.
    const refused = await put("Something else.\n", file.hash);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { current: { content: string } }).current.content).toBe(saved);
    await workspaces.close();
  });
});
