// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allCommands, keyCaps, useCommandRegistry, useCommands, type Command } from "../src/commands.ts";

const titles = () => allCommands(useCommandRegistry.getState().owners).map((c) => c.title);

function Owner({ commands }: { commands: Command[] }) {
  useCommands(() => commands, [commands]);
  return null;
}

const command = (id: string, title = id): Command => ({ id, title, group: "Test", run: vi.fn() });

afterEach(cleanup);

describe("command registry", () => {
  it("offers a view's commands while it's mounted, and updates them with it", () => {
    const first = [command("a", "Alpha")];
    const view = render(<Owner commands={first} />);
    expect(titles()).toEqual(["Alpha"]);
    view.rerender(<Owner commands={[command("a", "Alpha"), command("b", "Beta")]} />);
    expect(titles()).toEqual(["Alpha", "Beta"]);
    view.unmount();
    expect(titles()).toEqual([]);
  });

  it("lets a later view replace a command with the same id", () => {
    render(
      <>
        <Owner commands={[command("x", "From the shell")]} />
        <Owner commands={[command("x", "From the editor")]} />
      </>,
    );
    expect(titles()).toEqual(["From the editor"]);
  });
});

describe("keyCaps", () => {
  it("spells shortcuts for this platform", () => {
    expect(keyCaps("Mod-Shift-f")).toEqual(navigator.platform.startsWith("Mac") ? ["⌘", "⇧", "F"] : ["Ctrl", "Shift", "F"]);
    expect(keyCaps("Mod-/")).toHaveLength(2);
  });
});

describe("palette ranking", async () => {
  const { rank } = await import("../src/palette.tsx");
  it("ranks the start of the title first, then anywhere in it, then every word anywhere", () => {
    const score = (title: string, ...keywords: string[]) => (query: string) => rank(`${title} x`, query, [title, ...keywords]);
    expect(score("New location")("new location")).toBe(1);
    expect(score("Location: Tomas's Workshop", "Go to")("new location")).toBe(0);
    expect(score("Scene: Ben's Ledger", "Go to", "Old Debts")("ledger")).toBe(0.8);
    expect(score("Scene: Ben's Ledger", "Go to", "Old Debts")("debts ledger")).toBe(0.5);
    expect(score("Sync now")("")).toBe(1);
  });
});

describe("the palette", async () => {
  const { CommandPalette, useOverlay } = await import("../src/palette.tsx");
  const { act, fireEvent, screen } = await import("@testing-library/react");

  // What cmdk asks of a browser that jsdom hasn't.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};

  it("opens empty, with what was typed the time before gone as it closed", async () => {
    render(
      <>
        <Owner commands={[command("a", "Alpha")]} />
        <CommandPalette />
      </>,
    );
    act(() => useOverlay.getState().set("palette"));
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "alp" } });
    expect(input).toHaveProperty("value", "alp");
    act(() => useOverlay.getState().set(undefined));
    act(() => useOverlay.getState().set("palette"));
    expect(await screen.findByRole("combobox")).toHaveProperty("value", "");
  });
});
