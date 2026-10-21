import { registerKind, registerModule, type BookKind, type BookModule } from "@writer/core";
import { plotlines } from "@writer/module-plotlines/core";
import { pointOfView } from "@writer/module-point-of-view/core";
import { presenceModule } from "@writer/module-presence/core";
import { draftingBoard } from "@writer/module-drafting-board/core";
import { manuscriptFormat } from "@writer/module-manuscript-format/core";
import { offPageEvents } from "@writer/module-off-page-events/core";
import { storyTime } from "@writer/module-story-time/core";
import { novel } from "./novel.ts";

export { novel };

/** Every kind of book the app ships. */
export const KINDS: readonly BookKind[] = [novel];

/** The core halves of the modules the shipped kinds use (D14), from packages/modules. */
export const MODULES: readonly BookModule[] = [pointOfView, plotlines, presenceModule, storyTime, offPageEvents, draftingBoard, manuscriptFormat];

/**
 * Make the shipped modules and kinds known to the base, the modules first: each of the app's entry
 * points calls this once (D14). The web app registers the modules' web halves itself.
 */
export function registerKinds(): void {
  for (const module of MODULES) registerModule(module);
  for (const kind of KINDS) registerKind(kind);
}
