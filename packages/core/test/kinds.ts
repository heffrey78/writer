import type { BookKind } from "../src/index.ts";
import { novel } from "@writer/kinds";

/*
 * Kinds of book for tests of levels (#24): shaped unlike a novel, to show the base reads a kind's
 * levels rather than a novel's. Not shipped.
 */

/** One level: months, each holding its days. */
export const diary: BookKind = {
  ...novel,
  key: "diary",
  label: "Diary",
  prefix: "dia",
  levels: [{ key: "month", label: "Month", prefix: "mon", list: "months" }],
  piece: { key: "day", label: "Day", prefix: "day", list: "days" },
  folders: { ...novel.folders, content: "pages", codex: "index" },
  // A field of its own, in place of the novel's: who was there that day.
  fields: [{ key: "people", label: "People", type: { kind: "entities", entityType: "character" }, mentionAdds: true }],
};

/** Three levels: volumes and parts (both optional, from the outside in), then chapters of scenes. */
export const saga: BookKind = {
  ...novel,
  key: "saga",
  label: "Saga",
  prefix: "sg",
  levels: [
    { key: "volume", label: "Volume", prefix: "vol", list: "volumes", optional: true, titled: true },
    { key: "part", label: "Part", prefix: "pt", list: "parts", optional: true, titled: true },
    { key: "chapter", label: "Chapter", prefix: "ch", list: "chapters" },
  ],
};

/** A file's text from its lines. */
export const lines = (...l: string[]) => `${l.join("\n")}\n`;

/** A piece's file: front matter with its ID and title, then prose. */
export const pieceFile = (id: string, title: string, prose = "Words.") => lines("---", `id: ${id}`, `title: ${title}`, "---", prose);
