import { Hono } from "hono";
import type { Env } from "./bible-routes.ts";

/*
 * Modules' server halves (D14): the routes a module adds under a book, at /api/novels/:id/<module>/…,
 * answered only for a book whose kind lists the module (404 otherwise). The app's entry points
 * register the modules they ship; the base reads them only through moduleRoutes.
 */

export interface ServerModule {
  /** The module's id, as its kind lists it: its routes' prefix. */
  id: string;
  /** Its routes, relative to its prefix: `routes.put("/calendar", …)` answers PUT /api/novels/:id/story-time/calendar. */
  routes(routes: Hono<Env>): void;
}

const registry = new Map<string, ServerModule>();

/** Make a module's server half known: done by the app's entry points, for each module they ship, before the server starts. */
export function registerServerModule(module: ServerModule): void {
  registry.set(module.id, module);
}

/** Each registered module's routes under a book, for books whose kind lists it. */
export function moduleRoutes(routes: Hono<Env>): void {
  for (const module of registry.values()) {
    const own = new Hono<Env>();
    module.routes(own);
    routes.use(`/:id/${module.id}/*`, async (c, next) => {
      if (!c.var.ws.kind.modules?.includes(module.id)) return c.json({ code: "NOT_FOUND", error: `A ${c.var.ws.kind.label.toLowerCase()} has no ${module.id}.` }, 404);
      await next();
    });
    routes.route(`/:id/${module.id}`, own);
  }
}
