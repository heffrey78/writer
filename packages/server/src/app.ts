import { Hono } from "hono";
import { appInfo, licenses, UpdateCheck } from "./app-info.ts";
import { compileRoutes } from "./compile-routes.ts";
import { createEngine } from "./engine.ts";
import { gitInstall } from "./git.ts";
import type { GitHub } from "./github.ts";
import type { Library } from "./library.ts";
import { hasSession, security } from "./security.ts";
import { webRoutes } from "./web.ts";
import type { Workspaces } from "./workspace.ts";

export interface AppOptions {
  token: string;
  /** The listening port, read per request. */
  port: () => number;
  library: Library;
  workspaces: Workspaces;
  github: GitHub;
  /** The built web app's folder (packages/web/dist). Without it, a placeholder page answers. */
  web?: string;
}

/**
 * The Node host's app: the engine's API (engine.ts) behind the security middleware, with what only the
 * host has: its health and git, the app's version and licences, compiling, and the built web app.
 */
export function createApp({ token, port, library, workspaces, github, web }: AppOptions): Hono {
  const app = new Hono();
  app.use(security({ token, port, publicPaths: new Set(["/api/session"]) }));

  // Which git runs (D9): the desktop app's own, or the system's.
  app.get("/api/health", (c) => c.json({ status: "ok", git: gitInstall().bundled ? "bundled" : "system" }));
  app.get("/api/session", (c) => c.json({ authenticated: hasSession(c, token, port()) }));
  // About the app (D9): versions, licences, and a newer release for the desktop app.
  const updates = new UpdateCheck(github.apiUrl);
  app.get("/api/app", async (c) => c.json(await appInfo(updates)));
  app.get("/api/app/licenses", async (c) => c.json({ licenses: await licenses() }));

  app.route("/", createEngine({ library, workspaces, github, novelRoutes: compileRoutes }));

  if (web) {
    app.route("/", webRoutes(web));
    return app;
  }

  // Without a built web app (tests, a bare server), the launch URL lands here.
  const placeholder = (title: string) =>
    `<!doctype html><meta charset="utf-8"><title>Writer</title>\n<p>Writer is running${title ? `: <strong>${escapeHtml(title)}</strong>` : ""}.</p>`;
  app.get("/", (c) => c.html(placeholder("")));
  app.get("/novels/:id", (c) => {
    const novel = library.get(c.req.param("id"));
    return novel ? c.html(placeholder(novel.title)) : c.notFound();
  });

  return app;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
