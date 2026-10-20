// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { kindByKey, loadBook, memorySource, type Book, type BookKind } from "@writer/core";
import { novel } from "@writer/kinds";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { BiblePage } from "@writer/web/bible/bible-page.tsx";
import { mentionEntities } from "@writer/web/bible/types.ts";
import { moduleRecordTypes, registerWebModule } from "@writer/web/modules.tsx";
import { BookKindContext } from "@writer/web/novel/kind.ts";
import type { Workspace } from "@writer/web/novel/workspace.ts";
import { PromoteNoteDialog } from "@writer/web/notes/promote.tsx";
import { offPageEventsWeb } from "../../src/web/index.tsx";

/**
 * Off-page events on screen come from their module (#33): the codex's section of them, @ suggestions,
 * and a note made into one. A kind without the module shows none of it.
 */

registerWebModule(offPageEventsWeb);

const lines = (...l: string[]) => `${l.join("\n")}\n`;
const book = (kind: BookKind) =>
  loadBook(
    memorySource({
      "novel.yaml": lines("schema_version: 2", "id: nv_000001", "title: Test"),
      "manuscript/_order.yaml": lines("chapters: [ch_000001]"),
      "manuscript/01-one/_chapter.yaml": lines("id: ch_000001", "scenes: [sc_000001]"),
      "manuscript/01-one/01.md": lines("---", "id: sc_000001", "title: One", "when: { day: 1 }", "---", "Words."),
      "bible/characters/ada.md": lines("---", "id: char_000001", "name: Ada", "---"),
      "bible/events/flood.md": lines("---", "id: evt_000001", "title: The flood", "when: { day: 0 }", "characters: [char_000001]", "---", "The river rises."),
    }),
    kind,
  );
/** The Novel without off-page events. */
const plain: BookKind = { ...novel, key: "plain-web", modules: ["point-of-view", "plotlines", "presence", "story-time"] };

const page = (b: Book, children: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BookKindContext.Provider value={b.kind}>
        <MemoryRouter>{children}</MemoryRouter>
      </BookKindContext.Provider>
    </QueryClientProvider>,
  );
const note = { id: "note_000001", title: "A thought", file: "notes/a-thought.md", scenes: [], pinned: [], tags: [], body: "" } as unknown as Book["notes"][number];

afterEach(cleanup);

describe("off-page events on screen", () => {
  it("are a section of the codex, @ suggestions, and what a note can become, for the Novel", async () => {
    const b = await book(kindByKey("novel"));
    expect(moduleRecordTypes(b.kind).map((t) => t.def.group)).toEqual(["Off the page"]);
    expect(mentionEntities(b).filter((m) => m.type === "Off the page").map((m) => m.name)).toEqual(["The flood"]);
    page(b, <BiblePage novelId="lib_1" novel={b} />);
    expect(screen.getByRole("heading", { name: /^Off the page/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /The flood/ })).toBeTruthy();
    cleanup();
    page(b, <PromoteNoteDialog novelId="lib_1" novel={b} workspace={{} as Workspace} note={note} flush={async () => {}} open onOpenChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "An off-page event, the note as its note" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Make the event" })).toBeTruthy();
  });

  it("are none of these in a kind without the module", async () => {
    const b = await book(plain);
    expect(moduleRecordTypes(b.kind)).toEqual([]);
    expect(mentionEntities(b).map((m) => m.name)).toEqual(["Ada"]);
    page(b, <BiblePage novelId="lib_1" novel={b} />);
    expect(screen.queryByRole("heading", { name: /^Off the page/ })).toBeNull();
    cleanup();
    page(b, <PromoteNoteDialog novelId="lib_1" novel={b} workspace={{} as Workspace} note={note} flush={async () => {}} open onOpenChange={() => {}} />);
    expect(screen.queryByRole("radio", { name: /off-page event/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Write the scene" })).toBeTruthy();
  });
});
