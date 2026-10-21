import { loadBook, storyTimeField, vocabulary } from "@writer/core";
import { body, bookSource, operation, OperationError, type ServerModule } from "@writer/server/engine";
import { entryOn, entryTitle, isDay, placeOf } from "../core/index.ts";

/**
 * Daily writing's server half (#38), under /api/novels/:id/daily:
 *
 * POST /today  { day } (the writer's today, YYYY-MM-DD) → { id, file, made }: the day's entry, made at
 *              the end of its month (in its year), with the month and year as needed, dated in its
 *              `when`, in one commit; or the one there is (made false, no commit).
 */
export const dailyServer: ServerModule = {
  id: "daily",
  routes(routes) {
    routes.post("/today", async (c) => {
      const { day } = await body(c);
      return operation(c, async () => {
        if (!isDay(day)) throw new OperationError("BAD_REQUEST", "A day is a date, YYYY-MM-DD.");
        const ws = c.var.ws;
        const book = await loadBook(bookSource(ws.root), ws.kind);
        const there = entryOn(book, day);
        if (there) return { id: there.id, file: there.file, made: false };
        const time = storyTimeField(book.kind);
        const w = vocabulary(book.kind);
        const { id, file, commit, files } = await ws.manuscript.placePiece(
          placeOf(book, day),
          { title: entryTitle(day), front: time ? { [time.key]: { at: day } } : {} },
          ({ sections, piece }) => `${w.content.One}: ${[...sections.map((s) => `add “${s}”`), `add ${w.piece.one} “${piece}”`].join(", ")}`,
        );
        return { id, file, made: true, commit, files };
      });
    });
  },
};
