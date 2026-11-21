/*
 * Words from the text kept in an entry's notes (#157): a Markdown blockquote of them, then a plain
 * attribution line naming the piece they came from, “— *The Station*”. No new syntax: it reads as a
 * quote anywhere, and the app finds the sentence again by the quote within the named piece
 * (resolveAnchor), so it survives the piece being edited around it.
 */

/** Characters Markdown would read as emphasis or escapes in a title, escaped. */
const escapeTitle = (title: string) => title.replace(/([\\*_`[\]])/g, "\\$1");
const unescape = (s: string) => s.replace(/\\([\\*_`[\]])/g, "$1");

/**
 * The notes with a quote from a piece added at the end, after a blank line. Nothing before it
 * changes: the body's own last line keeps its ending, and the quote uses the body's line endings.
 */
export function appendQuote(body: string, quote: string, title: string): string {
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = quote.trim().split(/\r?\n/).map((l) => (l.trim() ? `> ${l.trimEnd()}` : ">"));
  const added = `${lines.join(eol)}${eol}${eol}— *${escapeTitle(title)}*${eol}`;
  if (!body.trim()) return body + added;
  if (body.endsWith(eol + eol)) return body + added;
  if (body.endsWith(eol)) return body + eol + added;
  return body + eol + eol + added;
}

/** A quote kept in notes: its words (paragraphs joined by a blank line, as a piece's text reads) and the piece's title. */
export interface KeptQuote {
  quote: string;
  title: string;
}

/** The quotes from pieces kept in notes: each blockquote followed, after a blank line, by an attribution line. */
export function quotesIn(body: string): KeptQuote[] {
  const lines = body.split(/\r?\n/);
  const out: KeptQuote[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^>/.test(lines[i]!)) continue;
    const start = i;
    while (i < lines.length && /^>/.test(lines[i]!)) i++;
    const quoted = lines.slice(start, i).map((l) => l.replace(/^> ?/, ""));
    // Then a blank line, and "— *Title*".
    const by = lines[i] === "" ? lines[i + 1] : undefined;
    const title = by?.match(/^— \*(.+)\*\s*$/)?.[1];
    if (title) out.push({ quote: quoted.join("\n").replace(/\n{3,}/g, "\n\n").trim(), title: unescape(title) });
    i--;
  }
  return out;
}
