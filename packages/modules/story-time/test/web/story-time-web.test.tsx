// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { kindByKey, loadBook, memorySource, type BookKind } from "@writer/core";
import { novel } from "@writer/kinds";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { registerWebModule } from "@writer/web/modules.tsx";
import { BookKindContext } from "@writer/web/novel/kind.ts";
import { storyMapTabs } from "@writer/web/novel/story-map.tsx";
import type { Workspace } from "@writer/web/novel/workspace.ts";
import { storyTimeWeb } from "../../src/web/index.tsx";
import { OutlineTimeTable } from "../../src/web/outline-time.tsx";
import { laneModes } from "../../src/web/timeline-page.tsx";

/**
 * Story time on screen comes from its module (#30): the timeline's tab, its lanes by whatever the
 * kind's fields carry or run lanes by (point of view #27, plotlines #28), and the outline in story time.
 */

registerWebModule(storyTimeWeb);

const lines = (...l: string[]) => `${l.join("\n")}\n`;
const book = (kind: BookKind) =>
  loadBook(
    memorySource({
      "novel.yaml": lines("schema_version: 2", "id: nv_000001", "title: Test"),
      "manuscript/_order.yaml": lines("chapters: [ch_000001]"),
      "manuscript/01-one/_chapter.yaml": lines("id: ch_000001", "scenes: [sc_000001]"),
      "manuscript/01-one/01.md": lines("---", "id: sc_000001", "title: One", "pov: char_000001", "when: { day: 1 }", "---", "Words."),
      "bible/characters/ada.md": lines("---", "id: char_000001", "name: Ada", "---"),
    }),
    kind,
  );
/** The Novel with story time and nothing else. */
const plain: BookKind = { ...novel, key: "plain", modules: ["story-time"] };

afterEach(cleanup);

describe("story time on screen", () => {
  it("is the timeline's tab and an order of the outline, and neither without the module", () => {
    expect(storyMapTabs(kindByKey("novel")).map((t) => t.label)).toEqual(["Timeline"]);
    expect(storyTimeWeb.outlineOrders?.map((o) => o.label)).toEqual(["Story time"]);
    expect(storyMapTabs({ ...novel, key: "none", modules: [] }).map((t) => t.label)).toEqual([]);
  });

  it("runs lanes by plotline for the Novel, and by nothing a kind hasn't", async () => {
    expect(laneModes(await book(kindByKey("novel"))).map(([, label]) => label)).toEqual(["Point of view", "Location", "Plotline"]);
    expect(laneModes(await book(plain)).map(([, label]) => label)).toEqual(["Location"]);
  });

  it("has point of view as a lane choice and a column of the outline in story time for the Novel, and neither without that module", async () => {
    for (const [kind, shown] of [[kindByKey("novel"), true], [plain, false]] as const) {
      const b = await book(kind);
      expect(laneModes(b).map(([, label]) => label).includes("Point of view")).toBe(shown);
      render(
        <QueryClientProvider client={new QueryClient()}>
          <BookKindContext.Provider value={b.kind}>
            <MemoryRouter>
              <OutlineTimeTable novelId="lib_1" novel={b} workspace={{} as Workspace} />
            </MemoryRouter>
          </BookKindContext.Provider>
        </QueryClientProvider>,
      );
      expect(screen.queryByRole("columnheader", { name: "Point of view" }) !== null).toBe(shown);
      cleanup();
    }
  });
});
