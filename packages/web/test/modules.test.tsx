// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { Book, BookKind } from "@writer/core";
import { novel } from "@writer/kinds";
import { Users } from "lucide-react";
import { MemoryRouter, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allCommands, useCommandRegistry } from "../src/commands.ts";
import { ModuleCommands, moduleRoutes, registerWebModule } from "../src/modules.tsx";
import { groups } from "../src/novel/sidebar.tsx";
import type { Workspace } from "../src/novel/workspace.ts";

/** Modules' web halves (D14, #26): a fixture module's view and commands, for the kinds that list it. */

const alone = vi.fn();
registerWebModule({
  id: "company",
  views: [{ path: "company", label: "Company", icon: Users, group: "Plan", render: ({ novel }) => <p>Who was there, in {novel.config?.title}</p> }],
  commands: () => [{ id: "company.alone", title: "Show the days spent alone", group: "Company", run: alone }],
});

const sociable: BookKind = { ...novel, modules: ["company"] };
const bookOf = (kind: BookKind) => ({ kind, config: { title: "The Year" } }) as unknown as Book;
const view = (kind: BookKind) => ({ novelId: "lib_1", novel: bookOf(kind), workspace: {} as Workspace });
const titles = () => allCommands(useCommandRegistry.getState().owners).map((c) => `${c.group}: ${c.title}`);

afterEach(cleanup);

describe("a module's web half", () => {
  it("lists its view in its group of the sidebar, after the base's, for a kind that uses it", () => {
    const plan = (kind: BookKind) => groups(false, kind).find((g) => g.label === "Plan")!.places.map((p) => p.label);
    expect(plan(sociable)).toEqual(["Outline", "Story map", "Relationships", "Notes", "Progress", "Story bible", "Company"]);
    expect(plan(novel)).not.toContain("Company");
  });

  it("shows its view at its route under the book", () => {
    render(
      <MemoryRouter initialEntries={["/company"]}>
        <Routes>{moduleRoutes(view(sociable))}</Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Who was there, in The Year")).toBeTruthy();
  });

  it("offers its commands and a way to its view in the palette while the book is open", () => {
    const page = render(
      <MemoryRouter>
        <ModuleCommands {...view(sociable)} />
      </MemoryRouter>,
    );
    expect(titles()).toEqual(["Go to: Company", "Company: Show the days spent alone"]);
    page.unmount();
    expect(titles()).toEqual([]);
    render(
      <MemoryRouter>
        <ModuleCommands {...view(novel)} />
      </MemoryRouter>,
    );
    expect(titles()).toEqual([]);
  });
});
