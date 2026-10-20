// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { kindByKey, loadBook, memorySource, withModules, type Book, type BookKind } from "@writer/core";
import { novel as novelKind } from "@writer/kinds";
import { registerWebModule } from "@writer/web/modules.tsx";
import { BookKindContext } from "@writer/web/novel/kind.ts";
import { storyMapTabs } from "@writer/web/novel/story-map.tsx";
import type { Workspace } from "@writer/web/novel/workspace.ts";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import { presenceWeb } from "../../src/web/index.tsx";
import { PresencePage } from "../../src/web/presence-page.tsx";

/** Presence on screen comes from the module (#29): the story map's tab, and a matrix for a kind's own type in its words. */

registerWebModule(presenceWeb);
afterEach(cleanup);

/** Days in months, with who was there: a field of the kind's own, and no point of view. */
const diary: BookKind = {
  ...novelKind,
  key: "diary",
  label: "Diary",
  plural: "Diaries",
  levels: [{ key: "month", label: "Month", plural: "Months", prefix: "mon", list: "months" }],
  piece: { key: "day", label: "Day", plural: "Days", prefix: "day", list: "days" },
  words: { ...novelKind.words, content: { label: "Pages", plural: "Pages" } },
  fields: [{ key: "people", label: "People", type: { kind: "entities", entityType: "character" } }],
  modules: ["presence"],
  fieldOrder: [],
  entityTypeOrder: [],
};

const lines = (...l: string[]) => `${l.join("\n")}\n`;
const day = (id: string, title: string, ...front: string[]) => lines("---", `id: ${id}`, `title: ${title}`, ...front, "---", "Words.");
const entry = (id: string, name: string) => lines("---", `id: ${id}`, `name: ${name}`, "---");
const book = () =>
  loadBook(
    memorySource({
      "novel.yaml": lines("schema_version: 2", "id: nv_000001", "title: The Year"),
      "manuscript/_order.yaml": lines("months: [mon_000001]"),
      "manuscript/01-march/_month.yaml": lines("id: mon_000001", "title: March", "days: [day_000001, day_000002]"),
      "manuscript/01-march/01-monday.md": day("day_000001", "Monday", "people: [char_000001]"),
      "manuscript/01-march/02-tuesday.md": day("day_000002", "Tuesday", "people: [char_000002]"),
      "bible/characters/ada.md": entry("char_000001", "Ada"),
      "bible/characters/bo.md": entry("char_000002", "Bo"),
    }),
    diary,
  );

function page(b: Book) {
  const workspace = { store: createStore(() => ({ files: {}, conflicts: [], error: undefined })), open: async () => {}, editFrontMatter: async () => {} } as unknown as Workspace;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <BookKindContext.Provider value={b.kind}>
          <PresencePage novelId="nv_000001" novel={b} workspace={workspace} />
        </BookKindContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("presence on screen", () => {
  it("is a tab of the Novel's story map, and none without the module", () => {
    expect(storyMapTabs(kindByKey("novel")).map((t) => t.label)).toEqual(["Presence"]);
    expect(storyMapTabs(withModules({ ...novelKind, key: "plain", modules: ["point-of-view"] })).map((t) => t.label)).toEqual([]);
  });

  it("shows a kind's own type against its days, in its words, with no point of view", async () => {
    page(await book());
    // Only the type its field lists: the Novel's other types aren't offered.
    expect(within(screen.getByRole("combobox", { name: "Rows" })).getAllByRole("option").map((o) => o.textContent)).toEqual(["Characters"]);
    expect(within(screen.getByRole("combobox", { name: "Show" })).getAllByRole("option").map((o) => o.textContent)).toEqual(["The whole book", "Month: March"]);
    const grid = screen.getByRole("grid", { name: "Characters by day" });
    expect(within(grid).getByRole("gridcell", { name: "Monday: Ada present" })).toBeTruthy();
    expect(within(grid).getByRole("gridcell", { name: "Tuesday: Ada not there" })).toBeTruthy();
    expect(screen.getByText(/listed in the day's people/).textContent).not.toMatch(/point of view|scene/);
    expect(screen.getByRole("combobox", { name: "Sort" }).textContent).toContain("Most days");
  });
});
