// @vitest-environment jsdom
import { kindByKey, loadBook, withModules, type BookKind } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { novel as novelKind } from "@writer/kinds";
import { registerWebModule } from "@writer/web/modules.tsx";
import { storyMapTabs } from "@writer/web/novel/story-map.tsx";
import { laneModes } from "@writer/web/timeline/timeline-page.tsx";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { plotlinesWeb } from "../../src/web/index.tsx";

/** Plotlines on screen come from the module (#28): the story map's first tab, and lanes by plotline. */

registerWebModule(plotlinesWeb);
// Under jsdom a module's URL isn't a file's: the sample from the repository's root, where the tests run.
const sample = join(process.cwd(), "examples/sample-novel");
const plain: BookKind = { ...novelKind, key: "plain", modules: ["point-of-view"] };

describe("plotlines on screen", () => {
  it("are the story map's first tab and a lane choice for the Novel, and neither without the module", async () => {
    expect(storyMapTabs(kindByKey("novel")).map((t) => t.label)).toEqual(["Plotlines", "Presence", "Timeline"]);
    expect(storyMapTabs(withModules(plain)).map((t) => t.label)).toEqual(["Presence", "Timeline"]);
    expect(laneModes(await loadBook(nodeSource(sample))).map(([, label]) => label)).toEqual(["Point of view", "Location", "Plotline"]);
    expect(laneModes(await loadBook(nodeSource(sample), plain)).map(([, label]) => label)).toEqual(["Point of view", "Location"]);
  });
});
