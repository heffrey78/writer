// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { loadBook, memorySource, type Book, type BookKind } from "@writer/core";
import { novel } from "@writer/kinds";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { allCommands, useCommandRegistry } from "../src/commands.ts";
import { BiblePage } from "../src/bible/bible-page.tsx";
import { BookKindContext } from "../src/novel/kind.ts";
import { PromoteNoteDialog } from "../src/notes/promote.tsx";
import { CompileDialog } from "../src/novel/compile.tsx";
import { OutlineCards } from "../src/novel/corkboard.tsx";
import { ManuscriptTree } from "../src/novel/manuscript-tree.tsx";
import { OutlineTable } from "../src/novel/outline.tsx";
import { StructureCommands } from "../src/novel/structure-commands.tsx";
import type { Workspace } from "../src/novel/workspace.ts";
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
  words: { content: { label: "Pages", plural: "Pages" }, codex: { label: "Index", plural: "Indexes", article: "an" }, entity: { label: "Item", plural: "Items", article: "an" } },
};

const lines = (...l: string[]) => `${l.join("\n")}\n`;
const book = (kind: BookKind) =>
  loadBook(
    memorySource({
      "novel.yaml": lines("schema_version: 2", "id: nv_000001", "title: The Year"),
      "pages/_order.yaml": lines("months: [mon_000001]"),
      "pages/01-march/_month.yaml": lines("id: mon_000001", "title: March", "days: [day_000001]"),
      "pages/01-march/01-monday.md": lines("---", "id: day_000001", "title: Monday", "characters: [char_000001]", "---", "Words."),
      "index/characters/ada.md": lines("---", "id: char_000001", "name: Ada", "---"),
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
        <QueryClientProvider client={new QueryClient()}>
          <ManuscriptTree novelId="lib_1" novel={b} structure={{} as Structure} current="day_000001" />
          <StructureCommands novelId="lib_1" novel={b} workspace={{} as Workspace} current="day_000001" />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole("tree", { name: "Pages" })).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "Pages actions" })).toBeTruthy();
    const said = titles();
    expect(said).toEqual(expect.arrayContaining(["Pages: New day", "Pages: New month", "Pages: Rename day…", "Pages: Move day to month…", "Pages: Delete day"]));
    expect(said.join("\n")).not.toMatch(/scene|chapter|Manuscript/i);
  });

  it("are the book's, not the tree's: the palette has them with no tree on the page", async () => {
    const b = await book(diary);
    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <StructureCommands novelId="lib_1" novel={b} workspace={{} as Workspace} current="day_000001" />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole("tree")).toBeNull();
    expect(titles()).toEqual(expect.arrayContaining(["Pages: New day", "Pages: New month", "Pages: Rename day…", "Pages: Delete day"]));
  });

  it("name the codex in the sidebar", () => {
    const plan = groups(false, diary).find((g) => g.label === "Plan")!.places.map((p) => p.label);
    expect(plan).toContain("Index");
    expect(plan).not.toContain("Story bible");
    expect(groups(false, novel).find((g) => g.label === "Plan")!.places.map((p) => p.label)).toContain("Story bible");
  });

  it("name the codex, its items and the pieces they're in", async () => {
    const b = await book(diary);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BookKindContext.Provider value={b.kind}>
          <MemoryRouter>
            <BiblePage novelId="lib_1" novel={b} />
          </MemoryRouter>
        </BookKindContext.Provider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Index" })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search the index" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New item" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Sort" }).textContent).toContain("Most days");
    expect(screen.getByText("1 day")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/scene|bible|entr(y|ies)/i);
  });

  it("name the outline's pieces and sections", async () => {
    const b = await book(diary);
    const page = (children: ReactNode) =>
      render(
        <QueryClientProvider client={new QueryClient()}>
          <BookKindContext.Provider value={b.kind}>
            <MemoryRouter>{children}</MemoryRouter>
          </BookKindContext.Provider>
        </QueryClientProvider>,
      );
    page(<OutlineCards novelId="lib_1" novel={b} workspace={{} as Workspace} />);
    expect(screen.getByRole("status").textContent).toBe("1 day.");
    cleanup();
    page(<OutlineTable novelId="lib_1" novel={b} workspace={{} as Workspace} />);
    expect(screen.getByRole("columnheader", { name: "Day" })).toBeTruthy();
    expect(screen.getByRole("table").querySelector("caption")!.textContent!.trim()).toBe("Every day in reading order, by month");
  });

  it("name the pieces and sections a note becomes, and what's compiled", async () => {
    const b = await book(diary);
    const page = (children: ReactNode) =>
      render(
        <QueryClientProvider client={new QueryClient()}>
          <BookKindContext.Provider value={b.kind}>
            <MemoryRouter>{children}</MemoryRouter>
          </BookKindContext.Provider>
        </QueryClientProvider>,
      );
    const note = { id: "nt_000001", title: "A thought", file: "notes/a-thought.md", scenes: [], pinned: [], tags: [], body: "" } as unknown as Book["notes"][number];
    page(<PromoteNoteDialog novelId="lib_1" novel={b} workspace={{} as Workspace} note={note} flush={async () => {}} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "A day at the end of a month, the note as its synopsis" }));
    expect(screen.getByRole("combobox", { name: "Month" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Write the day" })).toBeTruthy();
    cleanup();
    page(<CompileDialog novelId="lib_1" novel={b} workspace={{} as Workspace} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Compile the pages" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Some months" })).toBeTruthy();
  });
});
