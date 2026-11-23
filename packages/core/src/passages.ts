import type { Nodes, Parent, PhrasingContent, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toString } from "mdast-util-to-string";
import { gfm } from "micromark-extension-gfm";
import { recordTypesOf } from "./modules.ts";
import { resolveAnchor } from "./anchor-match.ts";
import { fieldNames } from "./index-search.ts";
import { notNamesIn } from "./judgements.ts";
import type { Book, NotName, Piece } from "./model.ts";

/*
 * What the book says about an entry (#135): every passage that mentions it, linked or written as
 * plain words, with the sentence around it. The plain-name rule is the editor's own underline
 * (link-suggest), shared from here so the two never disagree.
 */

/** Something prose can name: an entry, or a module's record that prose may mention (an off-page event). */
export interface NameTarget {
  id: string;
  name: string;
  aliases: string[];
  /** Its type's label, or its record type's group ("Off the page"). */
  type: string;
}

/**
 * Everything prose may mention, in the order the @ menu and the editor's underlines use it: entries
 * by type in the bible's order, then by name; then the modules' mentionable records by title.
 */
export function mentionTargets(book: Book): NameTarget[] {
  return [
    ...book.entityTypes.flatMap((t) =>
      book.entities
        .filter((e) => e.type === t.key)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => ({ id: e.id, name: e.name, aliases: e.aliases, type: t.label })),
    ),
    ...recordTypesOf(book.kind)
      .filter((t) => t.mentionable)
      .flatMap((t) =>
        book.moduleRecords
          .filter((r) => r.type === t.key)
          .sort((a, b) => a.title.localeCompare(b.title))
          .map((r) => ({ id: r.id, name: r.title, aliases: [], type: t.group })),
      ),
  ];
}

export interface NameMatcher {
  /** Every name and other name, longest first, as whole words with their case. */
  pattern: RegExp;
  /** Each name or other name, to the one it names (the first, where two share it). */
  ids: Map<string, string>;
}

/** Names and other names as one pattern, longest first, matching whole words only and with their case. Undefined when there are none. */
export function nameMatcher(targets: readonly Pick<NameTarget, "id" | "name" | "aliases">[]): NameMatcher | undefined {
  const ids = new Map<string, string>();
  for (const e of targets) for (const term of [e.name, ...e.aliases]) if (term.trim().length > 1 && !ids.has(term)) ids.set(term, e.id);
  if (!ids.size) return undefined;
  const terms = [...ids.keys()].sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return { pattern: new RegExp(`(?<![\\p{L}\\p{N}_])(?:${terms.join("|")})(?![\\p{L}\\p{N}_])`, "gu"), ids };
}

/** One stretch of a block's text: plain prose (where names are looked for), or something else. */
interface Run {
  start: number;
  end: number;
  kind: "plain" | "mention" | "other";
  /** A mention's target. */
  id?: string;
  /** Where it is in the Markdown. */
  rawFrom?: number;
  rawTo?: number;
  /** Its text is the Markdown's, character for character (no escapes or character references). */
  exact?: boolean;
}

/** A paragraph, heading or table cell as a reader sees it, with where each part came from. */
interface Block {
  text: string;
  runs: Run[];
}

const MENTION_URL = /^#([a-z]{2,8}_[0-9a-hjkmnp-tv-z]{6})$/;
/** What stands for something inline that isn't words (a picture, a footnote's marker, a line break), as the editor's text has it. */
const OBJECT = "￼";

const parse = (markdown: string) => fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });

/**
 * The blocks of prose in Markdown, in order. A paragraph of plain words, mentions, links and emphasis
 * (most of a book) is read directly; anything else (lists, quotes, tables, code, pictures, escapes) is
 * parsed as Markdown, a paragraph at a time, so a long book is read in milliseconds, not seconds.
 */
export function proseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of chunks(markdown)) {
    if (chunk.code) continue;
    const simple = simpleBlock(chunk.text, chunk.start);
    if (simple !== undefined) {
      if (simple) blocks.push(simple);
      continue;
    }
    blocks.push(...parsedBlocks(chunk.text, chunk.start));
  }
  return blocks;
}

interface Chunk {
  /** Where it starts in the Markdown. */
  start: number;
  text: string;
  /** A fenced code block: no prose. */
  code?: boolean;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Markdown split at blank lines into runs of lines, a fenced code block (blank lines and all) one of them. */
function chunks(markdown: string): Chunk[] {
  // Without fences (most prose), blank lines are all there is to it.
  if (!/^ {0,3}(?:`{3}|~{3})/m.test(markdown)) {
    const out: Chunk[] = [];
    let start = 0;
    for (const m of markdown.matchAll(/\n(?:[ \t]*\n)+/g)) {
      if (m.index > start) out.push({ start, text: markdown.slice(start, m.index) });
      start = m.index + m[0].length;
    }
    if (start < markdown.length && markdown.slice(start).trim()) out.push({ start, text: markdown.slice(start).replace(/\n[ \t]*$/, "") });
    return out.filter((c) => c.text.trim());
  }
  const out: Chunk[] = [];
  let at = 0;
  let current: { start: number; end: number } | undefined;
  let fence: { start: number; marker: string } | undefined;
  const close = () => {
    if (current) out.push({ start: current.start, text: markdown.slice(current.start, current.end) });
    current = undefined;
  };
  while (at <= markdown.length) {
    const nl = markdown.indexOf("\n", at);
    const end = nl < 0 ? markdown.length : nl;
    const line = markdown.slice(at, end);
    if (fence) {
      const closing = FENCE.exec(line);
      if (closing && closing[1]![0] === fence.marker[0] && closing[1]!.length >= fence.marker.length && !line.slice(closing[0].length).trim()) {
        out.push({ start: fence.start, text: markdown.slice(fence.start, end), code: true });
        fence = undefined;
      }
    } else {
      const opening = FENCE.exec(line);
      if (opening && !(opening[1]![0] === "`" && line.slice(opening[0].length).includes("`"))) {
        close();
        fence = { start: at, marker: opening[1]! };
      } else if (!line.trim()) close();
      else if (current) current.end = end;
      else current = { start: at, end };
    }
    if (nl < 0) break;
    at = nl + 1;
  }
  if (fence) out.push({ start: fence.start, text: markdown.slice(fence.start), code: true });
  close();
  return out;
}

/** A line that makes a chunk more than a paragraph: indented code, a quote, a list, a setext underline, a table, HTML, a footnote. */
const STRUCTURE = /^(?: {4}|\t| {0,3}(?:>|[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|=+[ \t]*$|-+[ \t]*$|\||<|\[\^))/m;
/** Characters only Markdown's parser reads right: code, HTML and autolinks, escapes, character references, strikethrough, tables. */
const SPECIAL = /[`<\\&~|]|!\[/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]+|$)/;
const LATER_HEADING = /\n {0,3}#{1,6}(?:[ \t]|$)/;
const THEMATIC = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const INLINE_LINK = /\[([^[\]\n*_]*)\]\(([^()\s]*)\)/g;

/**
 * A chunk read without Markdown's parser, if it's simple enough: a paragraph or an ATX heading of
 * words, inline links and mentions, and emphasis. Null for a thematic break; undefined when it needs the parser.
 */
function simpleBlock(text: string, offset: number): Block | null | undefined {
  if (THEMATIC.test(text) && !text.includes("\n")) return null;
  if (SPECIAL.test(text) || STRUCTURE.test(text)) return undefined;
  let from = 0;
  let to = text.length;
  const heading = HEADING.exec(text);
  if (heading) {
    if (text.includes("\n")) return undefined;
    from = heading[0].length;
    const closing = /(?:^|[ \t]+)#+[ \t]*$|[ \t]+$/.exec(text.slice(from));
    if (closing) to = from + closing.index;
  } else if (LATER_HEADING.test(text)) return undefined;
  const content = text.slice(from, to);
  // Every bracket must belong to an inline link: anything else (reference links, nested brackets) needs the parser.
  const links = [...content.matchAll(INLINE_LINK)];
  if ((content.match(/[[\]]/g)?.length ?? 0) !== links.length * 2) return undefined;
  let out = "";
  const runs: Run[] = [];
  const words = (i: number, j: number) => {
    if (j <= i) return;
    const last = runs.at(-1);
    const value = content.slice(i, j);
    if (last && last.kind === "plain" && last.rawTo === offset + from + i) {
      last.end += value.length;
      last.rawTo = offset + from + j;
    } else runs.push({ start: out.length, end: out.length + value.length, kind: "plain", rawFrom: offset + from + i, rawTo: offset + from + j, exact: true });
    out += value;
  };
  const plain = (start: number, end: number) => {
    // Emphasis markers aren't words: * always, _ unless inside a word (snake_case stays as written).
    const marker = /[*_]/g;
    marker.lastIndex = start;
    let i = start;
    for (let m = marker.exec(content); m && m.index < end; m = marker.exec(content)) {
      if (m[0] === "_" && WORD_CHAR.test(content[m.index - 1] ?? "") && WORD_CHAR.test(content[m.index + 1] ?? "")) continue;
      words(i, m.index);
      i = m.index + 1;
    }
    words(i, end);
  };
  let at = 0;
  for (const m of links) {
    plain(at, m.index);
    const id = MENTION_URL.exec(m[2]!)?.[1];
    const label = m[1]!;
    if (label) {
      runs.push({ start: out.length, end: out.length + label.length, kind: id ? "mention" : "other", ...(id ? { id } : {}), rawFrom: offset + from + m.index, rawTo: offset + from + m.index + m[0].length });
      out += label;
    }
    at = m.index + m[0].length;
  }
  plain(at, content.length);
  return { text: out, runs };
}

/** Blocks of a chunk read by Markdown's parser; `offset` is where the chunk is in the whole. */
function parsedBlocks(markdown: string, offset: number): Block[] {
  const blocks: Block[] = [];
  const visit = (node: Nodes) => {
    if (node.type === "paragraph" || node.type === "heading" || node.type === "tableCell") {
      blocks.push(block(markdown, offset, node.children));
      return;
    }
    if (node.type === "code" || node.type === "html" || node.type === "definition" || node.type === "yaml") return;
    if ("children" in node) for (const child of (node as Parent).children) visit(child as RootContent);
  };
  visit(parse(markdown));
  return blocks;
}

function block(markdown: string, offset: number, children: PhrasingContent[]): Block {
  let text = "";
  const runs: Run[] = [];
  const add = (value: string, kind: Run["kind"], node: Nodes, extra: Partial<Run> = {}) => {
    if (!value) return;
    const rawFrom = node.position?.start.offset;
    const rawTo = node.position?.end.offset;
    runs.push({ start: text.length, end: text.length + value.length, kind, ...(rawFrom !== undefined && rawTo !== undefined ? { rawFrom: offset + rawFrom, rawTo: offset + rawTo } : {}), ...extra });
    text += value;
  };
  const walk = (node: PhrasingContent) => {
    switch (node.type) {
      case "text": {
        const raw = node.position && markdown.slice(node.position.start.offset, node.position.end.offset);
        add(node.value, "plain", node, { exact: raw === node.value });
        return;
      }
      case "link": {
        const id = MENTION_URL.exec(node.url)?.[1];
        add(toString(node), id ? "mention" : "other", node, id ? { id } : {});
        return;
      }
      case "emphasis":
      case "strong":
        for (const child of node.children) walk(child);
        return;
      default:
        // What the editor keeps as one object (a picture, a footnote's marker, a line break, code, HTML,
        // struck-through or reference-linked words): no names are looked for in it.
        add(OBJECT, "other", node);
    }
  };
  for (const child of children) walk(child);
  return { text, runs };
}

/** A name written as plain words, or a mention, found in a block: where in the block's text, and in the Markdown. */
export interface NameHit {
  id: string;
  linked: boolean;
  /** Where in the block's text. */
  at: [number, number];
  /** Where in the Markdown, when it's found there. */
  raw?: [number, number];
}

/**
 * The names in a block: its mentions, and its names and other names written as plain words (whole
 * words, with their case, not in a link or code), each to the one it names. The editor underlines
 * the same plain names.
 */
export function namesInBlock(markdown: string, b: Block, matcher: NameMatcher | undefined): NameHit[] {
  const hits: NameHit[] = [];
  for (const r of b.runs) if (r.kind === "mention") hits.push({ id: r.id!, linked: true, at: [r.start, r.end], ...(r.rawFrom !== undefined ? { raw: [r.rawFrom, r.rawTo!] as [number, number] } : {}) });
  if (matcher) {
    for (const m of b.text.matchAll(matcher.pattern)) {
      const from = m.index;
      const to = from + m[0].length;
      // Only plain words: not in or across a link, a mention or code. Emphasis may split them ("Ada *Varn*").
      const over = b.runs.filter((r) => r.start < to && r.end > from);
      if (!over.length || over.some((r) => r.kind !== "plain")) continue;
      const id = matcher.ids.get(m[0])!;
      let raw: [number, number] | undefined;
      const run = over.length === 1 ? over[0]! : undefined;
      if (run?.rawFrom !== undefined) {
        if (run.exact) raw = [run.rawFrom + from - run.start, run.rawFrom + to - run.start];
        else {
          // Escapes or character references in the run: find the words in its Markdown, the same number of times in.
          const before = b.text.slice(run.start, from).split(m[0]).length - 1;
          const source = markdown.slice(run.rawFrom, run.rawTo);
          let at = -1;
          for (let k = 0; k <= before; k++) at = source.indexOf(m[0], at + 1);
          if (at >= 0) raw = [run.rawFrom + at, run.rawFrom + at + m[0].length];
        }
      }
      hits.push({ id, linked: false, at: [from, to], ...(raw ? { raw } : {}) });
    }
  }
  return hits.sort((a, b) => a.at[0] - b.at[0]);
}

const ABBREVIATION = /(?:^|[\s(“"‘'])(?:Mr|Mrs|Ms|Mx|Dr|Prof|St|Mt|Sr|Jr|vs|etc|e\.g|i\.e|cf|No|Capt|Col|Gen|Lt|Sgt|Rev)\.$|(?:^|[\s(“"‘'.])\p{Lu}\.$/u;

/** Where each sentence of prose starts: after . ! ? or … and any closing quotes, before a space, unless it ends an abbreviation or an initial. */
export function sentenceStarts(text: string): number[] {
  const starts = [0];
  for (const m of text.matchAll(/[.!?…]+[”’"')\]]*\s+/gu)) {
    const end = m.index + m[0].length;
    const upTo = text.slice(0, m.index + m[0].trimEnd().length).replace(/[”’"')\]]+$/u, "");
    if (ABBREVIATION.test(upTo)) continue;
    if (end < text.length) starts.push(end);
  }
  return starts;
}

/** Whether text has more than `n` words, counting no further than it needs to. */
function moreWordsThan(text: string, n: number): boolean {
  if (text.length < n * 2) return false;
  const word = /\S+/g;
  for (let count = 0; word.exec(text); ) if (++count > n) return true;
  return false;
}

/** Where the sentence holding [from, to) is in the text, up to the space after it. */
function sentenceBounds(text: string, from: number, to: number, starts: number[]): [number, number] {
  let s = 0;
  for (const at of starts) if (at <= from) s = at;
  const next = starts.find((at) => at > from) ?? text.length;
  // A sentence that ends before the name does (a name across a full stop: "St. Ives") runs on to it.
  return [s, Math.max(next, to)];
}

/** The sentence holding [from, to), trimmed to about `words` words around it, with … where it was cut. */
export function sentenceAround(text: string, [from, to]: [number, number], words = 30, starts = sentenceStarts(text)): { text: string; at: [number, number] } {
  const [s, e] = sentenceBounds(text, from, to, starts);
  let start = s;
  let end = e;
  if (moreWordsThan(text.slice(s, e), words)) {
    const tokens = (str: string) => str.split(/\s+/).filter(Boolean).length;
    const side = Math.max(1, Math.floor((words - tokens(text.slice(from, to))) / 2));
    const before = text.slice(s, from).split(/(?<=\s)/);
    const after = text.slice(to, e).split(/(?=\s)/);
    start = from - before.slice(-side - 1).join("").length;
    end = to + after.slice(0, side + 1).join("").length;
    if (start < s) start = s;
    if (end > e) end = e;
  }
  const lead = start > s ? "…" : "";
  const body = text.slice(start, end);
  const trimmed = body.trimStart();
  const cut = body.length - trimmed.length;
  // Line breaks and what the editor keeps as objects (a picture, a footnote's marker) read as spaces.
  const shown = (lead + trimmed).replace(/[\s\uFFFC]/g, " ").trimEnd();
  const tail = end < e ? "…" : "";
  return { text: shown + tail, at: [lead.length + from - start - cut, lead.length + to - start - cut] };
}

/** A passage of a piece that mentions an entry, or writes one of its names as plain words. */
export interface Passage {
  piece: Piece;
  /** A mention, or plain words. */
  linked: boolean;
  /** The sentence around it as a reader sees it, trimmed to about 30 words. */
  text: string;
  /** Where the name is in `text`. */
  at: [number, number];
  /** Where it is in the piece's body (its Markdown), when found there: what linking it replaces. */
  raw?: [number, number];
  /** The piece's fields that name the entry (its roles there, by field key); none where it's only mentioned. */
  roles: string[];
  /**
   * Where it is in its block of prose: the block's text (as the editor's paragraph or heading reads,
   * a picture or break one character), which of the piece's blocks with that text, the name's place
   * in it, and its whole sentence's: what the writing view selects when the passage is opened.
   */
  block: { text: string; nth: number; at: [number, number]; sentence: [number, number] };
  /** For a name written as plain words: what "Not a name here" keeps of it (D19), its sentence and which plain occurrence of the entry in it. */
  notName?: { sentence: string; nth: number };
}

/** A name written as plain words in a block of prose: where, and what it names. */
export interface PlainName {
  id: string;
  at: readonly [number, number];
}

/**
 * Each plain name's sentence in the block (trimmed, as a passage gives it) and which plain occurrence
 * of its entry it is in that sentence: what "Not a name here" is kept by, and found again by.
 */
export function plainSentences(text: string, hits: readonly PlainName[], starts = sentenceStarts(text)): { sentence: [number, number]; nth: number }[] {
  const bounds = hits.map((h) => {
    const [from, to] = sentenceBounds(text, h.at[0], h.at[1], starts);
    return [from, from + text.slice(from, to).trimEnd().length] as [number, number];
  });
  return hits.map((h, i) => ({ sentence: bounds[i]!, nth: hits.slice(0, i).filter((g, j) => g.id === h.id && bounds[j]![0] === bounds[i]![0]).length }));
}

const spaced = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The one rule for "Not a name here" (D19), shared by an entry's passages, a piece's names not linked
 * and the editor's underlines: which of a block's plain names a judgement about its piece dismisses.
 * A judgement holds for the occurrence it counted (`nth`) of its entry in its sentence, found by the
 * sentence's words, or, edited a little since, by resolveAnchor; a sentence rewritten past that leaves
 * it dormant, and the name is offered again.
 */
export function dismissedIn(text: string, hits: readonly PlainName[], judgements: readonly Pick<NotName, "entry" | "sentence" | "nth">[], starts?: number[]): Set<number> {
  const out = new Set<number>();
  if (!judgements.length || !hits.length) return out;
  const where = plainSentences(text, hits, starts);
  for (const j of judgements) {
    const candidates = hits.flatMap((h, i) => (h.id === j.entry && where[i]!.nth === j.nth ? [i] : []));
    if (!candidates.length) continue;
    const sentence = spaced(j.sentence);
    let found = candidates.find((i) => spaced(text.slice(...where[i]!.sentence)) === sentence);
    if (found === undefined) {
      const near = resolveAnchor(text, j.sentence);
      if (near) found = candidates.find((i) => where[i]!.sentence[0] < near.to && where[i]!.sentence[1] > near.from);
    }
    if (found !== undefined) out.add(found);
  }
  return out;
}

/** A block's names, less the plain ones its piece's judgements dismiss. */
function namesKept(book: Book, piece: Piece, markdown: string, b: Block, matcher: NameMatcher | undefined): NameHit[] {
  const hits = namesInBlock(markdown, b, matcher);
  const judgements = notNamesIn(book, piece.id);
  if (!judgements.length) return hits;
  const plain = hits.filter((h) => !h.linked);
  const dismissed = dismissedIn(b.text, plain, judgements, starts(b));
  return dismissed.size ? hits.filter((h) => h.linked || !dismissed.has(plain.indexOf(h))) : hits;
}

function starts(b: Block): number[] {
  let at = startsCache.get(b);
  if (!at) startsCache.set(b, (at = sentenceStarts(b.text)));
  return at;
}

/** Each piece body's blocks, by its text: unchanged pieces keep theirs when the book is loaded again. */
const blocksCache = new Map<string, Block[]>();
const CACHE_LIMIT = 4000;
const startsCache = new WeakMap<Block, number[]>();
const matcherCache = new WeakMap<Book["entities"], NameMatcher | undefined>();

function blocksOf(piece: Piece): Block[] {
  let blocks = blocksCache.get(piece.body);
  if (!blocks) {
    if (blocksCache.size >= CACHE_LIMIT) blocksCache.delete(blocksCache.keys().next().value!);
    blocksCache.set(piece.body, (blocks = proseBlocks(piece.body)));
  }
  return blocks;
}

/** The book's name matcher, worked out once for its entries. */
export function bookNameMatcher(book: Book): NameMatcher | undefined {
  if (!matcherCache.has(book.entities)) matcherCache.set(book.entities, nameMatcher(mentionTargets(book)));
  return matcherCache.get(book.entities);
}

/**
 * Every passage in the book's pieces, in reading order, that mentions `id` or writes one of its names
 * or other names as plain words (where those words name it rather than another entry sharing them).
 */
export function passagesOf(book: Book, id: string): Passage[] {
  const target = mentionTargets(book).find((t) => t.id === id);
  if (!target) return [];
  const matcher = bookNameMatcher(book);
  const terms = [target.name, ...target.aliases].filter((t) => matcher?.ids.get(t) === id);
  const out: Passage[] = [];
  for (const piece of book.pieces) {
    // Most pieces never name it: skip them before parsing.
    if (!piece.body.includes(`(#${id})`) && !terms.some((t) => piece.body.includes(t))) continue;
    const roles = Object.keys(piece.fields).filter((k) => fieldNames(piece.fields[k], id));
    const blocks = blocksOf(piece);
    blocks.forEach((b, i) => {
      if (!terms.some((t) => b.text.includes(t)) && !b.runs.some((r) => r.id === id)) return;
      const hits = namesKept(book, piece, piece.body, b, matcher);
      for (const hit of hits) if (hit.id === id) out.push(passage(piece, blocks, i, hit, roles, hits));
    });
  }
  return out;
}

/** A name found in a piece's `i`th block (among the block's `hits`), as a passage: its sentence, and where it is. */
function passage(piece: Piece, blocks: Block[], i: number, hit: NameHit, roles: string[], hits: NameHit[]): Passage {
  const b = blocks[i]!;
  const at0 = starts(b);
  const { text, at } = sentenceAround(b.text, hit.at, 30, at0);
  let nth = 0;
  for (let j = 0; j < i; j++) if (blocks[j]!.text === b.text) nth++;
  const [from, to] = sentenceBounds(b.text, hit.at[0], hit.at[1], at0);
  const sentence: [number, number] = [from, from + b.text.slice(from, to).trimEnd().length];
  let notName: Passage["notName"];
  if (!hit.linked) {
    const plain = hits.filter((h) => !h.linked);
    const k = plain.indexOf(hit);
    notName = { sentence: b.text.slice(...sentence), nth: plainSentences(b.text, plain, at0)[k]!.nth };
  }
  return { piece, linked: hit.linked, text, at, ...(hit.raw ? { raw: hit.raw } : {}), roles, block: { text: b.text, nth, at: hit.at, sentence }, ...(notName ? { notName } : {}) };
}

/**
 * The names a piece writes without a link (#156), as the editor underlines them: by what each names,
 * in the order they first come, with its passages there.
 */
export function namesNotLinkedIn(book: Book, piece: Piece): { id: string; passages: Passage[] }[] {
  const matcher = bookNameMatcher(book);
  if (!matcher) return [];
  const byId = new Map<string, Passage[]>();
  const blocks = blocksOf(piece);
  blocks.forEach((b, i) => {
    const hits = namesKept(book, piece, piece.body, b, matcher);
    for (const hit of hits) {
      if (hit.linked) continue;
      const roles = Object.keys(piece.fields).filter((k) => fieldNames(piece.fields[k], hit.id));
      byId.set(hit.id, [...(byId.get(hit.id) ?? []), passage(piece, blocks, i, hit, roles, hits)]);
    }
  });
  return [...byId].map(([id, passages]) => ({ id, passages }));
}
