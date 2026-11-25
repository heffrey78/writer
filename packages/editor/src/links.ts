import { Extension, getMarkRange } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/*
 * Links in the prose: a link in a contenteditable text doesn't open, and its address isn't seen. With
 * the caret in one, a small bar under it shows where it goes, and opens it (in the browser, on a
 * phone), changes its words and its address in place, or takes the link off and keeps the words.
 * Mod+K opens its editing from the keyboard.
 */

/** The link around the caret: where it is, its words and its attributes. */
export interface LinkAt {
  from: number;
  to: number;
  text: string;
  href: string;
}

export function linkAt(state: EditorState): LinkAt | undefined {
  const type = state.schema.marks.link;
  const { selection } = state;
  if (!type) return undefined;
  // A selection within one link, or a caret in it: the caret after its last letter is in it too.
  const at = selection.empty && !type.isInSet(selection.$from.marks()) && selection.$from.nodeBefore && type.isInSet(selection.$from.nodeBefore.marks) ? selection.from - 1 : selection.from;
  const $at = state.doc.resolve(at);
  const range = getMarkRange($at, type);
  if (!range || selection.to > range.to || selection.from < range.from) return undefined;
  const mark = state.doc.nodeAt(range.from)?.marks.find((m) => m.type === type);
  if (!mark) return undefined;
  return { from: range.from, to: range.to, text: state.doc.textBetween(range.from, range.to), href: String(mark.attrs.href ?? "") };
}

/** The link `link` given new words and address; a link without words reads as its address. */
export function changeLink(view: EditorView, link: Pick<LinkAt, "from" | "to">, text: string, href: string): void {
  const { state } = view;
  const type = state.schema.marks.link!;
  const old = state.doc.nodeAt(link.from)?.marks.find((m) => m.type === type);
  const words = text.trim() || href.trim();
  const tr = state.tr.insertText(words, link.from, link.to);
  tr.removeMark(link.from, link.from + words.length, type);
  if (href.trim()) tr.addMark(link.from, link.from + words.length, type.create({ ...old?.attrs, href: href.trim() }));
  tr.setSelection(TextSelection.create(tr.doc, link.from + words.length));
  view.dispatch(tr);
}

/** The link `link` taken off, its words kept. */
export function removeLink(view: EditorView, link: Pick<LinkAt, "from" | "to">): void {
  view.dispatch(view.state.tr.removeMark(link.from, link.to, view.state.schema.marks.link!));
}

/** An address the browser can open: not a path in the book. */
const openable = (href: string) => /^(https?:|mailto:)/i.test(href);

const KEY = new PluginKey("ghwLinks");

export const LinksExtension = Extension.create({
  name: "ghwLinks",
  addProseMirrorPlugins() {
    return [new Plugin({ key: KEY, view: (view) => new LinkBar(view) })];
  },
  addKeyboardShortcuts() {
    return {
      "Mod-k": ({ editor }) => !!LinkBar.of(editor.view)?.edit(),
    };
  },
});

const bars = new WeakMap<EditorView, LinkBar>();

/**
 * The bar under the link the caret is in, while the text has the focus: its address, Open, Edit and
 * Remove link; Edit turns it into the link's words and address to change, Enter to keep them and
 * Escape to leave them, back in the text. A press on its buttons leaves the focus in the text.
 */
class LinkBar {
  static of(view: EditorView): LinkBar | undefined {
    return bars.get(view);
  }

  readonly #view: EditorView;
  readonly #bar: HTMLDivElement;
  readonly #address: HTMLAnchorElement;
  readonly #open: HTMLButtonElement;
  readonly #form: HTMLFormElement;
  readonly #text: HTMLInputElement;
  readonly #href: HTMLInputElement;
  #link: LinkAt | undefined;
  #editing = false;
  readonly #follow = () => this.update(this.#view);

  constructor(view: EditorView) {
    this.#view = view;
    bars.set(view, this);
    const bar = (this.#bar = document.createElement("div"));
    bar.className = "ghw-link-bar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Link");
    bar.hidden = true;
    const button = (label: string, run: () => void, into: HTMLElement = bar) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", run);
      into.append(b);
      return b;
    };

    // Where it goes, as text that can be read in full; opened only by Open, as a tap here is to read it.
    this.#address = document.createElement("a");
    this.#address.className = "ghw-link-address";
    this.#address.tabIndex = -1;
    this.#address.addEventListener("click", (e) => e.preventDefault());
    bar.append(this.#address);
    this.#open = button("Open", () => this.#link && openable(this.#link.href) && openOutside(this.#link.href));
    button("Edit", () => this.edit());
    button("Remove link", () => {
      if (!this.#link) return;
      removeLink(this.#view, this.#link);
      this.#view.focus();
    });
    for (const b of bar.querySelectorAll("button")) b.tabIndex = -1;

    const form = (this.#form = document.createElement("form"));
    form.className = "ghw-link-form";
    form.hidden = true;
    const field = (label: string, type: string) => {
      const l = document.createElement("label");
      const span = document.createElement("span");
      span.textContent = label;
      const input = document.createElement("input");
      input.type = type;
      input.autocomplete = "off";
      l.append(span, input);
      form.append(l);
      return input;
    };
    this.#text = field("Text", "text");
    this.#href = field("Link", "url");
    const actions = document.createElement("div");
    actions.className = "ghw-link-actions";
    form.append(actions);
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "Save";
    button("Cancel", () => this.#stopEditing(), actions);
    actions.append(save);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (this.#link) changeLink(this.#view, this.#link, this.#text.value, this.#href.value);
      this.#stopEditing();
    });
    form.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      this.#stopEditing();
    });
    // Out of the bar and not back to the text (a tap elsewhere): the change left as it was.
    form.addEventListener("focusout", (e) => {
      const to = e.relatedTarget as Node | null;
      if (to && (form.contains(to) || this.#view.dom.contains(to))) return;
      this.#editing = false;
      this.update(this.#view);
    });
    bar.append(form);

    // Beside the text, so it's in the same dialog as the text when there is one (a note's page).
    (view.dom.parentElement ?? document.body).append(bar);
    view.dom.addEventListener("focus", this.#follow);
    view.dom.addEventListener("blur", this.#follow);
    window.addEventListener("scroll", this.#follow, true);
    window.addEventListener("resize", this.#follow);
  }

  /** The link at the caret's words and address to change, focused; false where there's none. */
  edit(): boolean {
    const link = linkAt(this.#view.state);
    if (!link || !this.#view.editable) return false;
    this.#link = link;
    this.#editing = true;
    this.#text.value = link.text;
    this.#href.value = link.href;
    this.#show();
    this.#text.focus();
    this.#text.select();
    return true;
  }

  #stopEditing(): void {
    this.#editing = false;
    this.#view.focus();
    this.update(this.#view);
  }

  update(view: EditorView): void {
    if (this.#editing) return;
    const link = view.editable && view.hasFocus() ? linkAt(view.state) : undefined;
    this.#link = link;
    if (!link) {
      this.#bar.hidden = true;
      return;
    }
    this.#show();
  }

  #show(): void {
    const link = this.#link!;
    this.#address.textContent = link.href;
    this.#address.href = link.href;
    this.#address.title = link.href;
    for (const el of this.#bar.children) if (el !== this.#form) (el as HTMLElement).hidden = this.#editing;
    if (!this.#editing) this.#open.hidden = !openable(link.href);
    this.#form.hidden = !this.#editing;
    this.#bar.hidden = false;
    // Under the link's first line, kept inside the text's width.
    const start = this.#view.coordsAtPos(link.from);
    const parent = this.#bar.offsetParent ?? document.documentElement;
    const origin = parent === document.body ? { top: -scrollY, left: -scrollX } : parent.getBoundingClientRect();
    const width = (parent as HTMLElement).clientWidth || innerWidth;
    const left = Math.min(start.left - origin.left + parent.scrollLeft, parent.scrollLeft + width - this.#bar.offsetWidth - 4);
    this.#bar.style.top = `${start.bottom - origin.top + parent.scrollTop + 4}px`;
    this.#bar.style.left = `${Math.max(4, left)}px`;
  }

  destroy(): void {
    bars.delete(this.#view);
    this.#view.dom.removeEventListener("focus", this.#follow);
    this.#view.dom.removeEventListener("blur", this.#follow);
    window.removeEventListener("scroll", this.#follow, true);
    window.removeEventListener("resize", this.#follow);
    this.#bar.remove();
  }
}

/** Opened as the app's other links to sites are: a new window, which the desktop and the phone hand to the browser. */
function openOutside(href: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.click();
}
