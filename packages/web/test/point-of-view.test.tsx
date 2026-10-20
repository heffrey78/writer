// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { kindByKey, loadBook, memorySource, type BookKind } from "@writer/core";
import { novel } from "@writer/kinds";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { BookKindContext } from "../src/novel/kind.ts";
import { OutlineTimeTable } from "../src/novel/outline-time.tsx";
import type { Workspace } from "../src/novel/workspace.ts";
import { laneModes } from "../src/timeline/timeline-page.tsx";

/** Point of view on screen comes from its module (#27): a kind without it offers none. */

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
const plain: BookKind = { ...novel, key: "plain", modules: [] };

afterEach(cleanup);

describe("point of view on screen", () => {
  it("is a lane choice and a column of the outline in story time for the Novel, and neither without the module", async () => {
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
