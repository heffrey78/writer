import { defineModule, type BookModule } from "@writer/core";

/*
 * The drafting board (D14, #31): the pieces in columns by the kind's statuses, and their mirror on a
 * GitHub Project. Nothing of it is in the book's files (its state is the clone's, in
 * .git/gh-writer/board.json), so its core half only names it for the kinds that list it.
 */
export const draftingBoard: BookModule = defineModule({ id: "drafting-board", label: "Drafting board" });
