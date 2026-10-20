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
  plural: "Diaries",
  prefix: "dia",
  levels: [{ key: "month", label: "Month", plural: "Months", prefix: "mon", list: "months" }],
  piece: { key: "day", label: "Day", plural: "Days", prefix: "day", list: "days" },
  words: {
    content: { label: "Pages", plural: "Pages" },
    codex: { label: "Index", plural: "Indexes", article: "an" },
    entity: { label: "Item", plural: "Items" },
  },
  folders: { ...novel.folders, content: "pages", codex: "index" },
  // No modules: none of the novel's point of view. A field of its own, in place of the novel's: who was there that day.
  modules: [],
  fields: [{ key: "people", label: "People", type: { kind: "entities", entityType: "character" }, mentionAdds: true }],
};

/** Three levels: volumes and parts (both optional, from the outside in), then chapters of scenes. */
export const saga: BookKind = {
  ...novel,
  key: "saga",
  label: "Saga",
  prefix: "sg",
  levels: [
    { key: "volume", label: "Volume", plural: "Volumes", prefix: "vol", list: "volumes", optional: true, titled: true },
    { key: "part", label: "Part", plural: "Parts", prefix: "pt", list: "parts", optional: true, titled: true },
    { key: "chapter", label: "Chapter", plural: "Chapters", prefix: "ch", list: "chapters" },
  ],
};

/** A file's text from its lines. */
export const lines = (...l: string[]) => `${l.join("\n")}\n`;

/** A piece's file: front matter with its ID and title, then prose. */
export const pieceFile = (id: string, title: string, prose = "Words.") => lines("---", `id: ${id}`, `title: ${title}`, "---", prose);
