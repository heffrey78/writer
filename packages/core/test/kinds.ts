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

/**
 * A kind of book that proves the base (#35): three levels of sections (regions, habitats, families)
 * of pieces (species), its own words for everything, its own entry types, statuses and issue kinds,
 * one field of its own, and no modules. Not shipped; examples/sample-field-guide is a book of it.
 */
export const fieldGuide: BookKind = {
  key: "field-guide",
  label: "Field guide",
  plural: "Field guides",
  prefix: "fg",
  levels: [
    { key: "region", label: "Region", plural: "Regions", prefix: "reg", list: "regions", titled: true },
    { key: "habitat", label: "Habitat", plural: "Habitats", prefix: "hab", list: "habitats", titled: true },
    { key: "family", label: "Family", plural: "Families", prefix: "fam", list: "families" },
  ],
  piece: { key: "species", label: "Species", plural: "Species", prefix: "spc", list: "species" },
  words: {
    content: { label: "Guide", plural: "Guides" },
    codex: { label: "Atlas", plural: "Atlases" },
    entity: { label: "Landmark", plural: "Landmarks" },
  },
  folders: { content: "guide", codex: "atlas", notes: "notes" },
  entityTypes: [
    { key: "observer", prefix: "obs", folder: "observers", label: "Observer", color: "1f77b4", builtin: true, is: "person" },
    { key: "site", prefix: "site", folder: "sites", label: "Site", color: "2ca02c", builtin: true, is: "place" },
  ],
  statuses: [
    { key: "sketched", label: "Sketched", description: "Noted, not yet written up", color: "GRAY" },
    { key: "described", label: "Described", description: "Written up", color: "BLUE" },
    { key: "checked", label: "Checked", description: "Checked in the field", color: "GREEN" },
  ],
  fields: [{ key: "seen_at", label: "Seen at", group: "Sites", role: "seen here", type: { kind: "entities", entityType: "site" }, mentionAdds: true, outline: { column: true, filter: true } }],
  issueKinds: [
    { key: "misidentified", label: "Misidentified", color: "d73a4a", description: "A bird named wrongly" },
    { key: "photo", label: "Photo needed", color: "0075ca", description: "A picture to take" },
  ],
  modules: [],
};
