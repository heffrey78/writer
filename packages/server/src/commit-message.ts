import { countWords, parseMarkdown, vocabulary, type BookKind } from "@writer/core";

/** One staged file: its git status and its text before and after. */
export interface FileChange {
  status: "A" | "M" | "D" | "R";
  path: string;
  /** The path before a rename. */
  oldPath?: string;
  before?: string;
  after?: string;
}

const MAX_NAMES = 3;

/**
 * A commit message from what changed, in the kind's words: a summary naming the pieces and codex
 * entries, with the net change in the pieces' words, e.g. "Draft: The Station, The Bridge (+214
 * words)", then a body listing each file.
 */
export function commitMessage(changes: FileChange[], kind: BookKind): { summary: string; body: string } {
  const w = vocabulary(kind);
  const drafted: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const bible: string[] = [];
  const other: string[] = [];
  let words = 0;
  const lines: string[] = [];

  for (const change of changes) {
    const what = whatIs(kind, change.path);
    let line = `${change.status} ${change.oldPath ? `${change.oldPath} → ` : ""}${change.path}`;
    if (what === "piece") {
      const title = field(change.after ?? change.before, "title") ?? fileTitle(change.path);
      const delta = bodyWords(change.after) - bodyWords(change.before);
      words += delta;
      if (delta) line += ` (${signed(delta)})`;
      (change.status === "A" ? added : change.status === "D" ? removed : drafted).push(title);
    } else if (what === "entity") {
      bible.push(field(change.after ?? change.before, "name") ?? fileTitle(change.path));
    } else {
      other.push(change.path.split("/").pop()!);
    }
    lines.push(line);
  }

  const parts: string[] = [];
  if (drafted.length) parts.push(`Draft: ${names(drafted)}`);
  if (added.length) parts.push(`New ${added.length === 1 ? w.piece.one : w.piece.many}: ${names(added)}`);
  if (removed.length) parts.push(`Remove ${removed.length === 1 ? w.piece.one : w.piece.many}: ${names(removed)}`);
  if (bible.length) parts.push(`${w.codex.Short}: ${names(bible)}`);
  if (other.length) parts.push(`Update ${names(other)}`);
  const scenes = drafted.length + added.length + removed.length;
  const summary = (parts.join("; ") || `Update the ${w.book.one}`) + (scenes && words ? ` (${signed(words)})` : "");
  return { summary, body: lines.join("\n") };
}

/** What a changed file is, by the kind's folders: a piece, an entity of the codex, or something else. */
function whatIs(kind: BookKind, path: string): "piece" | "entity" | "other" {
  const file = path.split("/").pop()!;
  if (!file.endsWith(".md") || file.startsWith("_")) return "other";
  if (path.startsWith(`${kind.folders.content}/`)) return "piece";
  if (path.startsWith(`${kind.folders.codex}/`)) return "entity";
  return "other";
}

/** A string field from the front matter, if the file has one. */
function field(text: string | undefined, key: string): string | undefined {
  if (text === undefined) return undefined;
  const data = parseMarkdown(text, "").data as Record<string, unknown> | undefined;
  const value = data?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function bodyWords(text: string | undefined): number {
  return text === undefined ? 0 : countWords(parseMarkdown(text, "").body);
}

/** "03-the-last-rivet.md" → "the last rivet" */
function fileTitle(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/, "").replace(/^\d+-/, "").replace(/-/g, " ");
}

function names(list: string[]): string {
  const unique = [...new Set(list)];
  if (unique.length <= MAX_NAMES) return unique.join(", ");
  return `${unique.slice(0, MAX_NAMES).join(", ")} and ${unique.length - MAX_NAMES} more`;
}

function signed(n: number): string {
  return `${n > 0 ? "+" : "-"}${Math.abs(n)} ${Math.abs(n) === 1 ? "word" : "words"}`;
}
