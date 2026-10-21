import { body, operation, OperationError, type ServerModule } from "@writer/server/engine";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Story time's server half (#30), under /api/novels/:id/story-time:
 *
 * PUT /calendar  { start } (a date, or null to remove it) → { commit, files }: when Day 1 is, novel.yaml's
 *                calendar.start (heffrey78/gh-writer#239), so days of the story sit among dates (Day 0 the
 *                day before). null removes it, and the calendar with it. One commit.
 */
export const storyTimeServer: ServerModule = {
  id: "story-time",
  routes(routes) {
    routes.put("/calendar", async (c) => {
      const { start } = await body(c);
      return operation(c, async () => {
        if (start !== null && !(typeof start === "string" && DATE.test(start) && !Number.isNaN(Date.parse(`${start}T00:00:00Z`)))) throw new OperationError("BAD_REQUEST", "Day 1 is a date, YYYY-MM-DD.");
        return c.var.ws.bible.editManifest(start === null ? [{ path: ["calendar"], remove: true }] : [{ path: ["calendar", "start"], value: start }], start === null ? "Day 1 has no date" : "Set when Day 1 is");
      });
    });
  },
};
