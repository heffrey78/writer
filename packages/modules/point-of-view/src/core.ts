import { defineModule } from "@writer/core";

/*
 * Point of view (D14, #27): the character whose piece it is. Its field carries the piece, so presence
 * rings it, the timeline runs a lane for each, and profiles count it, all without knowing this module.
 * Its check wants the point of view among the piece's characters.
 */

export const pointOfView = defineModule({
  id: "point-of-view",
  label: "Point of view",
  fields: [{ key: "pov", label: "Point of view", role: "point of view", carries: true, type: { kind: "entity", entityType: "character" }, outline: { column: true, filter: true } }],
  checks: [
    {
      code: "W_POV_NOT_PRESENT",
      severity: "warning",
      find: (book) =>
        book.allPieces.flatMap((p) => {
          const pov = typeof p.fields["pov"] === "string" ? p.fields["pov"] : undefined;
          const characters = Array.isArray(p.fields["characters"]) ? (p.fields["characters"] as unknown[]) : [];
          return pov && !characters.includes(pov) ? [{ file: p.file, message: `POV character ${pov} is not listed in characters`, pointer: "/pov" }] : [];
        }),
    },
  ],
});
