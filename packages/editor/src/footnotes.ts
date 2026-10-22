import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseNode, ResolvedPos } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

/*
 * Footnotes as the writer works with them (#58): Mod-Alt-F adds one where the caret is, its next
 * number in the file, its note at the end of the file's text with the caret in it; in a note, the
 * same keys go back to where it's referred to. A reference clicked opens its note, and a note's label
 * clicked goes back. A note whose last reference is deleted goes with it. A file's footnotes are its
 * own: in a chapter, each scene's.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    footnotes: {
      /** A new footnote at the selection, the caret in its note. */
      addFootnote: () => ReturnType;
      /** From a note to where it's referred to; from just after a reference, to its note. */
      followFootnote: () => ReturnType;
    };
  }
}

/** The file a position is in: the scene node around it in a chapter, else the document. */
function fileAt($pos: ResolvedPos): { node: ProseNode; start: number } {
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === "scene") return { node: $pos.node(d), start: $pos.start(d) };
  return { node: $pos.doc, start: 0 };
}

/** Each footnote and reference in a file, with its position. */
function inFile(file: { node: ProseNode; start: number }) {
  const notes: { label: string; pos: number; node: ProseNode }[] = [];
  const refs: { label: string; pos: number }[] = [];
  file.node.descendants((n, offset) => {
    const pos = file.start + offset;
    if (n.type.name === "footnote") notes.push({ label: n.attrs.label, pos, node: n });
    else if (n.type.name === "footnote_ref") refs.push({ label: n.attrs.label, pos });
    else if (n.type.name === "scene") return false;
    return true;
  });
  return { notes, refs };
}

/** Each file in a document: each scene of a chapter, keyed by its ID, or the document itself. */
function eachFile(doc: ProseNode, fn: (file: { node: ProseNode; start: number }, key: string) => void): void {
  if (doc.firstChild?.type.name !== "scene") return fn({ node: doc, start: 0 }, "");
  doc.forEach((scene, offset) => fn({ node: scene, start: offset + 1 }, String(scene.attrs.id)));
}

/** The footnotes referred to in a document, as file and label. */
function referenced(doc: ProseNode): Set<string> {
  const out = new Set<string>();
  eachFile(doc, (file, key) => inFile(file).refs.forEach((r) => out.add(`${key}\0${r.label}`)));
  return out;
}

/** The file's next footnote label: one more than its highest number, or a number it doesn't use yet. */
function nextLabel(file: { node: ProseNode; start: number }): string {
  const { notes, refs } = inFile(file);
  const used = new Set([...notes, ...refs].map((x) => x.label.toLowerCase()));
  let n = Math.max(0, ...[...used].map(Number).filter(Number.isInteger)) + 1;
  while (used.has(String(n))) n++;
  return String(n);
}

/** The caret at the end of a note's text. */
function intoNote(tr: Transaction, notePos: number): Transaction {
  const note = tr.doc.nodeAt(notePos)!;
  return tr.setSelection(TextSelection.create(tr.doc, notePos + note.nodeSize - 2)).scrollIntoView();
}

/** The caret just after a footnote's first reference. */
function toReference(state: EditorState, label: string, file: { node: ProseNode; start: number }): Transaction | undefined {
  const ref = inFile(file).refs.find((r) => r.label === label);
  return ref ? state.tr.setSelection(TextSelection.create(state.doc, ref.pos + 1)).scrollIntoView() : undefined;
}

/** The note around the selection, if it's in one. */
function noteAround($pos: ResolvedPos): ProseNode | undefined {
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === "footnote") return $pos.node(d);
  return undefined;
}

export const FootnotesExtension = Extension.create({
  name: "footnotes",

  addCommands() {
    return {
      addFootnote:
        () =>
        ({ state, tr, dispatch }) => {
          const { schema, selection } = state;
          if (noteAround(selection.$from) || !schema.nodes.footnote_ref || !schema.nodes.footnote) return false;
          const file = fileAt(selection.$from);
          const label = nextLabel(file);
          if (!dispatch) return true;
          tr.replaceSelectionWith(schema.nodes.footnote_ref.create({ label }), true);
          // The note at the end of the file's text.
          const end = tr.mapping.map(file.start + file.node.content.size);
          tr.insert(end, schema.nodes.footnote.create({ label }, schema.nodes.paragraph!.create()));
          intoNote(tr, end);
          return true;
        },
      followFootnote:
        () =>
        ({ state, dispatch }) => {
          const { $from } = state.selection;
          const note = noteAround($from);
          if (note) {
            const tr = toReference(state, note.attrs.label, fileAt($from));
            if (tr && dispatch) dispatch(tr);
            return !!tr;
          }
          const before = $from.nodeBefore;
          if (before?.type.name !== "footnote_ref") return false;
          const target = inFile(fileAt($from)).notes.find((n) => n.label === before.attrs.label);
          if (!target) return false;
          if (dispatch) dispatch(intoNote(state.tr, target.pos));
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Word's keys for a footnote. In a note, back to the text.
      "Mod-Alt-f": () => (noteAround(this.editor.state.selection.$from) ? this.editor.commands.followFootnote() : this.editor.commands.addFootnote()),
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor as Editor;
    return [
      new Plugin({
        key: new PluginKey("footnotes"),
        props: {
          handleClickOn(view, pos, node, nodePos) {
            if (node.type.name !== "footnote_ref") return false;
            const target = inFile(fileAt(view.state.doc.resolve(nodePos))).notes.find((n) => n.label === node.attrs.label);
            if (!target) return false;
            view.dispatch(intoNote(view.state.tr, target.pos));
            view.focus();
            return true;
          },
          handleDOMEvents: {
            mousedown(view, event) {
              const label = (event.target as HTMLElement | null)?.closest?.(".ghw-footnote-label");
              if (!label) return false;
              const pos = view.posAtDOM(label.parentElement!, 0);
              const note = noteAround(view.state.doc.resolve(Math.min(pos + 1, view.state.doc.content.size)));
              const tr = note && toReference(view.state, note.attrs.label, fileAt(view.state.doc.resolve(pos)));
              if (!tr) return false;
              event.preventDefault();
              view.dispatch(tr);
              view.focus();
              return true;
            },
          },
        },
        // A footnote whose last reference the writer deleted goes too; one whose references were
        // never there (a file read as it was) is left alone.
        appendTransaction(transactions, before, after) {
          // The writer's edits only: not a file reloaded from disk (kept out of the undo history).
          if (!transactions.some((t) => t.docChanged && t.getMeta("addToHistory") !== false) || !editor.isEditable) return null;
          const was = referenced(before.doc);
          const now = referenced(after.doc);
          const gone = new Set([...was].filter((key) => !now.has(key)));
          if (!gone.size) return null;
          const tr = after.tr;
          const doomed: { pos: number; size: number }[] = [];
          eachFile(after.doc, (file, key) => {
            for (const note of inFile(file).notes) if (gone.has(`${key}\0${note.label}`)) doomed.push({ pos: note.pos, size: note.node.nodeSize });
          });
          for (const d of doomed.sort((a, b) => b.pos - a.pos)) tr.delete(d.pos, d.pos + d.size);
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});
