// @vitest-environment jsdom
import "../../editor/test/dom.ts";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { loadBook, type Book } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { getMarkdown } from "@writer/editor";
import { SceneEditor } from "@writer/editor/react";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { join } from "node:path";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BookKindContext } from "../src/novel/kind.ts";
import { usePictures } from "../src/novel/use-pictures.tsx";

/** The picture flow a note's page shares with the writing view (#200). */

const sample = join(import.meta.dirname, "../../../examples/sample-campaign");
let book: Book;
beforeAll(async () => void (book = await loadBook(nodeSource(sample))));
afterEach(() => cleanup());

const NOTE = 'The ford is shallow in summer.\n\n![A map of the ford](/images/ford.jpg "Drawn by Hale")\n\nAsk  the ferryman.\n';

function mount(markdown = NOTE) {
  const onChange = vi.fn();
  let editor: Editor | undefined;
  let tools: ReturnType<typeof usePictures> | undefined;
  function Page() {
    const [ready, setReady] = useState<Editor>();
    const pictures = (tools = usePictures("book"));
    editor = ready;
    return (
      <>
        <SceneEditor sceneId="notes/the-ford.md" label="Note: The ford" markdown={markdown} onChange={onChange} pictureUrl={pictures.pictureUrl} pictures={pictures.picturesFor(() => ready)} onReady={setReady} />
        {pictures.dialog}
      </>
    );
  }
  render(
    <BookKindContext.Provider value={book.kind}>
      <Page />
    </BookKindContext.Provider>,
  );
  return { onChange, editor: () => editor!, tools: () => tools! };
}

const picturePos = (editor: Editor) => {
  let at = -1;
  editor.state.doc.forEach((node, pos) => void (node.type.name === "picture" && at < 0 && (at = pos)));
  return at;
};

describe("usePictures", () => {
  it("leaves a note with a picture as it was, byte for byte", () => {
    const { editor, onChange } = mount();
    expect(getMarkdown(editor())).toBe(NOTE);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("asks for a new picture at the caret, with Insert a picture", async () => {
    const { editor, tools } = mount();
    await act(async () => tools().ask(editor()));
    expect(await screen.findByRole("dialog", { name: "Insert a picture" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose a picture…" })).toBeTruthy();
  });

  it("describes the picture it's given, its description and caption filled in, and saves only those", async () => {
    const { editor, tools } = mount();
    const at = picturePos(editor());
    await act(async () => tools().picturesFor(editor).edit!(at));
    expect(await screen.findByRole("dialog", { name: "Change the picture" })).toBeTruthy();
    const description = screen.getByLabelText("Description") as HTMLInputElement;
    expect(description.value).toBe("A map of the ford");
    expect(document.activeElement).toBe(description);
    expect((screen.getByLabelText("Caption (optional)") as HTMLInputElement).value).toBe("Drawn by Hale");
    fireEvent.change(description, { target: { value: "The ford, mapped" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(getMarkdown(editor())).toBe(NOTE.replace("A map of the ford", "The ford, mapped")));
  });

  it("Change… opens the same dialog at Choose another…", async () => {
    const { editor, tools } = mount();
    const at = picturePos(editor());
    act(() => editor().view.dispatch(editor().state.tr.setSelection(NodeSelection.create(editor().state.doc, at))));
    await act(async () => tools().picturesFor(editor).change!(at));
    await screen.findByRole("dialog", { name: "Change the picture" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Choose another…" }));
  });
});
