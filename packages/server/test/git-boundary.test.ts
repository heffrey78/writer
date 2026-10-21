import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The server reaches git only through its port (D16, #48): the Node adapter (git-port/node.ts) is the
 * only code that runs git, so the engine can be given another git (libgit2, on Android).
 */

const packages = fileURLToPath(new URL("../../", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}

const files = [
  ...sources(join(packages, "server/src")),
  ...readdirSync(join(packages, "modules"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => {
      try {
        return sources(join(packages, "modules", e.name, "src/server"));
      } catch {
        return [];
      }
    }),
];

/** The ways to run git: simple-git, and git.ts's runners and classifier. */
const RUNS_GIT = [/from "simple-git"/, /import \{[^}]*\b(git|gitPlumbing|classifyGitError)\b[^}]*\} from "[./]*git\.ts"/, /import \{[^}]*\bgit\b[^}]*\} from "@writer\/server"/];
const ALLOWED = new Set(["server/src/git.ts", "server/src/git-port/node.ts"]);

describe("the git boundary", () => {
  it("leaves running git to the Node adapter", () => {
    const offenders = files
      .map((f) => relative(packages, f))
      .filter((f) => !ALLOWED.has(f))
      .filter((f) => RUNS_GIT.some((re) => re.test(readFileSync(join(packages, f), "utf8"))));
    expect(offenders).toEqual([]);
  });

  it("is checked against the files it should be", () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files.map((f) => relative(packages, f))).toContain("modules/drafting-board/src/server/board.ts");
  });
});
