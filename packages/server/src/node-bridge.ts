import { homedir } from "node:os";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { nodeFilesPort } from "./files-port/node.ts";
import { GitFailure } from "./git-port/port.ts";
import { nodeGitPort } from "./git-port/node.ts";
import type { TokenStore } from "./github.ts";
import { nodeHost } from "./node-host.ts";
import { decode, encode, type HostFacts } from "./remote-ports.ts";

/**
 * The Node side of the remote ports (remote-ports.ts), over HTTP: for the engine in a page, which the
 * tests run as Android does, with git, the disk, GitHub's HTTP and the token here. POST /call runs one
 * operation; GET /events streams the page's watches. Mounted at /bridge, behind the session check.
 */

/** The environment the engine reads: the writer's git identity, and the GitHub to use (tests point it at a fake). */
const SHARED_ENV = /^(GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL)|WRITER_GITHUB_(CLIENT_ID|URL|API_URL))$/;

/** `stopped`: the server is closing: event streams end and watches stop, so it can. */
export function bridgeRoutes({ store, syncMs, stopped }: { store: TokenStore; syncMs?: number; stopped?: AbortSignal }): Hono {
  const routes = new Hono();
  const watches = new Map<string, () => Promise<void>>();
  const listeners = new Set<(e: { watch: string; type: string; path: string }) => void>();
  let n = 0;
  stopped?.addEventListener("abort", () => {
    for (const stop of watches.values()) void stop();
    watches.clear();
  });

  const run = async (port: string, op: string, args: unknown[]): Promise<unknown> => {
    switch (port) {
      case "git": {
        const fn = (nodeGitPort as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[op];
        if (!fn) throw new Error(`No git operation ${op}.`);
        return fn(...args);
      }
      case "files": {
        if (op === "watch") {
          const watch = `w${++n}`;
          watches.set(watch, await nodeFilesPort.watch(args[0] as string, () => false, (type, path) => listeners.forEach((l) => l({ watch, type, path }))));
          return watch;
        }
        if (op === "unwatch") {
          await watches.get(args[0] as string)?.();
          watches.delete(args[0] as string);
          return null;
        }
        const fn = (nodeFilesPort as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[op];
        if (!fn) throw new Error(`No files operation ${op}.`);
        return fn(...args);
      }
      case "host": {
        if (op !== "facts") throw new Error(`No host operation ${op}.`);
        const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => SHARED_ENV.test(k)));
        const facts: HostFacts = {
          env,
          configDir: nodeHost.configDir(),
          booksDir: nodeHost.booksDir(),
          ...(nodeHost.ghWriterConfigDir() ? { ghWriterConfigDir: nodeHost.ghWriterConfigDir()! } : {}),
          templates: nodeHost.templates(),
          home: homedir(),
          cwd: process.cwd(),
          ...(syncMs !== undefined ? { syncMs } : {}),
        };
        return facts;
      }
      case "http": {
        const r = args[0] as { url: string; method: string; headers: [string, string][]; body?: Uint8Array };
        const res = await fetch(r.url, { method: r.method, headers: r.headers, ...(r.body ? { body: r.body as Uint8Array<ArrayBuffer> } : {}) });
        return { status: res.status, headers: [...res.headers], body: new Uint8Array(await res.arrayBuffer()) };
      }
      case "secrets":
        if (op === "get") return (await store.get()) ?? null;
        if (op === "set") return void (await store.set(args[0] as string));
        if (op === "delete") return void (await store.delete());
        throw new Error(`No secrets operation ${op}.`);
      default:
        throw new Error(`No port ${port}.`);
    }
  };

  routes.post("/call", async (c) => {
    const { port, op, args } = (await c.req.json()) as { port: string; op: string; args: unknown[] };
    try {
      return c.json({ ok: encode(await run(port, op, decode(args) as unknown[])) });
    } catch (e) {
      if (e instanceof GitFailure) return c.json({ err: { code: e.code, message: e.message, detail: e.detail } }, 400);
      const code = (e as { code?: unknown }).code;
      return c.json({ err: { ...(typeof code === "string" ? { code } : {}), message: e instanceof Error ? e.message : String(e) } }, 500);
    }
  });

  routes.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const send = (e: unknown) => void stream.writeSSE({ event: "watch", data: JSON.stringify(e) });
      listeners.add(send);
      await stream.writeSSE({ event: "ready", data: "{}" });
      await new Promise<void>((done) => {
        stream.onAbort(() => done());
        if (stopped?.aborted) done();
        stopped?.addEventListener("abort", () => done());
      });
      listeners.delete(send);
    }),
  );

  return routes;
}
