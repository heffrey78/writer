import { defineModule, entriesOf, type Book, type BookModule, type Entity, type Matter, type Piece, type Run } from "@writer/core";

/*
 * Citations (D14, #59): a book's sources, cited from its footnotes. A source is an index entry of the
 * type "source"; its title is its name, and its other details are its fields: author, year,
 * publisher, place and url (any case). A footnote cites one by mentioning it (@ in the note), and in
 * the compiled book such a mention reads as the source's short form: "Darwin, Vegetable Mould". The
 * compiled book ends with a bibliography of the sources it draws on, in one plain style:
 * "Darwin, Charles. The Formation of Vegetable Mould. London: John Murray, 1881." No citation styles
 * (APA, Chicago…) and no reference managers.
 */

/** The entry type the module cites. */
export const SOURCE = "source";

/** The details a source's fields may give, in the bibliography's order. */
export const SOURCE_FIELDS = ["author", "year", "publisher", "place", "url"] as const;

export interface SourceDetails {
  title: string;
  /** For the notes: its first alias, if it has one, else its title. */
  shortTitle: string;
  author?: string;
  year?: string;
  publisher?: string;
  place?: string;
  url?: string;
}

/** A source's details from its entry: its name, aliases and fields. */
export function sourceDetails(entity: Entity): SourceDetails {
  const field = (key: string) => {
    const found = Object.entries(entity.fields).find(([k]) => k.toLowerCase() === key);
    const value = found ? String(found[1]).trim() : "";
    return value || undefined;
  };
  const details: SourceDetails = { title: entity.name, shortTitle: entity.aliases[0] ?? entity.name };
  for (const key of SOURCE_FIELDS) {
    const value = field(key);
    if (value) details[key] = value;
  }
  return details;
}

/** An author's surname: "Charles Darwin" or "Darwin, Charles" → "Darwin"; two or more joined by "and". */
export function surname(author: string): string {
  return author
    .split(/\s+and\s+|\s*&\s*/)
    .map((a) => (a.includes(",") ? a.split(",")[0]! : a.trim().split(/\s+/).at(-1)!).trim())
    .join(" and ");
}

/** The authors for the bibliography: the first's name inverted ("Darwin, Charles"), the rest as written, joined by "and". */
function inverted(author: string): string {
  const [first, ...rest] = author.split(/\s+and\s+|\s*&\s*/).map((a) => a.trim());
  const words = first!.split(/\s+/);
  const lead = first!.includes(",") || words.length < 2 ? first! : `${words.at(-1)}, ${words.slice(0, -1).join(" ")}`;
  if (!rest.length) return lead;
  return `${[lead, ...rest.slice(0, -1)].join(", ")}, and ${rest.at(-1)}`;
}

/** How a source reads where a note cites it: "Darwin, Vegetable Mould", or its short title alone. */
export function shortCitation(entity: Entity): string {
  const d = sourceDetails(entity);
  return d.author ? `${surname(d.author)}, ${d.shortTitle}` : d.shortTitle;
}

/** A source's line in the bibliography, its title in italics: "Darwin, Charles. *Title*. London: John Murray, 1881. https://…" */
export function bibliographyEntry(entity: Entity): Run[] {
  const d = sourceDetails(entity);
  const end = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
  const imprint = [d.place && d.publisher ? `${d.place}: ${d.publisher}` : (d.publisher ?? d.place), d.year].filter(Boolean).join(", ");
  const runs: Run[] = [];
  if (d.author) runs.push({ text: `${end(inverted(d.author))} ` });
  runs.push({ text: end(d.title), em: true });
  const after = [imprint && end(imprint), d.url && end(d.url)].filter(Boolean).join(" ");
  if (after) runs.push({ text: ` ${after}` });
  return runs;
}

/**
 * The bibliography: the sources the compiled pieces draw on (named in their fields, or mentioned in
 * their text or notes), by author's surname, then title. None for a book that draws on none.
 */
export function bibliography(book: Book, drawn: { pieces: readonly Piece[]; mentioned: ReadonlySet<string> }): Matter[] {
  const ids = new Set([...drawn.mentioned, ...drawn.pieces.flatMap((p) => entriesOf(book, p, SOURCE))]);
  const sources = book.entities.filter((e) => e.type === SOURCE && ids.has(e.id));
  if (!sources.length) return [];
  const key = (e: Entity) => {
    const d = sourceDetails(e);
    return `${(d.author ? surname(d.author) : d.title).toLowerCase()}\u0000${d.title.toLowerCase()}`;
  };
  sources.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return [{ title: "Bibliography", blocks: sources.map((e) => ({ kind: "paragraph" as const, runs: bibliographyEntry(e) })) }];
}

export const citations: BookModule = defineModule({
  id: "citations",
  label: "Citations",
  compile: {
    noteMention: (_, entity) => (entity.type === SOURCE ? shortCitation(entity) : undefined),
    back: bibliography,
  },
});
