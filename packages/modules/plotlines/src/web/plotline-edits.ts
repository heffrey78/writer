import type { YamlEdit } from "@writer/core";
import { entryEdits } from "@writer/web/novel/entry-edits.ts";
import { PLOTLINES } from "../core/index.ts";

export type PlotlineChange = { link: true } | { remove: true } | { weight: "major" | "minor" } | { beat: string };

/** A change to a scene's link to a plotline (major is the default weight, so it's never written). */
export function plotlineEdits(fm: Record<string, unknown>, plotline: string, change: PlotlineChange): YamlEdit[] {
  if ("link" in change) return entryEdits(fm, PLOTLINES.key, plotline, { add: true });
  if ("remove" in change) return entryEdits(fm, PLOTLINES.key, plotline, { remove: true });
  if ("weight" in change) return entryEdits(fm, PLOTLINES.key, plotline, { field: "weight", value: change.weight === "major" ? undefined : change.weight });
  return entryEdits(fm, PLOTLINES.key, plotline, { field: "beat", value: change.beat.trim() || undefined });
}
