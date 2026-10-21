// @vitest-environment jsdom
import { kindByKey } from "@writer/core";
import { novel } from "@writer/kinds";
import { describe, expect, it } from "vitest";
import { moduleOutlineViews, registerWebModule } from "@writer/web/modules.tsx";
import { draftingBoardWeb } from "../../src/web/index.tsx";

/** The drafting board on screen comes from its module (#31): a view of the outline for the Novel, and none without it. */

registerWebModule(draftingBoardWeb);

describe("the drafting board on screen", () => {
  it("is a view of the Novel's outline, and of no kind without the module", () => {
    expect(moduleOutlineViews(kindByKey("novel")).map((v) => [v.key, v.label])).toEqual([["board", "Board"]]);
    expect(moduleOutlineViews({ ...novel, key: "boardless", modules: ["story-time"] })).toEqual([]);
  });
});
