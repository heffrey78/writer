import { mkdirSync, symlinkSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { memoryFilesPort } from "../src/files-port/memory.ts";
import { nodeFilesPort } from "../src/files-port/node.ts";
import { portSource, TEMP_SUFFIX, type FileEventType, type FilesPort } from "../src/files-port/port.ts";
import { remoteFilesPort } from "../src/remote-ports.ts";
import { startBridge } from "./bridge.ts";
import { scratch } from "./fixtures.ts";

/** The files port's contract (D16): what the server needs of a disk, whichever it is: Node's, or memory. */

let fresh: (name: string) => string;
let cleanUp: () => void;
beforeAll(() => ({ fresh, cleanUp } = scratch("files-port")));
afterAll(() => cleanUp());

const ADAPTERS: [string, () => { files: FilesPort; root: string }][] = [
  [
    "disk",
    () => {
      const root = fresh("book");
      mkdirSync(root);
      return { files: nodeFilesPort, root };
    },
  ],
  ["memory", () => ({ files: memoryFilesPort(), root: "/books/book" })],
  // The disk's, from a page: through the remote ports to a Node bridge (#51).
  [
    "bridge",
    () => {
      const root = fresh("bridged");
      mkdirSync(root);
      return { files: remoteFilesPort(bridge.channel), root };
    },
  ],
];
const bridge = await startBridge();
afterAll(() => bridge.close());
const decode = (b: Uint8Array | undefined) => (b === undefined ? undefined : new TextDecoder().decode(b));

describe.each(ADAPTERS)("the files port: %s", (_, make) => {
  it("writes atomically, making the folders, and reads back; leaves no temp file", async () => {
    const { files, root } = make();
    const path = files.join(root, "manuscript/01-arrival/01-the-station.md");
    expect(await files.read(path)).toBeUndefined();
    await files.write(path, "Ada stepped off the train.\n");
    expect(decode(await files.read(path))).toBe("Ada stepped off the train.\n");
    await files.write(path, new TextEncoder().encode("Bytes too.\n"));
    expect(decode(await files.read(path))).toBe("Bytes too.\n");
    expect((await files.list(files.join(root, "manuscript/01-arrival"))).map((e) => e.path)).toEqual(["01-the-station.md"]);
    expect(await files.stat(path)).toMatchObject({ kind: "file", size: 11 });
    expect(await files.stat(files.join(root, "manuscript"))).toMatchObject({ kind: "dir" });
    expect(await files.stat(files.join(root, "nothing"))).toBeUndefined();
  });

  // A test's write hook stays on its side of a bridge.
  it.skipIf(_ === "bridge")("puts the new file in place only after its temp file is whole: a failure before leaves the old one", async () => {
    const { files, root } = make();
    const path = files.join(root, "a.md");
    await files.write(path, "Old.\n");
    let temp = "";
    await expect(
      files.write(path, "New.\n", {
        beforeRename: async (t) => {
          temp = t;
          expect(decode(await files.read(t))).toBe("New.\n");
          throw new Error("power cut");
        },
      }),
    ).rejects.toThrow("power cut");
    expect(temp.endsWith(TEMP_SUFFIX)).toBe(true);
    expect(files.dirname(temp)).toBe(files.dirname(path));
    expect(decode(await files.read(path))).toBe("Old.\n");
    expect(await files.read(temp)).toBeUndefined();
  });

  it("lists a folder or everything under it, by path, sorted; nothing for a folder that isn't there", async () => {
    const { files, root } = make();
    await files.write(files.join(root, "b.md"), "b");
    await files.write(files.join(root, "a/c.md"), "c");
    await files.write(files.join(root, "a/d/e.md"), "e");
    expect(await files.list(root)).toEqual([
      { path: "a", kind: "dir" },
      { path: "b.md", kind: "file" },
    ]);
    expect((await files.list(root, { recursive: true })).map((e) => `${e.kind} ${e.path}`)).toEqual(["dir a", "file a/c.md", "dir a/d", "file a/d/e.md", "file b.md"]);
    expect(await files.list(files.join(root, "none"))).toEqual([]);
  });

  it("removes, renames, copies; removes a folder only when empty, or a whole tree", async () => {
    const { files, root } = make();
    const [a, b, c] = ["a/x.md", "a/y.md", "z.md"].map((p) => files.join(root, p));
    await files.write(a!, "x");
    await files.rename(a!, b!);
    expect(await files.read(a!)).toBeUndefined();
    expect(decode(await files.read(b!))).toBe("x");
    await files.copy(b!, c!);
    expect(decode(await files.read(c!))).toBe("x");
    expect(await files.removeEmptyDir(files.join(root, "a"))).toBe(false);
    await files.remove(b!);
    await files.remove(b!);
    expect(await files.removeEmptyDir(files.join(root, "a"))).toBe(true);
    expect(await files.stat(files.join(root, "a"))).toBeUndefined();
    await files.write(files.join(root, "t/u/v.md"), "v");
    await files.removeTree(files.join(root, "t"));
    expect(await files.stat(files.join(root, "t"))).toBeUndefined();
    await files.makeDir(files.join(root, "made/deep"));
    expect(await files.stat(files.join(root, "made/deep"))).toMatchObject({ kind: "dir" });
  });

  it("joins and splits paths as the host writes them, and says what's under a root", async () => {
    const { files, root } = make();
    const path = files.join(root, "a/b.md");
    expect(files.relative(root, path)).toBe("a/b.md");
    expect(files.relative(root, root)).toBe("");
    expect(files.relative(files.join(root, "a"), files.join(root, "c.md"))).toBeUndefined();
    expect(files.dirname(path)).toBe(files.join(root, "a"));
    await files.write(path, "b");
    expect(await files.real(path)).toBe(path);
    expect(await files.real(files.join(root, "none"))).toBeUndefined();
  });

  it("gives a book's files to core's loader, hidden ones left out", async () => {
    const { files, root } = make();
    await files.write(files.join(root, "manuscript/a.md"), "A");
    await files.write(files.join(root, ".git/HEAD"), "ref");
    const source = portSource(files, root);
    expect(await source.list("")).toEqual([{ name: "manuscript", dir: true }]);
    expect(await source.list("manuscript")).toEqual([{ name: "a.md", dir: false }]);
    expect(await source.read("manuscript/a.md")).toBe("A");
    expect(await source.read("none.md")).toBeUndefined();
  });

  it("watches: changes by anyone, by path from the root, less what it ignores", async () => {
    const { files, root } = make();
    await files.write(files.join(root, "a.md"), "a");
    const events: string[] = [];
    const seen = (type: FileEventType, path: string) => events.push(`${type} ${path}`);
    const stop = await files.watch(root, (p) => p.startsWith(".") || p.includes("/."), seen);
    await files.write(files.join(root, "b.md"), "b");
    await files.write(files.join(root, "a.md"), "a2");
    await files.write(files.join(root, ".hidden"), "h");
    await files.remove(files.join(root, "b.md"));
    await expect.poll(() => [...events].sort(), { timeout: 5000 }).toEqual(["add b.md", "change a.md", "unlink b.md"]);
    await stop();
    await files.write(files.join(root, "c.md"), "c");
    await new Promise((r) => setTimeout(r, 300));
    expect(events).not.toContain("add c.md");
  });
});

describe("the files port on disk", () => {
  it("says a symlink is one, and follows it for the real path", async () => {
    const root = fresh("links");
    mkdirSync(`${root}/real`, { recursive: true });
    symlinkSync(`${root}/real`, `${root}/link`);
    expect(await nodeFilesPort.stat(`${root}/link`)).toMatchObject({ kind: "symlink" });
    expect(await nodeFilesPort.real(`${root}/link`)).toBe(await nodeFilesPort.real(`${root}/real`));
  });
});
