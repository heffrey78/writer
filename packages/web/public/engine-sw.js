// The engine in the page (#51, D16): this service worker hands every request the page makes to /api/
// (fetches, pictures, the event stream) to the engine running in the page, and streams its answer
// back. Only installed when the page runs the engine itself (as on Android).

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/api/")) return;
  event.respondWith(answer(event));
});

async function answer(event) {
  const client = (event.clientId && (await self.clients.get(event.clientId))) || (await self.clients.matchAll({ type: "window" }))[0];
  if (!client) return new Response(JSON.stringify({ code: "UNREACHABLE", error: "Writer isn't open." }), { status: 503, headers: { "content-type": "application/json" } });
  const request = event.request;
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  const { port1, port2 } = new MessageChannel();
  client.postMessage({ type: "writer-request", method: request.method, url: request.url, headers: [...request.headers], body }, [port2, ...(body ? [body] : [])]);
  return new Promise((resolve) => {
    let controller;
    let answered = false;
    const stream = new ReadableStream({
      start: (c) => void (controller = c),
      cancel: () => port1.postMessage({ type: "cancel" }),
    });
    port1.onmessage = ({ data }) => {
      if (data.type === "head") {
        answered = true;
        resolve(new Response(data.empty ? null : stream, { status: data.status, headers: data.headers }));
      } else if (data.type === "chunk") controller.enqueue(new Uint8Array(data.chunk));
      else if (data.type === "end") controller.close();
      // Before an answer began, a failure of its own; during one, the stream ends in error.
      else if (data.type === "error" && !answered) resolve(failed(data.message));
      else if (data.type === "error") controller.error(new Error(data.message));
    };
  });
}

function failed(message) {
  return new Response(JSON.stringify({ code: "ENGINE", error: `Writer couldn't answer: ${message}` }), { status: 500, headers: { "content-type": "application/json" } });
}
