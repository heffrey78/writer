import { Hono, type Context, type Next } from "hono";
import type { BookKind } from "@writer/core";
import type { Env } from "./bible-routes.ts";
import type { NovelWorkspace } from "./workspace.ts";

/*
 * Modules' server halves (D14): the routes a module adds under a book, at /api/novels/:id/<module>/…,
 * answered only for a book whose kind lists the module (404 otherwise), and what it keeps for an open
 * book (its service: the drafting board's store). The app's entry points register the modules they
 * ship; the base reads them only through moduleRoutes and moduleServices.
 */

export interface ServerModule {
  /** The module's id, as its kind lists it: its routes' prefix. */
  id: string;
  /** Its routes, relative to its prefix: `routes.put("/calendar", …)` answers PUT /api/novels/:id/story-time/calendar. */
  routes?(routes: Hono<Env>): void;
  /**
   * What it keeps for an open book whose kind lists it, made with the book's workspace (the drafting
   * board's store): none where it has nothing to keep (a board without a GitHub connection).
   */
  service?(ws: NovelWorkspace): ModuleService | undefined;
}

/** A module's service for an open book: its routes reach it with `ws.module(id)`. */
export interface ModuleService {
  /** After each sync with GitHub that brought something: the drafting board catches up with github.com. */
  synced?(): Promise<void>;
  /** Calls `fn` when it has news for the book's open pages; they're told with a `module` event naming it. Returns how to stop. */
  onChange?(fn: () => void): () => void;
}

const registry = new Map<string, ServerModule>();

/** Make a module's server half known: done by the app's entry points, for each module they ship, before the server starts. */
export function registerServerModule(module: ServerModule): void {
  registry.set(module.id, module);
}

/** The services of the modules a book's kind lists, by module id, made for its workspace. */
export function moduleServices(kind: BookKind, ws: NovelWorkspace): Map<string, ModuleService> {
  const out = new Map<string, ModuleService>();
  for (const id of kind.modules ?? []) {
    const service = registry.get(id)?.service?.(ws);
    if (service) out.set(id, service);
  }
  return out;
}

/** Each registered module's routes under a book, for books whose kind lists it. */
export function moduleRoutes(routes: Hono<Env>): void {
  for (const module of registry.values()) {
    if (!module.routes) continue;
    const own = new Hono<Env>();
    module.routes(own);
    const only = async (c: Context<Env>, next: Next) => {
      if (!c.var.ws.kind.modules?.includes(module.id)) return c.json({ code: "NOT_FOUND", error: `A ${c.var.ws.kind.label.toLowerCase()} has no ${module.id}.` }, 404);
      await next();
    };
    // The module's own address, and everything under it.
    routes.use(`/:id/${module.id}`, only);
    routes.use(`/:id/${module.id}/*`, only);
    routes.route(`/:id/${module.id}`, own);
  }
}
