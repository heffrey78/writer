// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { loadBook, memorySource, type BookKind } from "@writer/core";
import { novel } from "@writer/kinds";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { allCommands, useCommandRegistry } from "../src/commands.ts";
import { ManuscriptTree } from "../src/novel/manuscript-tree.tsx";
import { groups } from "../src/novel/sidebar.tsx";
import type { Structure } from "../src/novel/structure.ts";

/** The words on screen come from the kind (#22): a diary's tree says months and days, never chapters and scenes. */

const diary: BookKind = {
  ...novel,
  key: "diary",
  label: "Diary",
  plural: "Diaries",
  levels: [{ key: "month", label: "Month", plural: "Months", prefix: "mon", list: "months" }],
  piece: { key: "day", label: "Day", plural: "Days", prefix: "day", list: "days" },
  folders: { ...novel.folders, content: "pages", codex: "index" },
  words: { content: { label: "Pages", plural: "Pages" }, codex: { label: "Index", plural: "Indexes" }, entity: { label: "Item", plural: "Items" } },
};

const lines = (...l: string[]) => `${l.join("\n")}\n`;
const book = (kind: BookKind) =>
  loadBook(
    memorySource({
      "novel.yaml": lines("schema_version: 2", "id: nv_000001", "title: The Year"),
      "pages/_order.yaml": lines("months: [mon_000001]"),
      "pages/01-march/_month.yaml": lines("id: mon_000001", "title: March", "days: [day_000001]"),
      "pages/01-march/01-monday.md": lines("---", "id: day_000001", "title: Monday", "---", "Words."),
    }),
    kind,
  );

const titles = () => allCommands(useCommandRegistry.getState().owners).map((c) => `${c.group}: ${c.title}`);

afterEach(cleanup);

describe("a kind's words on screen", () => {
  it("name the tree and its commands", async () => {
    const b = await book(diary);
    render(
      <MemoryRouter>
        <ManuscriptTree novelId="lib_1" novel={b} structure={{} as Structure} current="day_000001" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("tree", { name: "Pages" })).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "Pages actions" })).toBeTruthy();
    const said = titles();
    expect(said).toEqual(expect.arrayContaining(["Pages: New day", "Pages: New month", "Pages: Rename day…", "Pages: Move day to month…", "Pages: Delete day"]));
    expect(said.join("\n")).not.toMatch(/scene|chapter|Manuscript/i);
  });

  it("name the codex in the sidebar", () => {
    const plan = groups(false, diary).find((g) => g.label === "Plan")!.places.map((p) => p.label);
    expect(plan).toContain("Index");
    expect(plan).not.toContain("Story bible");
    expect(groups(false, novel).find((g) => g.label === "Plan")!.places.map((p) => p.label)).toContain("Story bible");
  });
});
