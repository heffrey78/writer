import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { git2GitPort } from "../src/git-port/git2.ts";
import { gitFailure, type CloneProgress, type GitErrorCode, type GitPort } from "../src/git-port/port.ts";

/**
 * The git port over libgit2 (packages/git2-port), for the contract suite on the desktop: its stdio
 * binary, one request per line. On Android the same Rust is called in process instead (#52).
 */

export const BINARY = fileURLToPath(new URL("../../git2-port/target/release/git2-port", import.meta.url));

/** Whether the binary is built (`cargo build --release` in packages/git2-port): the suite runs it where it is. */
export const built = () => existsSync(BINARY);

export function rustGitPort(binary = BINARY): GitPort & { close(): void } {
  let child: ChildProcessWithoutNullStreams | undefined;
  let next = 0;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void; progress?: (p: CloneProgress) => void }>();

  const start = () => {
    const c = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    createInterface({ input: c.stdout }).on("line", (line) => {
      const answer = JSON.parse(line) as { id: number; ok?: unknown; progress?: CloneProgress; err?: { code: GitErrorCode; message: string } };
      const w = waiting.get(answer.id);
      if (answer.progress) return void w?.progress?.(answer.progress);
      waiting.delete(answer.id);
      if (answer.err) w?.reject(gitFailure(answer.err.code, answer.err.message));
      else w?.resolve(answer.ok);
    });
    c.on("exit", () => {
      for (const w of waiting.values()) w.reject(gitFailure("GIT", "git2-port stopped"));
      waiting.clear();
      child = undefined;
    });
    return c;
  };

  const port = git2GitPort(
    (op, dir, args, progress) =>
      new Promise((resolve, reject) => {
        child ??= start();
        const id = ++next;
        waiting.set(id, { resolve, reject, ...(progress ? { progress } : {}) });
        child.stdin.write(JSON.stringify({ id, op, dir, args }) + "\n");
      }),
  );
  return Object.assign(port, { close: () => void child?.kill() });
}
