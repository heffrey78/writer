import { Extension, type Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { dismissedIn, nameMatcher, plainSentences, type NameMatcher, type NotName } from "@writer/core";
import type { MentionEntity } from "./mention-suggest.ts";
import { writingModes, type EditorCommand } from "./modes.ts";

/** A "Not a name here" judgement (D19), without its piece: the editor knows which piece a paragraph is in. */
export type NotNameHere = Pick<NotName, "entry" | "sentence" | "nth">;

export interface LinkSuggestOptions {
  /** The entries whose names and aliases are looked for; read on each change. */
  entities: () => readonly MentionEntity[];
  /** "Not a name here" judgements about the pieces in the editor: the words they dismiss aren't underlined. Read on each change. */
  notNames: () => readonly NotName[];
  /** The piece a one-piece editor holds (a chapter's paragraphs say their own). */
  piece: () => string | undefined;
  /** Keep a judgement that the underlined name at the caret isn't a name in its piece; absent, the command does nothing. */
  onNotName?: (judgement: NotName) => void;
}

/** The piece a paragraph at `pos` is in: a chapter's scene, or the one-piece editor's. */
function pieceAt(doc: Node, pos: number, options: LinkSuggestOptions): string | undefined {
  if (doc.type.name === "chapter") return doc.resolve(pos).node(1)?.attrs.id as string | undefined;
  return options.piece();
}

/*
 * The names and aliases looked for are core's (nameMatcher), which an entry's profile uses to list
 * the same names as passages not linked (#135): the two never disagree.
 */

/** A textblock's text as core's passages read it: what isn't words (a picture, a break) one character. */
const blockText = (block: Node) => block.textBetween(0, block.content.size, undefined, "￼");

/**
 * Unmarked names in a textblock, as [from, to, id] offsets into it (one character per position), less
 * those a "Not a name here" judgement dismisses: core's one rule, on the same text.
 */
function scan(block: Node, m: NameMatcher, notNames: readonly NotNameHere[]): [number, number, string][] {
  const found = unmarked(block, m);
  if (!notNames.length) return found;
  const dismissed = dismissedIn(blockText(block), found.map(([from, to, id]) => ({ id, at: [from, to] as const })), notNames);
  return found.filter((_, i) => !dismissed.has(i));
}

function unmarked(block: Node, m: NameMatcher): [number, number, string][] {
  const text = blockText(block);
  const out: [number, number, string][] = [];
  for (const hit of text.matchAll(m.pattern)) {
    const from = hit.index;
    const to = from + hit[0].length;
    // Not inside a link: it already points somewhere.
    let linked = false;
    block.nodesBetween(from, to, (n) => void (n.marks.some((mark) => mark.type.name === "link") && (linked = true)));
    if (!linked) out.push([from, to, m.ids.get(hit[0])!]);
  }
  return out;
}

export const linkSuggestKey = new PluginKey<DecorationSet>("linkSuggest");

/**
 * Underlines names and aliases of bible entries written as plain text, as suggestions to link
 * them (the "linkSuggestions" writing mode, off by default). Nothing changes until the author
 * links one: Alt+Enter, or "Link the name at the caret", turns it into a mention showing the
 * words as written.
 */
export const LinkSuggestExtension = Extension.create<LinkSuggestOptions>({
  name: "linkSuggest",
  addOptions: () => ({ entities: () => [], notNames: () => [], piece: () => undefined }),

  addKeyboardShortcuts() {
    return { "Alt-Enter": ({ editor }) => linkNameAtCaret(editor) };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    let cache = new WeakMap<Node, [number, number, string][]>();
    let source: readonly MentionEntity[] | undefined;
    let judged: readonly NotName[] | undefined;
    let byPiece = new Map<string, NotName[]>();
    let m: NameMatcher | undefined;

    const decorate = (state: EditorState): DecorationSet => {
      if (!writingModes.getState().linkSuggestions) return DecorationSet.empty;
      const entities = options.entities();
      const notNames = options.notNames();
      if (entities !== source || notNames !== judged) {
        if (entities !== source) m = nameMatcher(entities);
        source = entities;
        judged = notNames;
        byPiece = new Map();
        for (const n of notNames) byPiece.set(n.piece, [...(byPiece.get(n.piece) ?? []), n]);
        cache = new WeakMap();
      }
      if (!m) return DecorationSet.empty;
      const decorations: Decoration[] = [];
      const names = new Map(entities.map((e) => [e.id, e.name]));
      state.doc.descendants((node, pos) => {
        if (!node.isTextblock) return true;
        if (node.type.spec.code) return false;
        let hits = cache.get(node);
        if (!hits) {
          const piece = pieceAt(state.doc, pos, options);
          cache.set(node, (hits = scan(node, m!, (piece && byPiece.get(piece)) || [])));
        }
        for (const [from, to, id] of hits) {
          decorations.push(Decoration.inline(pos + 1 + from, pos + 1 + to, { class: "ghw-unlinked", title: `Not linked: Alt+Enter links it to ${names.get(id)}` }, { id }));
        }
        return false;
      });
      return DecorationSet.create(state.doc, decorations);
    };

    return [
      new Plugin<DecorationSet>({
        key: linkSuggestKey,
        state: {
          init: (_, state) => decorate(state),
          apply: (tr, set, _old, state) => (tr.docChanged || tr.getMeta(linkSuggestKey) ? decorate(state) : set),
        },
        props: { decorations: (state) => linkSuggestKey.getState(state) },
        view: (view) => {
          const off = writingModes.subscribe((modes, prev) => {
            if (modes.linkSuggestions !== prev.linkSuggestions && !view.isDestroyed) view.dispatch(view.state.tr.setMeta(linkSuggestKey, true));
          });
          return { destroy: off };
        },
      }),
    ];
  },
});

/** Link the underlined name at the caret: it becomes a mention showing the words as written. False if there's none. */
export function linkNameAtCaret(editor: Editor): boolean {
  const { state } = editor;
  const head = state.selection.head;
  const found = linkSuggestKey.getState(state)?.find(head, head) ?? [];
  const hit = found.find((d) => d.from <= head && head <= d.to);
  return !!hit && linkName(editor, hit.from, hit.to, (hit.spec as { id: string }).id);
}

/**
 * The underlined name at the caret isn't a name here: kept as a judgement (its sentence, and which
 * plain occurrence of the entry it is there) through the editor's onNotName. False if there's none.
 */
export function notANameAtCaret(editor: Editor): boolean {
  const { state } = editor;
  const head = state.selection.head;
  const keep = editor.extensionManager.extensions.find((e) => e.name === "linkSuggest")?.options as LinkSuggestOptions | undefined;
  const piece = keep && pieceAt(state.doc, head, keep);
  const hit = (linkSuggestKey.getState(state)?.find(head, head) ?? []).find((d) => d.from <= head && head <= d.to);
  if (!hit || !keep?.onNotName || !piece) return false;
  const $from = state.doc.resolve(hit.from);
  const block = $from.parent;
  const start = $from.start();
  const m = nameMatcher(keep.entities());
  if (!m) return false;
  // Counted among every plain name in its paragraph, dismissed or not, as core counts them.
  const plain = unmarked(block, m).map(([from, to, id]) => ({ id, at: [from, to] as const }));
  const i = plain.findIndex((p) => p.at[0] === hit.from - start);
  if (i < 0) return false;
  const text = blockText(block);
  const { sentence, nth } = plainSentences(text, plain)[i]!;
  keep.onNotName({ entry: plain[i]!.id, piece, sentence: text.slice(...sentence), nth });
  return true;
}

/** Make the words between `from` and `to` a mention of `id`, showing them as written (with their marks). False if they can't be. */
export function linkName(editor: Editor, from: number, to: number, id: string): boolean {
  const { state } = editor;
  const mention = state.schema.nodes.mention;
  if (!mention || from >= to) return false;
  const label = state.doc.textBetween(from, to);
  const node = mention.create({ id, label }, null, state.doc.nodeAt(from)?.marks ?? []);
  editor.view.dispatch(state.tr.replaceWith(from, to, node).scrollIntoView());
  return true;
}

export const linkCommands: EditorCommand[] = [
  {
    id: "editor.toggleLinkSuggestions",
    title: "Suggest links for names written without a mention",
    run: (editor) => {
      writingModes.getState().toggle("linkSuggestions");
      if (editor && !editor.isDestroyed) editor.commands.focus(null, { scrollIntoView: false });
    },
    isActive: () => writingModes.getState().linkSuggestions,
  },
  { id: "editor.linkName", title: "Link the name at the caret", keys: "Alt-Enter", run: (editor) => void (editor && !editor.isDestroyed && linkNameAtCaret(editor) && editor.commands.focus()) },
  { id: "editor.notAName", title: "Not a name here: stop suggesting a link for the word at the caret", run: (editor) => void (editor && !editor.isDestroyed && notANameAtCaret(editor) && editor.commands.focus()) },
];
