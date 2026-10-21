import { conversionsOf, type Book, type Conversion } from "@writer/core";
import { useState } from "react";
import { api } from "../api.ts";
import type { Command } from "../commands.ts";
import { Confirm } from "../ui/confirm.tsx";
import { useNotice } from "./notice.tsx";

/**
 * Making the book another kind (#39), as its kind's modules offer: a palette command for each
 * conversion ("Make this book a journal…"), and the dialog that says what it does first. Once it's
 * done, the book opens afresh as its new kind, and what the writer should know is said.
 */
export function useConversions(novelId: string, novel: Book | undefined) {
  const show = useNotice((n) => n.show);
  const [asking, setAsking] = useState<Conversion>();
  const commands: Command[] = novel ? conversionsOf(novel.kind).map((c) => ({ id: `book.convert.${c.to}`, title: c.label, group: "Book", run: () => setAsking(c) })) : [];
  const convert = async (c: Conversion) => {
    try {
      const { notes } = await api.convert(novelId, c.to);
      // The kind is another: its words, views and modules with it.
      sessionStorage.setItem("writer.converted", JSON.stringify(notes));
      window.location.assign(`/novels/${novelId}`);
    } catch (e) {
      show({ message: `Couldn't do it: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
  const dialog = asking && <Confirm open onOpenChange={(o) => !o && setAsking(undefined)} title={`${asking.label.replace(/…$/, "")}?`} description={asking.says} action="Do it" onConfirm={() => void convert(asking)} />;
  return { commands, dialog };
}

/** What a conversion said, once the book has opened as its new kind. */
export function convertedNotes(): string[] | undefined {
  try {
    const saved = sessionStorage.getItem("writer.converted");
    if (saved === null) return undefined;
    sessionStorage.removeItem("writer.converted");
    return JSON.parse(saved) as string[];
  } catch {
    return undefined;
  }
}
