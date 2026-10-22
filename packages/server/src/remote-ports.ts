import type { FileEventType, FilesPort } from "./files-port/port.ts";
import type { GitPort } from "./git-port/port.ts";
import { gitFailure, type GitErrorCode } from "./git-port/port.ts";
import { fromBase64, toBase64 } from "./base64.ts";
import type { TokenStore } from "./github.ts";
import type { Host } from "./ports.ts";

/**
 * Ports whose work is done elsewhere (D16): the engine in a page, its git, files and secrets in the
 * host's own code, reached by a channel: over HTTP to a Node bridge (node-bridge.ts) for the tests, or
 * through Tauri's invoke on Android. A call names the port and the operation and carries its arguments
 * as JSON, bytes and maps encoded (`encode`); what can't cross (a clone's progress, an abort signal, a
 * test's write hook) stays on this side, and a watch's events come back on the channel's listener.
 */

export interface PortChannel {
  call(port: "git" | "files" | "host" | "http" | "secrets", op: string, args: unknown[]): Promise<unknown>;
  /**
   * Watch events for the watches this side started, as `{ watch, type, path }`; and, with
   * `onConnection`, when the host is lost (false) and back (true).
   */
  listen(onEvent: (e: { watch: string; type: FileEventType; path: string }) => void, onConnection?: (up: boolean) => void): () => void;
}

/** A value made fit for JSON: bytes as base64, maps as entries; the rest as it is. */
export function encode(value: unknown): unknown {
  if (value instanceof Uint8Array) return { $bytes: toBase64(value) };
  if (value instanceof Map) return { $map: [...value].map(([k, v]) => [k, encode(v)]) };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v !== "function" && !(v instanceof AbortSignal)).map(([k, v]) => [k, encode(v)]));
  return value;
}

/** `encode`'s value back. */
export function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.$bytes === "string") return fromBase64(o.$bytes);
    if (Array.isArray(o.$map)) return new Map((o.$map as [unknown, unknown][]).map(([k, v]) => [k, decode(v)]));
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, decode(v)]));
  }
  return value;
}

/** A failure as the channel reports one: a git failure keeps its code. */
export interface RemoteFailure {
  code?: string;
  message: string;
  detail?: string;
}

async function called(channel: PortChannel, port: Parameters<PortChannel["call"]>[0], op: string, args: unknown[]): Promise<unknown> {
  try {
    return decode(await channel.call(port, op, args.map(encode)));
  } catch (e) {
    const f = e as RemoteFailure;
    if (port === "git" && f?.code) throw gitFailure(f.code as GitErrorCode, f.detail ?? f.message);
    throw Object.assign(new Error(f?.message ?? String(e)), f?.code ? { code: f.code } : {});
  }
}

/** Every operation of a port, by name, as a call on the channel. */
function proxy<T extends object>(channel: PortChannel, port: "git" | "files", local: Partial<T> = {}): T {
  return new Proxy(local as T, {
    get: (target, op: string) => (op in target ? target[op as keyof T] : (...args: unknown[]) => called(channel, port, op, args)),
  });
}

export function remoteGitPort(channel: PortChannel): GitPort {
  return proxy<GitPort>(channel, "git");
}

/** The files port through the channel: "/"-separated paths, as on Android and Linux; watching by the channel's events. */
export function remoteFilesPort(channel: PortChannel): FilesPort {
  const watchers = new Map<string, (type: FileEventType, path: string) => void>();
  channel.listen((e) => watchers.get(e.watch)?.(e.type, e.path));
  const norm = (p: string) => `/${p.split("/").filter(Boolean).join("/")}`;
  return proxy<FilesPort>(channel, "files", {
    join: (root, ...parts) => norm([root, ...parts].join("/")),
    dirname: (path) => norm(path.split("/").slice(0, -1).join("/")),
    relative: (root, path) => {
      const [r, p] = [norm(root), norm(path)];
      if (p === r) return "";
      return p.startsWith(r === "/" ? "/" : `${r}/`) ? p.slice(r === "/" ? 1 : r.length + 1) : undefined;
    },
    // The write hook is a test's, on this side: it isn't carried.
    write: (path, data) => called(channel, "files", "write", [path, typeof data === "string" ? new TextEncoder().encode(data) : data]) as Promise<void>,
    watch: async (root, ignore, onChange) => {
      const watch = (await called(channel, "files", "watch", [root])) as string;
      watchers.set(watch, (type, path) => {
        if (!ignore(path)) onChange(type, path);
      });
      return async () => {
        watchers.delete(watch);
        await called(channel, "files", "unwatch", [watch]);
      };
    },
  });
}

/** What the host knows of itself, read once: its environment, folders, home and working folder. */
export interface HostFacts {
  env: Record<string, string | undefined>;
  configDir: string;
  booksDir: string;
  ghWriterConfigDir?: string;
  templates: string;
  home: string;
  cwd: string;
  /** How often its books sync, where the host says (writer serve --sync-every); 0: only on demand. */
  syncMs?: number;
}

/** The host's facts, read once through the channel, as the engine's Host: "/"-separated paths. */
export async function remoteHost(channel: PortChannel): Promise<Host & { facts: HostFacts }> {
  const facts = (await called(channel, "host", "facts", [])) as HostFacts;
  const norm = (p: string) => `/${p.split("/").filter(Boolean).join("/")}`;
  return {
    facts,
    env: () => facts.env,
    configDir: () => facts.configDir,
    booksDir: () => facts.booksDir,
    ghWriterConfigDir: () => facts.ghWriterConfigDir,
    templates: () => facts.templates,
    absolute: (path) => {
      const p = path.trim();
      if (p === "~" || p.startsWith("~/")) return norm(`${facts.home}/${p.slice(1)}`);
      return p.startsWith("/") ? norm(p) : norm(`${facts.cwd}/${p}`);
    },
    shown: (path) => (path === facts.home ? "~" : path.startsWith(`${facts.home}/`) ? `~${path.slice(facts.home.length)}` : path),
  };
}

/** fetch, done by the host (no CORS: github.com's device flow answers no browser). */
export function remoteFetch(channel: PortChannel): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const body = request.body ? new Uint8Array(await request.arrayBuffer()) : undefined;
    // A request that got no answer fails as fetch's do, with a TypeError: what the engine takes for
    // GitHub out of reach (github.ts, unreachable), not a fault of its own.
    const r = (await called(channel, "http", "fetch", [{ url: request.url, method: request.method, headers: [...request.headers], ...(body ? { body } : {}) }]).catch((e: unknown) => {
      throw new TypeError(e instanceof Error ? e.message : String(e));
    })) as { status: number; headers: [string, string][]; body: Uint8Array };
    return new Response(r.status === 204 || r.status === 304 ? null : (r.body as Uint8Array<ArrayBuffer>), { status: r.status, headers: r.headers });
  };
}

/** The GitHub token, kept by the host (the keychain; Android's keystore). */
export function remoteTokenStore(channel: PortChannel): TokenStore {
  return {
    get: async () => ((await called(channel, "secrets", "get", [])) as string | null) ?? undefined,
    set: async (token) => void (await called(channel, "secrets", "set", [token])),
    delete: async () => void (await called(channel, "secrets", "delete", [])),
  };
}

/** The channel to a Node bridge (node-bridge.ts) at `base` ("/bridge"), over HTTP: the tests' way to Android's. */
export function httpChannel(base: string): PortChannel {
  return {
    call: async (port, op, args) => {
      const res = await fetch(`${base}/call`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ port, op, args }), credentials: "same-origin" });
      const answer = (await res.json()) as { ok?: unknown; err?: RemoteFailure };
      if (answer.err) throw answer.err;
      return answer.ok;
    },
    // The event stream read with fetch, which Node has as browsers do (EventSource it hasn't); lost, it's
    // tried again each second until the host is back.
    listen: (onEvent, onConnection) => {
      const stop = new AbortController();
      void (async () => {
        let lost = false;
        while (!stop.signal.aborted) {
          try {
            const res = await fetch(`${base}/events`, { credentials: "same-origin", signal: stop.signal });
            if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
            if (lost) onConnection?.(true);
            lost = false;
            const decoder = new TextDecoder();
            let buffer = "";
            for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
              buffer += decoder.decode(chunk, { stream: true });
              let end;
              while ((end = buffer.indexOf("\n\n")) !== -1) {
                const block = buffer.slice(0, end);
                buffer = buffer.slice(end + 2);
                if (!/^event: ?watch$/m.test(block)) continue;
                const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
                onEvent(JSON.parse(data) as Parameters<typeof onEvent>[0]);
              }
            }
          } catch {
            // Gone, or never there: said once, then tried again.
          }
          if (stop.signal.aborted) break;
          if (!lost) onConnection?.(false);
          lost = true;
          await new Promise((r) => setTimeout(r, 1000));
        }
      })();
      return () => stop.abort();
    },
  };
}
