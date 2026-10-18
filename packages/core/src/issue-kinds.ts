/*
 * What a novel's issues are about (heffrey78/gh-writer#8, heffrey78/gh-writer#9): writing kinds rather than GitHub's software labels. A
 * kind is the label kind/<key> on GitHub, with its own colour. Which kinds there are is the book's
 * kind's to say (BookKind.issueKinds).
 */

export interface IssueKind {
  key: string;
  /** As the author reads it: "Plot hole". */
  label: string;
  /** Its label's colour on GitHub (hex, no #). */
  color: string;
  description: string;
}

/** The label on GitHub for a kind. */
export const kindLabel = (kind: IssueKind) => `kind/${kind.key}`;

/** The kind a label stands for, of those a book's kind has (BookKind.issueKinds), if it's a kind's. */
export function issueKindOf(kinds: readonly IssueKind[], label: string): IssueKind | undefined {
  return label.startsWith("kind/") ? kinds.find((k) => kindLabel(k) === label) : undefined;
}

/** The labels GitHub gives every new repository: for software, not novels. */
export const STOCK_LABELS: ReadonlySet<string> = new Set(["accessibility", "bug", "documentation", "duplicate", "enhancement", "good first issue", "help wanted", "invalid", "question", "wontfix"]);
