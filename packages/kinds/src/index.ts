import { registerKind, registerModule, type BookKind, type BookModule } from "@writer/core";
import { plotlines } from "@writer/module-plotlines/core";
import { pointOfView } from "@writer/module-point-of-view/core";
import { presenceModule } from "@writer/module-presence/core";
import { daily } from "@writer/module-daily/core";
import { draftingBoard } from "@writer/module-drafting-board/core";
import { manuscriptFormat } from "@writer/module-manuscript-format/core";
import { offPageEvents } from "@writer/module-off-page-events/core";
import { storyTime } from "@writer/module-story-time/core";
import { toJournalModule } from "@writer/module-to-journal/core";
import { campaign } from "./campaign.ts";
import { journal } from "./journal.ts";
import { nonfiction } from "./nonfiction.ts";
import { novel } from "./novel.ts";

export { campaign, journal, nonfiction, novel };

/** Every kind of book the app ships: the Novel first. */
export const KINDS: readonly BookKind[] = [novel, journal, campaign, nonfiction];

/** The core halves of the modules the shipped kinds use (D14), from packages/modules. */
export const MODULES: readonly BookModule[] = [pointOfView, plotlines, presenceModule, storyTime, offPageEvents, draftingBoard, manuscriptFormat, daily, toJournalModule];

/**
 * Make the shipped modules and kinds known to the base, the modules first: each of the app's entry
 * points calls this once (D14). The web app registers the modules' web halves itself.
 */
export function registerKinds(): void {
  for (const module of MODULES) registerModule(module);
  for (const kind of KINDS) registerKind(kind);
}
