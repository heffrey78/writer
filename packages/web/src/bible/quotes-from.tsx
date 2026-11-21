import { quotesIn, resolveAnchor, type Book, type Piece } from "@writer/core";
import { sceneText } from "@writer/editor";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { requestQuote } from "../novel/go-to-passage.ts";

/*
 * The quotes an entry's notes keep from pieces (#157), each a way back to its sentence: the piece it
 * names, with the words selected where they're found now (resolveAnchor, as an issue's passage is),
 * or said to be gone when the piece no longer has them.
 */

/** The piece a quote came from: of those with its title, the one that still has the words, else the first. */
function pieceOf(novel: Book, title: string, quote: string): { piece: Piece | undefined; found: boolean } {
  const named = novel.allPieces.filter((p) => p.title === title);
  const holding = named.find((p) => resolveAnchor(sceneText(p.body), quote));
  return { piece: holding ?? named[0], found: !!holding };
}

const short = (quote: string) => {
  const one = quote.replace(/\s+/g, " ");
  return one.length > 60 ? `${one.slice(0, 59)}…` : one;
};

export function QuotesFrom({ novelId, novel, body }: { novelId: string; novel: Book; body: string }) {
  const navigate = useNavigate();
  const quotes = useMemo(() => quotesIn(body).map((q) => ({ ...q, ...pieceOf(novel, q.title, q.quote) })), [body, novel]);
  if (!quotes.length) return null;
  return (
    <ul aria-label="Quoted from the text" className="grid gap-0.5 text-[13px]">
      {quotes.map((q, i) =>
        q.piece && q.found ? (
          <li key={i}>
            <button
              type="button"
              onClick={() => {
                const to = requestQuote(novelId, q.piece!, q.quote);
                if (to) void navigate(to);
              }}
              aria-label={`Open “${q.title}” at “${short(q.quote)}”`}
              className="text-left text-accent underline decoration-accent/35 underline-offset-[3px] hover:decoration-accent"
            >
              “{short(q.quote)}” in {q.title}
            </button>
          </li>
        ) : (
          <li key={i} className="text-muted">
            “{short(q.quote)}”: no longer in {q.piece ? `“${q.title}”` : `a ${q.title ? `piece called “${q.title}”` : "piece"}`}.
          </li>
        ),
      )}
    </ul>
  );
}
