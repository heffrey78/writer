import type { BookKind } from "@writer/core";
import { createContext, useContext } from "react";

/**
 * The open book's kind (D14, D15): its statuses, issue kinds and the rest, as the server sent it with
 * the model. Set by the book's page; read by whatever in it shows something the kind decides.
 */
export const BookKindContext = createContext<BookKind | undefined>(undefined);

export function useBookKind(): BookKind {
  const kind = useContext(BookKindContext);
  if (!kind) throw new Error("useBookKind is for what a book's page shows");
  return kind;
}

/** A status's label in the open book's kind ("Drafted"), by its key. */
export function useStatusLabel(): (key: string) => string {
  const { statuses } = useBookKind();
  return (key) => statuses.find((s) => s.key === key)?.label ?? key;
}
