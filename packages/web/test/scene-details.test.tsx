// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { loadBook, memorySource, type Book, type BookKind } from "@writer/core";
import { splitSceneFile } from "@writer/editor";
import { novel } from "@writer/kinds";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { detailTexts, SceneDetails } from "../src/novel/scene-details.tsx";
import type { Workspace, WorkspaceState } from "../src/novel/workspace.ts";

/** The Scene card from a kind's declared fields (#25): a diary's day has only who was there. */

const diary: BookKind = {
  ...novel,
  key: "diary",
  label: "Diary",
  levels: [{ key: "month", label: "Month", plural: "Months", prefix: "mon", list: "months" }],
  piece: { key: "day", label: "Day", plural: "Days", prefix: "day", list: "days" },
  fields: [{ key: "people", label: "People", type: { kind: "entities", entityType: "character" }, mentionAdds: true }],
};

const lines = (...l: string[]) => `${l.join("\n")}\n`;
const DAY = "manuscript/01-march/01-monday.md";
const text = lines("---", "id: day_000001", "title: Monday", "people: [char_000001, char_000002]", "---", "Words.");
const entry = (id: string, name: string) => lines("---", `id: ${id}`, `name: ${name}`, "---");

const book = () =>
  loadBook(
    memorySource({
      "novel.yaml": lines("schema_version: 2", "id: nv_000001", "title: The Year"),
      "manuscript/_order.yaml": lines("months: [mon_000001]"),
      "manuscript/01-march/_month.yaml": lines("id: mon_000001", "days: [day_000001]"),
      [DAY]: text,
      "bible/characters/ada.md": entry("char_000001", "Ada"),
      "bible/characters/bo.md": entry("char_000002", "Bo"),
    }),
    diary,
  );

/** A workspace with the day open, which records the card's edits. */
function workspace() {
  const store = createStore<WorkspaceState>(() => ({ files: { [DAY]: { path: DAY, ...splitSceneFile(text), disk: text, hash: "h" } }, conflicts: [], error: undefined }));
  return { store, open: async () => {}, editFrontMatter: vi.fn(async () => {}) };
}

function card(b: Book, ws: ReturnType<typeof workspace>) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <SceneDetails novel={b} workspace={ws as unknown as Workspace} path={DAY} title="Monday" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("the Scene card of a kind's own field", () => {
  it("has a row for the field, with its names, and none of the novel's", async () => {
    card(await book(), workspace());
    const details = screen.getByRole("region", { name: "Details of “Monday”" });
    expect([...details.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(["People"]);
    expect(details.querySelector("dd")!.textContent).toContain("Ada, Bo");
    expect(screen.queryByRole("button", { name: "Edit point of view" })).toBeNull();
  });

  it("edits the field's list in place", async () => {
    const ws = workspace();
    card(await book(), ws);
    fireEvent.click(screen.getByRole("button", { name: "Edit people" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove “Bo”" }));
    expect(ws.editFrontMatter).toHaveBeenCalledWith(DAY, [{ path: ["people", 1], remove: true }]);
  });

  it("reads the field for a pinned line", async () => {
    const b = await book();
    expect(detailTexts(b, { people: ["char_000001", "char_000002"] })).toEqual({ people: "Ada, Bo", tags: "" });
  });
});
