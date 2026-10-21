import { Hono } from "hono";
import { globalIdentity, setGlobalIdentity } from "./committer.ts";
import { githubRoutes } from "./github-routes.ts";
import type { GitHub } from "./github.ts";
import { libraryRoutes } from "./library-routes.ts";
import type { Library } from "./library.ts";
import { novelRoutes, type NovelRoutesExtra } from "./novel-routes.ts";
import { filesPort, gitPort, host } from "./ports.ts";
import type { Workspaces } from "./workspace.ts";

/**
 * The engine (D16): Writer's server logic, the API over the writer's library and its books, with nothing
 * of Node in it. Its host gives it ports first (setPorts: git, files, the host's facts), then a library,
 * its workspaces and a GitHub connection made with them. On Node, app.ts wraps it with the session
 * check, the app's own routes and the built web app; in a browser or on Android, the client calls its
 * fetch in process. test/engine.test.ts checks that nothing it imports reaches node:.
 */
export interface EngineOptions {
  library: Library;
  workspaces: Workspaces;
  github: GitHub;
  /** Routes the host adds to each book's (Node: compiling). */
  novelRoutes?: NovelRoutesExtra;
}

export function createEngine({ library, workspaces, github, novelRoutes: extra }: EngineOptions): Hono {
  const app = new Hono();
  // What a host doesn't answer itself (Node's app.ts does, first): that it's up, and what it is.
  // Up while its host answers: a page's engine is nothing without its ports.
  app.get("/api/health", async (c) => {
    const answering = await filesPort()
      .stat(host().configDir())
      .then(
        () => true,
        () => false,
      );
    return answering ? c.json({ status: "ok" }) : c.json({ status: "unreachable" }, 503);
  });
  app.get("/api/app", async (c) => c.json({ desktop: false, version: null, node: null, git: { version: await gitPort().version().catch(() => null), bundled: false }, update: null }));
  app.get("/api/app/licenses", (c) => c.json({ licenses: [] }));
  // Who git signs as (heffrey78/gh-writer#186): the name and email set on this computer, and one from the GitHub account.
  app.get("/api/identity", async (c) =>
    c.json({ identity: await globalIdentity(), suggestion: (await github.suggestedIdentity().catch(() => undefined)) ?? null }),
  );
  app.put("/api/identity", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; email?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!name || !/^[^\s@]+@[^\s@]+$/.test(email)) return c.json({ code: "BAD_IDENTITY", error: "Give a name and an email address." }, 400);
    await setGlobalIdentity({ name, email });
    // Work that waited for a name and email is committed now.
    await workspaces.retryIdentity();
    return c.json({ identity: { name, email } });
  });
  app.route("/api/library", libraryRoutes(library, github));
  app.route("/api/novels", novelRoutes(library, workspaces, github, extra));
  app.route("/api/github", githubRoutes(github));
  return app;
}
