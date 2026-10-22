// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { Dialog, DropdownMenu } from "radix-ui";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onBack } from "../src/android-back.ts";

/** Android's back: what's open closes first, then the page goes back, then the app is left. */

afterEach(cleanup);

function OpenDialog() {
  const [open, setOpen] = useState(true);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Content aria-describedby={undefined}>
          <Dialog.Title>Drafts</Dialog.Title>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const ways = () => ({ back: vi.fn(), leave: vi.fn() });

describe("Android's back", () => {
  it("closes an open dialog, and neither goes back nor leaves", () => {
    render(<OpenDialog />);
    const way = ways();
    act(() => onBack(true, way));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(way.back).not.toHaveBeenCalled();
    expect(way.leave).not.toHaveBeenCalled();
  });

  it("closes an open menu", () => {
    render(
      <DropdownMenu.Root defaultOpen>
        <DropdownMenu.Trigger>More</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item>Checkpoints…</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>,
    );
    expect(screen.getByRole("menu")).toBeTruthy();
    act(() => onBack(true, ways()));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("goes back a page when nothing is open, and leaves the app from the first page", () => {
    const way = ways();
    onBack(true, way);
    expect(way.back).toHaveBeenCalledOnce();
    onBack(false, way);
    expect(way.leave).toHaveBeenCalledOnce();
  });
});
