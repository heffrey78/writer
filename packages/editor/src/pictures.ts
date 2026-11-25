import { Extension, type Editor } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { insertBlock } from "./structure.ts";

/*
 * Pictures in the prose (D10, heffrey78/gh-writer#203): the editor hands image files dropped or pasted in, and a picture
 * to change (Enter on it, or a double-click), to the app, which asks for its description and caption
 * and saves its file; then puts it in, or changes it, with these commands. Backspace and Delete remove
 * a selected picture like any other block; Alt+↑ and Alt+↓ move it past the block before or after (#200).
 */

export interface PictureAttrs {
  /** As written in the Markdown: /images/<name>, from the repository's root. */
  url: string;
  alt: string;
  caption?: string | null;
}

export interface PictureCallbacks {
  /** Image files dropped or pasted into the text, to put in at `at` (a position in the document). */
  add?: (files: File[], at: number) => void;
  /** The picture at `at` to change: Enter on it while it's selected, or a double-click. */
  edit?: (at: number) => void;
  /** The picture at `at` to replace with another: Change… on its toolbar (#200). */
  change?: (at: number) => void;
}

export const PicturesExtension = Extension.create<{ callbacks: () => PictureCallbacks }>({
  name: "ghwPictures",
  addOptions: () => ({ callbacks: () => ({}) }),
  addProseMirrorPlugins() {
    const callbacks = this.options.callbacks;
    return [
      new Plugin({
        key: ROWS,
        state: {
          init: (_, state) => pictureRows(state.doc),
          apply: (tr, rows) => (tr.docChanged ? pictureRows(tr.doc) : rows),
        },
        props: { decorations: (state) => ROWS.getState(state) },
      }),
      new Plugin({
        key: new PluginKey("ghwPictures"),
        view: (view) => new PictureToolbar(view, callbacks),
        props: {
          handleDrop: (view, event, _slice, moved) => {
            const files = imageFiles(event.dataTransfer);
            const add = callbacks().add;
            if (moved || !files.length || !add) return false;
            event.preventDefault();
            add(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from);
            return true;
          },
          handlePaste: (view, event) => {
            const files = imageFiles(event.clipboardData);
            const add = callbacks().add;
            if (!files.length || !add) return false;
            event.preventDefault();
            add(files, view.state.selection.from);
            return true;
          },
          handleKeyDown: (view, event) => {
            const { selection } = view.state;
            if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
              if (!(selection instanceof NodeSelection) || selection.node.type.name !== "picture") return false;
              event.preventDefault();
              const tr = movePictureTr(view.state, selection.from, event.key === "ArrowUp" ? -1 : 1);
              if (tr) view.dispatch(tr.scrollIntoView());
              return true;
            }
            const edit = callbacks().edit;
            if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || !edit) return false;
            if (!(selection instanceof NodeSelection) || selection.node.type.name !== "picture") return false;
            event.preventDefault();
            edit(selection.from);
            return true;
          },
          handleDoubleClickOn: (view, _pos, node, nodePos) => {
            const edit = callbacks().edit;
            if (node.type.name !== "picture" || !edit) return false;
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)));
            edit(nodePos);
            return true;
          },
        },
      }),
    ];
  },
});

/**
 * A selected picture's small toolbar (#200): Describe…, Change… and Remove, over its top right corner
 * while the text has the focus. A press on it leaves the focus in the text. The keys do the same
 * (Enter, Delete), so it's for a pointer or a finger, and out of the Tab order.
 */
class PictureToolbar {
  readonly #view: EditorView;
  readonly #callbacks: () => PictureCallbacks;
  readonly #bar: HTMLDivElement;
  readonly #change: HTMLButtonElement;
  #at = -1;
  readonly #follow = () => this.update(this.#view);

  constructor(view: EditorView, callbacks: () => PictureCallbacks) {
    this.#view = view;
    this.#callbacks = callbacks;
    const bar = (this.#bar = document.createElement("div"));
    bar.className = "ghw-picture-toolbar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Picture");
    bar.hidden = true;
    const button = (label: string, run: (at: number) => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.tabIndex = -1;
      b.textContent = label;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => this.#at >= 0 && run(this.#at));
      bar.append(b);
      return b;
    };
    button("Describe…", (at) => this.#callbacks().edit?.(at));
    this.#change = button("Change…", (at) => (this.#callbacks().change ?? this.#callbacks().edit)?.(at));
    button("Remove", (at) => {
      const tr = removePictureTr(this.#view.state, at);
      if (!tr) return;
      this.#view.dispatch(tr);
      this.#view.focus();
    });
    // Beside the text, so it's in the same dialog as the text when there is one (a note's page, #200).
    (view.dom.parentElement ?? document.body).append(bar);
    view.dom.addEventListener("focus", this.#follow);
    view.dom.addEventListener("blur", this.#follow);
    window.addEventListener("scroll", this.#follow, true);
    window.addEventListener("resize", this.#follow);
  }

  update(view: EditorView): void {
    const { selection } = view.state;
    const picture = selection instanceof NodeSelection && selection.node.type.name === "picture" && view.editable && view.hasFocus() && !!this.#callbacks().edit;
    const figure = picture ? (view.nodeDOM(selection.from) as HTMLElement | null) : null;
    if (!picture || !figure?.getBoundingClientRect) {
      this.#at = -1;
      this.#bar.hidden = true;
      return;
    }
    this.#at = selection.from;
    this.#change.hidden = !this.#callbacks().change;
    this.#bar.hidden = false;
    const img = figure.querySelector("img") ?? figure;
    const box = img.getBoundingClientRect();
    // From where the bar is placed: its offset parent, scrolled as it is.
    const parent = this.#bar.offsetParent ?? document.documentElement;
    const origin = parent === document.body ? { top: -scrollY, left: -scrollX } : parent.getBoundingClientRect();
    const top = box.top - origin.top + parent.scrollTop + 6;
    const left = box.right - origin.left + parent.scrollLeft - this.#bar.offsetWidth - 6;
    this.#bar.style.top = `${Math.max(4, top)}px`;
    this.#bar.style.left = `${Math.max(4, left)}px`;
  }

  destroy(): void {
    this.#view.dom.removeEventListener("focus", this.#follow);
    this.#view.dom.removeEventListener("blur", this.#follow);
    window.removeEventListener("scroll", this.#follow, true);
    window.removeEventListener("resize", this.#follow);
    this.#bar.remove();
  }
}

const ROWS = new PluginKey<DecorationSet>("ghwPictureRows");
/** The most pictures side by side; a run of more starts another row. */
const ROW = 3;

/**
 * Pictures on neighbouring lines, shown as rows of up to three (#201): each picture of a run is
 * marked with its row's size, for the styles to put them side by side. Only how they're shown: each
 * is still a block of its own, on its own line in the file, in the order it's read and moved.
 */
function pictureRows(doc: ProseNode): DecorationSet {
  const marks: Decoration[] = [];
  // The blocks in `node`, whose content starts at `start`: a chapter's scenes hold theirs.
  const visit = (node: ProseNode, start: number) => {
    let run: { at: number; size: number }[] = [];
    const end = () => {
      for (let i = 0; i < run.length; i += ROW) {
        const row = run.slice(i, i + ROW);
        if (row.length < 2) continue;
        row.forEach(({ at, size }, j) => marks.push(Decoration.node(at, at + size, { class: j === 0 ? "ghw-picture-row ghw-picture-row-first" : "ghw-picture-row", style: `--ghw-row: ${row.length}` })));
      }
      run = [];
    };
    node.forEach((child, offset) => {
      if (child.type.name === "picture") return void run.push({ at: start + offset, size: child.nodeSize });
      end();
      if (!child.isTextblock && !child.isAtom) visit(child, start + offset + 1);
    });
    end();
  };
  visit(doc, 0);
  return DecorationSet.create(doc, marks);
}

function imageFiles(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].filter((f) => f.type.startsWith("image/"));
}

/**
 * Put a picture in at `at` (after the block holding it, or in place of an empty paragraph), with an
 * empty paragraph after it to write on in, the caret there.
 */
export function insertPicture(editor: Editor, picture: PictureAttrs, at = editor.state.selection.from): boolean {
  const { schema } = editor.state;
  const node = schema.nodes.picture!.create({ url: picture.url, alt: picture.alt, caption: picture.caption || null });
  const { tr, at: start } = insertBlock(editor.state, node, Math.min(at, editor.state.doc.content.size));
  const after = start + node.nodeSize;
  const next = tr.doc.resolve(after).nodeAfter;
  if (!next?.isTextblock) tr.insert(after, schema.nodes.paragraph!.create());
  tr.setSelection(TextSelection.create(tr.doc, after + 1));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

/** The picture at `at`, or undefined if there isn't one. */
export function pictureAt(editor: Editor, at: number): PictureAttrs | undefined {
  const node = at >= 0 && at < editor.state.doc.content.size ? editor.state.doc.nodeAt(at) : null;
  return node?.type.name === "picture" ? { url: node.attrs.url, alt: node.attrs.alt, caption: node.attrs.caption } : undefined;
}

/** Change the description and caption of the picture at `at` (and, given `url`, the picture it shows), leaving it selected. */
export function setPicture(editor: Editor, at: number, { url, alt, caption }: { url?: string; alt: string; caption?: string | null }): boolean {
  const node = editor.state.doc.nodeAt(at);
  if (node?.type.name !== "picture") return false;
  const tr = editor.state.tr.setNodeMarkup(at, undefined, { ...node.attrs, ...(url ? { url } : {}), alt, caption: caption || null });
  tr.setSelection(NodeSelection.create(tr.doc, at));
  editor.view.dispatch(tr);
  editor.view.focus();
  return true;
}

/** Take the picture at `at` out of the text, a caret in the text before it (or after, at the start). */
export function removePicture(editor: Editor, at: number): boolean {
  const tr = removePictureTr(editor.state, at);
  if (!tr) return false;
  editor.view.dispatch(tr);
  editor.view.focus();
  return true;
}

/** Move the picture at `at` past the block before it (`by` -1) or after it (1), still selected; false at the start or end. */
export function movePicture(editor: Editor, at: number, by: -1 | 1): boolean {
  const tr = movePictureTr(editor.state, at, by);
  if (!tr) return false;
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

function removePictureTr(state: EditorState, at: number): Transaction | undefined {
  const node = state.doc.nodeAt(at);
  if (node?.type.name !== "picture") return undefined;
  const tr = state.tr.delete(at, at + node.nodeSize);
  // A caret in the text before, or else after: not the next picture, selected.
  const $at = tr.doc.resolve(Math.min(at, tr.doc.content.size));
  return tr.setSelection(Selection.findFrom($at, -1, true) ?? Selection.findFrom($at, 1, true) ?? TextSelection.near($at));
}

function movePictureTr(state: EditorState, at: number, by: -1 | 1): Transaction | undefined {
  const node = state.doc.nodeAt(at);
  if (node?.type.name !== "picture") return undefined;
  const $at = state.doc.resolve(at);
  const parent = $at.parent;
  // Past the next block with something in it: an empty paragraph (the line left to write on after a
  // picture) isn't in the file, and moving past it alone would change nothing there.
  let i = $at.index() + by;
  while (i >= 0 && i < parent.childCount && isEmptyLine(parent.child(i))) i += by;
  if (i < 0 || i >= parent.childCount) return undefined;
  const start = $at.start();
  let edge = start;
  for (let k = 0; k < (by < 0 ? i : i + 1); k++) edge += parent.child(k).nodeSize;
  const tr = state.tr.delete(at, at + node.nodeSize);
  const to = by < 0 ? edge : edge - node.nodeSize;
  tr.insert(to, node);
  return tr.setSelection(NodeSelection.create(tr.doc, to));
}

function isEmptyLine(node: ProseNode): boolean {
  return node.type.name === "paragraph" && node.childCount === 0;
}
