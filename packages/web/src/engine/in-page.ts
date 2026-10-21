import { registerKinds } from "@writer/kinds";
import { useCompiledKindSchemas } from "@writer/kinds/compiled-schemas";
import { dailyServer } from "@writer/module-daily/server";
import { draftingBoardServer } from "@writer/module-drafting-board/server";
import { offPageEventsServer } from "@writer/module-off-page-events/server";
import { storyTimeServer } from "@writer/module-story-time/server";
import { Channel, invoke } from "@tauri-apps/api/core";
import { keepTextWith } from "./kept.ts";
import {
  createEngine,
  git2GitPort,
  GitHub,
  GITHUB_CLIENT_ID,
  gitFailure,
  httpChannel,
  Library,
  registerServerModule,
  remoteFetch,
  remoteFilesPort,
  remoteGitPort,
  remoteHost,
  remoteTokenStore,
  setPorts,
  Workspaces,
  type GitErrorCode,
  type GitPort,
  type PortChannel,
} from "@writer/server/engine";

/**
 * The engine in the page (#51, D16), as Android runs it: Writer's server logic here, its git, files,
 * GitHub's HTTP and the token through a channel to the host. A service worker (/engine-sw.js) hands it
 * every request the page makes to /api/, so the app talks to it as to a server.
 */
/** `git`: the host's own git port, where it has one (Android's); else git through the channel too. */
export async function startEngine(channel: PortChannel, git: GitPort = remoteGitPort(channel)): Promise<void> {
  registerKinds();
  // The page's CSP forbids compiling the schemas here: the shipped kinds' are compiled ahead of time.
  useCompiledKindSchemas();
  for (const module of [storyTimeServer, offPageEventsServer, draftingBoardServer, dailyServer]) registerServerModule(module);
  const host = await remoteHost(channel);
  const files = remoteFilesPort(channel);
  setPorts({ git, files, host });
  // Unsaved text, kept on the host's disk rather than the page's storage (kept.ts says why).
  const unsaved = files.join(host.configDir(), "unsaved.json");
  const before = await files.read(unsaved);
  keepTextWith(before ? (JSON.parse(new TextDecoder().decode(before)) as Record<string, string>) : {}, (all) => files.write(unsaved, JSON.stringify(all)));
  const env = host.env();
  const github = new GitHub({
    clientId: env.WRITER_GITHUB_CLIENT_ID || GITHUB_CLIENT_ID,
    ...(env.WRITER_GITHUB_URL ? { webUrl: env.WRITER_GITHUB_URL } : {}),
    ...(env.WRITER_GITHUB_API_URL ? { apiUrl: env.WRITER_GITHUB_API_URL } : {}),
    store: remoteTokenStore(channel),
    fetch: remoteFetch(channel),
  });
  const library = await Library.open();
  const { syncMs } = host.facts;
  const workspaces = new Workspaces(library, { github, ...(syncMs !== undefined ? { sync: syncMs === 0 ? false : { intervalMs: syncMs } } : {}) });
  const engine = createEngine({ library, workspaces, github });
  // The host lost: the books' event streams end, so the app asks whether Writer answers, and hears it
  // doesn't (its health is the host's). Back: the books are opened afresh, watched on the host anew.
  channel.listen(
    () => {},
    (up) => void (up ? workspaces.close() : workspaces.stop()),
  );
  await serveThroughWorker(async (request) => engine.fetch(request));
}

/** The engine over HTTP to a Node bridge at `base`: the tests' host (writer serve --engine-in-page). */
export const bridgeChannel = (base: string) => httpChannel(base);

/**
 * The engine's host in the Android app (packages/mobile): its Rust, through Tauri's invoke. `git`
 * runs libgit2 there (git2-port), a clone's progress coming back on a channel of its own; `port` the
 * files, host, http and secrets ports; and one channel, opened by `listen`, carries every watch's
 * events, handed to whoever listens here.
 */
export function tauriHost(): [PortChannel, GitPort] {
  const listeners = new Set<Parameters<PortChannel["listen"]>[0]>();
  let events: Channel<{ watch: string; type: "add" | "change" | "unlink"; path: string }> | undefined;
  const channel: PortChannel = {
    // The Rust answers null where the Node bridge leaves the answer out: undefined, as a port returns it.
    call: async (port, op, args) => (await invoke("port", { port, op, args })) ?? undefined,
    listen: (onEvent) => {
      if (!events) {
        events = new Channel((e) => listeners.forEach((l) => l(e)));
        void invoke("listen", { events });
      }
      listeners.add(onEvent);
      return () => void listeners.delete(onEvent);
    },
  };
  const git = git2GitPort(async (op, dir, args, onProgress) => {
    const progress = new Channel<Parameters<NonNullable<typeof onProgress>>[0]>((p) => onProgress?.(p));
    try {
      return await invoke("git", { op, dir, args, progress });
    } catch (e) {
      const f = e as { code?: GitErrorCode; message?: string };
      throw gitFailure(f?.code ?? "GIT", f?.message ?? String(e));
    }
  });
  return [channel, git];
}

/** Register the service worker, answer what it hands over, and resolve once it controls the page. */
async function serveThroughWorker(handle: (request: Request) => Promise<Response>): Promise<void> {
  navigator.serviceWorker.addEventListener("message", (e: MessageEvent) => {
    const data = e.data as { type?: string; method: string; url: string; headers: [string, string][]; body?: ArrayBuffer };
    if (data?.type !== "writer-request") return;
    void respond(e.ports[0]!, data, handle);
  });
  await navigator.serviceWorker.register("/engine-sw.js", { scope: "/" });
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
  }
}

async function respond(port: MessagePort, data: { method: string; url: string; headers: [string, string][]; body?: ArrayBuffer }, handle: (request: Request) => Promise<Response>): Promise<void> {
  try {
    const res = await handle(new Request(data.url, { method: data.method, headers: data.headers, ...(data.body ? { body: data.body } : {}) }));
    const empty = !res.body || data.method === "HEAD" || [101, 204, 205, 304].includes(res.status);
    port.postMessage({ type: "head", status: res.status, headers: [...res.headers], empty });
    if (empty) return;
    const reader = res.body!.getReader();
    port.onmessage = (m: MessageEvent) => {
      if ((m.data as { type?: string })?.type === "cancel") void reader.cancel();
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.slice().buffer;
      port.postMessage({ type: "chunk", chunk }, [chunk]);
    }
    port.postMessage({ type: "end" });
  } catch (e) {
    port.postMessage({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
}
