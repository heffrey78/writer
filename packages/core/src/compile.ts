import type { Nodes, PhrasingContent, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toString } from "mdast-util-to-string";
import { gfm } from "micromark-extension-gfm";
import { modulesOf } from "./modules.ts";
import { outerSections, pieceSections, picturePath, type Book } from "./model.ts";
import { parseMarkdown } from "./parse.ts";
import type { BookKind } from "./kinds.ts";
import type { FileSource } from "./source.ts";
import type { CompilePreset } from "./types.ts";
import { vocabulary, type Word } from "./vocabulary.ts";
import { countWords } from "./words.ts";

/*
 * Compiling the manuscript (heffrey78/gh-writer#19, D6): the scenes in reading order, as a book every output format
 * (DOCX, EPUB, PDF) renders the same way. Only the story's words come through: a mention is its words,
 * a link its text; front matter, hidden notes (HTML comments) and other markup stay behind.
 */

/** A stretch of text in one style. `text` may hold "\n" for a line break within a paragraph. */
export interface Run {
  text: string;
  em?: boolean;
  strong?: boolean;
}

export type Align = "left" | "center" | "right" | null;

export type Block =
  | { kind: "paragraph"; runs: Run[]; quote?: boolean }
  /** A break between scenes, or one written within a scene: the preset's marker. */
  | { kind: "break" }
  /** A scene's own heading (a letter's date, a document's title), 1-3: set beneath the chapter's heading (D10). */
  | { kind: "heading"; level: 1 | 2 | 3; runs: Run[] }
  /** A bulleted or numbered list (from `start`); each item is its blocks: paragraphs and lists. */
  | { kind: "list"; ordered: boolean; start: number; items: Block[][]; quote?: boolean }
  /** A table: its header row and rows, each cell a line of runs; each column's alignment. */
  | { kind: "table"; align: Align[]; header: Run[][]; rows: Run[][][] }
  /** A picture on a line of its own: its repository path (images/…), alt text and caption. */
  | { kind: "image"; path: string; alt: string; caption?: string };

export interface CompiledChapter {
  id: string;
  /** Its number in the whole book (a range keeps the numbers), and its heading as the preset has it. */
  number: number;
  heading: string;
  /** The part it opens, when it's the first chapter of one: its heading as the layout has it ("Part One"), which may be its title. */
  part?: { id: string; title: string; number: number; heading: string };
  blocks: Block[];
}

/** Front or back matter: a page with a title (its first heading) and its text. */
export interface Matter {
  title: string;
  blocks: Block[];
}

export interface CompiledBook {
  /** The novel's ID: e-books' identifier. */
  id: string;
  title: string;
  author: string;
  language: string;
  titlePage: {
    contact: string[];
    /** As the title page shows it ("about 82,000 words"), or undefined for none. */
    wordCount: string | undefined;
  };
  /** What the running header says before the page number, from the second page: "Vale / BRIDGE AT VARN / " (none: the number alone). */
  runningHead: string;
  /** After the last chapter, as the layout has it: "THE END". */
  end?: string;
  /** Line spacing, in lines: 2, double-spaced (manuscript format). */
  spacing: number;
  sceneBreak: string;
  front: Matter[];
  chapters: CompiledChapter[];
  back: Matter[];
  /** Words in the chapters compiled (exact). */
  words: number;
}

/**
 * How a compiled book is laid out (#32): the words and conventions of its pages, which the DOCX and
 * PDF follow and the EPUB's headings too. A kind names its layout (BookKind.compileLayout), which a
 * module it uses brings (standard manuscript format, the Novel's); the base keeps a plain one.
 */
export interface CompileLayout {
  key: string;
  label: string;
  /** A chapter's heading (a section of the innermost level): "Chapter Four: The Flood". */
  heading(view: { preset: CompilePreset; number: number; title: string | undefined; level: Word }): string;
  /** A part's heading (a section of the level outside it): "Part One". Its title follows it, unless it's the heading. */
  partHeading(view: { number: number; title: string | undefined; level: Word }): string;
  /** The title page's contact lines (top left) and word count (top right). */
  titlePage(view: { preset: CompilePreset; author: string; words: number }): { contact: string[]; wordCount: string | undefined };
  /** What the running header says before the page number: "Vale / BRIDGE AT VARN / ". */
  runningHead(view: { preset: CompilePreset; title: string; author: string }): string;
  end?: string;
  /** Line spacing, in lines. */
  spacing: number;
  /** What the compile dialog says of the Word file, the PDF and the cover. */
  says: { docx: string; pdf: string; cover: string };
}

/** The base's layout: headings in the kind's words, the title and byline on the title page, page numbers, one and a half spacing. */
export const PLAIN_LAYOUT: CompileLayout = {
  key: "plain",
  label: "Plain",
  heading: ({ preset, number, title, level }) => (title && preset.chapter_heading !== "number" ? title : `${level.One} ${number}`),
  partHeading: ({ number, title, level }) => title || `${level.One} ${number}`,
  titlePage: ({ preset, words }) => ({ contact: preset.title_page?.contact ?? [], wordCount: preset.word_count === "exact" ? `${words.toLocaleString("en-US")} words` : undefined }),
  runningHead: () => "",
  spacing: 1.5,
  says: { docx: "for word processors", pdf: "laid out like the Word file", cover: "On the EPUB's cover and the PDF's first page." },
};

/** A kind's layout: the one it names, from its modules, or the base's plain one. */
export function layoutOf(kind: BookKind): CompileLayout {
  const key = kind.compileLayout;
  return (key && modulesOf(kind).flatMap((m) => m.layouts ?? []).find((l) => l.key === key)) || PLAIN_LAYOUT;
}

export interface CompileOptions {
  /** A preset in compile.yaml; default: the first there, or Writer's own. */
  preset?: string;
  /** The chapters to compile, by ID, inclusive; default the whole book. */
  from?: string;
  to?: string;
}

export class CompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompileError";
  }
}

/** The presets to choose from: compile.yaml's, or Writer's own "manuscript". */
export function presets(novel: Book): Record<string, CompilePreset> {
  return novel.compile?.presets ?? { manuscript: {} };
}

/** Compile the novel (or chapters `from`…`to`) with a preset into a book. Reads front and back matter through `source`. */
export async function compileBook(novel: Book, source: Pick<FileSource, "read">, options: CompileOptions = {}): Promise<CompiledBook> {
  const all = presets(novel);
  const name = options.preset ?? Object.keys(all)[0]!;
  const preset = all[name];
  if (!preset) throw new CompileError(`There's no preset “${name}” in compile.yaml.`);
  const title = novel.config?.title ?? "Untitled";
  const author = preset.title_page?.author ?? novel.config?.author ?? "";
  const layout = layoutOf(novel.kind);
  const w = vocabulary(novel.kind);

  const chapters = pieceSections(novel);
  const first = options.from ? chapters.findIndex((c) => c.id === options.from) : 0;
  const last = options.to ? chapters.findIndex((c) => c.id === options.to) : chapters.length - 1;
  if (first < 0 || last < 0) throw new CompileError("The range names a chapter that isn't in the book.");
  if (first > last) throw new CompileError("The range ends before it starts.");

  const byId = new Map(novel.allPieces.map((s) => [s.id, s]));
  const parts = new Map(outerSections(novel).map((p, i) => [p.id, { ...p, number: i + 1 }]));
  const chapterOut: CompiledChapter[] = [];
  let words = 0;
  for (let i = first; i <= last; i++) {
    const chapter = chapters[i]!;
    const blocks: Block[] = [];
    for (const sceneId of chapter.childIds) {
      const scene = byId.get(sceneId);
      if (!scene) continue;
      const body = prose(scene.body);
      if (!body.length) continue;
      // Scenes are set apart by the break; a scene's own break that starts or ends it would double it.
      if (blocks.length) blocks.push({ kind: "break" });
      blocks.push(...trimBreaks(body));
      words += countWords(scene.body);
    }
    const part = chapter.parentId ? parts.get(chapter.parentId) : undefined;
    const opensPart = part && part.childIds[0] === chapter.id;
    chapterOut.push({
      id: chapter.id,
      number: i + 1,
      heading: layout.heading({ preset, number: i + 1, title: chapter.title, level: w.level(chapter.level) }),
      ...(opensPart ? { part: { id: part.id, title: part.title ?? "", number: part.number, heading: layout.partHeading({ number: part.number, title: part.title, level: w.level(part.level) }) } } : {}),
      blocks,
    });
  }

  const matter = async (paths: string[] | undefined) => {
    const out: Matter[] = [];
    for (const path of paths ?? []) {
      const text = await source.read(path);
      if (text === undefined) throw new CompileError(`The preset names ${path}, which is missing.`);
      out.push(section(text, path));
    }
    return out;
  };

  return {
    id: novel.config?.id ?? "",
    title,
    author,
    language: novel.config?.language ?? "en",
    titlePage: layout.titlePage({ preset, author, words }),
    runningHead: layout.runningHead({ preset, title, author }),
    ...(layout.end ? { end: layout.end } : {}),
    spacing: layout.spacing,
    sceneBreak: preset.scene_break ?? "#",
    front: await matter(preset.front),
    chapters: chapterOut,
    back: await matter(preset.back),
    words,
  };
}

/** A front- or back-matter file: its first heading is its title, the rest its text. */
function section(text: string, path: string): Matter {
  // Front matter of its own, if it has any, isn't part of the page.
  const body = /^---\r?\n/.test(text) ? parseMarkdown(text, path).body : text;
  const tree = mdast(body);
  const first = tree.children.findIndex((n) => n.type === "heading");
  const titleNode = first >= 0 ? tree.children[first] : undefined;
  const title = titleNode ? toString(titleNode).trim() : (path.split("/").at(-1) ?? path).replace(/\.md$/, "").replace(/[-_]+/g, " ");
  return { title, blocks: trimBreaks(tree.children.filter((_, i) => i !== first).flatMap((n) => blocks(n, false))) };
}

/** A scene body's blocks. */
function prose(markdown: string): Block[] {
  return mdast(markdown).children.flatMap((n) => blocks(n, false));
}

function mdast(markdown: string): Root {
  return fromMarkdown(markdown.replace(/\r\n?/g, "\n"), { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

/** Breaks at the start or end, or two together, said once or not at all. */
function trimBreaks(list: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of list) {
    if (b.kind === "break" && (!out.length || out.at(-1)!.kind === "break")) continue;
    out.push(b);
  }
  while (out.at(-1)?.kind === "break") out.pop();
  return out;
}

function blocks(node: Nodes, quote: boolean): Block[] {
  switch (node.type) {
    case "paragraph": {
      const picture = pictureOf(node.children);
      if (picture) return [picture];
      const runs = merge(inline(node.children, {}));
      return runs.length ? [{ kind: "paragraph", runs, ...(quote ? { quote: true } : {}) }] : [];
    }
    case "blockquote":
      return node.children.flatMap((c) => blocks(c, true));
    case "thematicBreak":
      return [{ kind: "break" }];
    case "html":
      // Hidden notes (<!-- … -->) and other raw HTML aren't the story.
      return [];
    case "heading": {
      const runs = merge(inline(node.children, {}));
      return runs.length ? [{ kind: "heading", level: Math.min(node.depth, 3) as 1 | 2 | 3, runs }] : [];
    }
    case "list": {
      const items = node.children.map((item) => item.children.flatMap((c) => blocks(c, false))).filter((item) => item.length);
      return items.length ? [{ kind: "list", ordered: !!node.ordered, start: node.start ?? 1, items, ...(quote ? { quote: true } : {}) }] : [];
    }
    case "table": {
      const [head, ...body] = node.children.map((row) => row.children.map((cell) => merge(inline(cell.children, {}))));
      return head ? [{ kind: "table", align: (node.align ?? []).map((a) => a ?? null), header: head, rows: body }] : [];
    }
    case "code": {
      const text = toString(node).trim();
      return text ? [{ kind: "paragraph", runs: [{ text }], ...(quote ? { quote: true } : {}) }] : [];
    }
    default:
      return "children" in node ? (node.children as Nodes[]).flatMap((c) => blocks(c, quote)) : [];
  }
}

/**
 * A paragraph that is only a picture under images/ (D10), as an image block. Pictures elsewhere, or
 * within a line of text, aren't the story's words: they're left out, as before.
 */
function pictureOf(children: PhrasingContent[]): Block | undefined {
  const content = children.filter((c) => !(c.type === "text" && !c.value.trim()));
  const image = content.length === 1 && content[0]!.type === "image" ? content[0]! : undefined;
  const path = image && picturePath(image.url);
  if (!image || !path) return undefined;
  return { kind: "image", path, alt: image.alt ?? "", ...(image.title ? { caption: image.title } : {}) };
}

/** Every picture a book shows (their repository paths), in order, each once: what the formats embed. */
export function bookImages(book: Pick<CompiledBook, "front" | "chapters" | "back">): string[] {
  const paths = new Set<string>();
  const visit = (list: Block[]) => {
    for (const b of list) {
      if (b.kind === "image") paths.add(b.path);
      else if (b.kind === "list") b.items.forEach(visit);
    }
  };
  for (const s of [...book.front, ...book.chapters, ...book.back]) visit(s.blocks);
  return [...paths];
}

/**
 * A book's blocks as paragraphs and breaks only, for formats that don't set headings, lists, tables
 * or pictures yet: a heading or a list item is a paragraph, a table's row a paragraph of its cells,
 * a picture its caption.
 */
export function flatBlocks(list: Block[]): Extract<Block, { kind: "paragraph" | "break" }>[] {
  return list.flatMap((b): Extract<Block, { kind: "paragraph" | "break" }>[] => {
    switch (b.kind) {
      case "paragraph":
      case "break":
        return [b];
      case "heading":
        return [{ kind: "paragraph", runs: b.runs }];
      case "list":
        return b.items.flatMap((item) => flatBlocks(item).map((p) => (b.quote && p.kind === "paragraph" ? { ...p, quote: true } : p)));
      case "table":
        return [b.header, ...b.rows].map((row) => ({ kind: "paragraph" as const, runs: merge(row.flatMap((cell, i) => (i ? [{ text: "   " }, ...cell] : cell))) }));
      case "image":
        return b.caption ? [{ kind: "paragraph", runs: [{ text: b.caption }] }] : [];
    }
  });
}

/** Soft line breaks (hard-wrapped prose) read as spaces, as in the editor. */
const unwrap = (text: string) => text.replace(/[ \t]*\n[ \t]*/g, " ");

function inline(nodes: PhrasingContent[], style: { em?: boolean; strong?: boolean }): Run[] {
  const out: Run[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        out.push({ text: unwrap(n.value), ...style });
        break;
      case "emphasis":
        out.push(...inline(n.children, { ...style, em: true }));
        break;
      case "strong":
        out.push(...inline(n.children, { ...style, strong: true }));
        break;
      case "break":
        out.push({ text: "\n", ...style });
        break;
      case "link":
      case "linkReference":
      case "delete":
        // A mention ([Ada](#char_…)) or a link: its words.
        out.push(...inline(n.children, style));
        break;
      case "inlineCode":
        out.push({ text: n.value, ...style });
        break;
      case "html":
        break;
      default:
        if ("children" in n) out.push(...inline(n.children as PhrasingContent[], style));
        else if ("value" in n && typeof n.value === "string") out.push({ text: n.value, ...style });
    }
  }
  return out;
}

/** Neighbouring runs in the same style as one; empty ones gone; the paragraph's ends trimmed. */
function merge(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out.at(-1);
    if (last && !!last.em === !!r.em && !!last.strong === !!r.strong) last.text += r.text;
    else out.push({ text: r.text, ...(r.em ? { em: true } : {}), ...(r.strong ? { strong: true } : {}) });
  }
  if (out.length) {
    out[0]!.text = out[0]!.text.replace(/^\s+/, "");
    out[out.length - 1]!.text = out.at(-1)!.text.replace(/\s+$/, "");
  }
  return out.filter((r) => r.text);
}
