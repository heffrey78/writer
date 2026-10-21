import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { memoryStore } from "../src/github.ts";
import { bridgeRoutes } from "../src/node-bridge.ts";
import { httpChannel, type PortChannel } from "../src/remote-ports.ts";

/** A Node bridge (node-bridge.ts) on a port of its own, and the channel to it: the remote ports' other end, as a page reaches it. */
export async function startBridge(): Promise<{ channel: PortChannel; close: () => Promise<void> }> {
  const app = new Hono().route("/bridge", bridgeRoutes({ store: memoryStore() }));
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { channel: httpChannel(`http://127.0.0.1:${port}/bridge`), close: () => new Promise((done) => {
      // The page's event stream stays open: it's cut, as a page closing would.
      (server as unknown as { closeAllConnections(): void }).closeAllConnections();
      server.close(() => done());
    }) };
}
