import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The boundary (D14, #26): the base imports no kind and no module. Only the app's entry points do, to
 * register what the app ships. Kinds live in packages/kinds (@writer/kinds), modules in
 * packages/modules/<name> (@writer/module-<name>).
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** Where the base's code is: each base package's source, and the editor's playground. */
const BASE = ["core", "server", "client", "editor", "web", "export", "cli", "desktop"].flatMap((p) => [`packages/${p}/src`, `packages/${p}/playground`]);

/** The app's entry points, which register the kinds and modules it ships. */
const ENTRY_POINTS = new Set([
  "packages/cli/src/main.ts",
  "packages/cli/src/standalone.ts",
  "packages/cli/src/compile-standalone.ts",
  "packages/cli/src/snapshots-standalone.ts",
  "packages/editor/playground/main.tsx",
  "packages/web/src/main.tsx",
]);

/** The specifiers a file imports, statically or dynamically, and those it re-exports. */
const specifiers = (text: string) => [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g)].map((m) => m[1]!);

/** What a file of the base imports that it mustn't: a kind or a module, by package name or by path. */
export function forbiddenImports(file: string, text: string): string[] {
  return specifiers(text).filter((s) => {
    if (/^@writer\/(kinds|module-[^/]+)(\/|$)/.test(s)) return true;
    if (!s.startsWith(".")) return false;
    const target = relative(ROOT, resolve(ROOT, file, "..", s));
    return /^packages\/(kinds|modules)(\/|$)/.test(target);
  });
}

function sources(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => (e.isDirectory() ? sources(`${dir}/${e.name}`) : /\.(ts|tsx|mts)$/.test(e.name) ? [`${dir}/${e.name}`] : []));
}

describe("the base's boundary", () => {
  it("imports no kind or module outside the app's entry points", () => {
    const files = BASE.flatMap(sources);
    expect(files.length).toBeGreaterThan(100);
    const crossings = files.filter((f) => !ENTRY_POINTS.has(f)).flatMap((f) => forbiddenImports(f, readFileSync(join(ROOT, f), "utf8")).map((s) => `${f} imports ${s}`));
    expect(crossings).toEqual([]);
  });

  it("finds a planted import of a kind or a module, by name or by path", () => {
    const planted = [
      'import { novel } from "@writer/kinds";',
      'import type { Lanes } from "@writer/module-plotlines/web";',
      'const m = await import("../../modules/story-time/core/index.ts");',
      'export { novel } from "../../kinds/src/novel.ts";',
      'import { loadBook } from "@writer/core";',
      'import { modulesOf } from "./modules.ts";',
    ].join("\n");
    expect(forbiddenImports("packages/server/src/library.ts", planted)).toEqual(["@writer/kinds", "@writer/module-plotlines/web", "../../modules/story-time/core/index.ts", "../../kinds/src/novel.ts"]);
  });

  it("lets the entry points register what the app ships", () => {
    for (const f of ENTRY_POINTS) expect(readFileSync(join(ROOT, f), "utf8")).toMatch(/registerKinds\(\)|registerWebModule\(/);
  });
});
