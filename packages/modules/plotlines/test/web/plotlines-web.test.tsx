// @vitest-environment jsdom
import { kindByKey, withModules, type BookKind } from "@writer/core";
import { novel as novelKind } from "@writer/kinds";
import { registerWebModule } from "@writer/web/modules.tsx";
import { storyMapTabs } from "@writer/web/novel/story-map.tsx";
import { describe, expect, it } from "vitest";
import { plotlinesWeb } from "../../src/web/index.tsx";

/** Plotlines on screen come from the module (#28): the story map's first tab. (Lanes by plotline are story time's.) */

registerWebModule(plotlinesWeb);
const plain: BookKind = { ...novelKind, key: "plain", modules: ["point-of-view"] };

describe("plotlines on screen", () => {
  it("are the story map's first tab for the Novel, and none without the module", () => {
    // Only plotlines' web half is registered here: the other tabs are their own modules' to test.
    expect(storyMapTabs(kindByKey("novel")).map((t) => t.label)).toEqual(["Plotlines"]);
    expect(storyMapTabs(withModules(plain)).map((t) => t.label)).toEqual([]);
  });
});
