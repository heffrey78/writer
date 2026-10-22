import type { BookKind } from "@writer/core";

/**
 * A work of non-fiction (#7): parts (if it has them) and chapters of sections, with an index of the
 * sources it draws on, the people in it, the concepts it explains and the claims it makes. Concepts
 * are threads through the book; presence shows which sources, people and concepts each chapter
 * turns to. Research notes are the book's notes. Its footnotes cite its sources (the citations
 * module). No dates of a story: story time isn't one of its modules.
 */
export const nonfiction: BookKind = {
  key: "nonfiction",
  label: "Non-fiction book",
  plural: "Non-fiction books",
  prefix: "nf",
  levels: [
    { key: "part", label: "Part", plural: "Parts", prefix: "pt", list: "parts", optional: true, titled: true },
    { key: "chapter", label: "Chapter", plural: "Chapters", prefix: "ch", list: "chapters", titled: true },
  ],
  // A section's title is its heading in the compiled book.
  piece: { key: "section", label: "Section", plural: "Sections", prefix: "sec", list: "sections", headed: true },
  words: {
    content: { label: "Text", plural: "Texts" },
    codex: { label: "Index", plural: "Indexes", article: "an" },
    entity: { label: "Entry", plural: "Entries", article: "an" },
  },
  folders: { content: "text", codex: "index", notes: "notes" },
  entityTypes: [
    { key: "source", prefix: "src", folder: "sources", label: "Source", color: "8c564b", builtin: true },
    { key: "person", prefix: "per", folder: "people", label: "Person", plural: "People", color: "1f77b4", builtin: true, is: "person" },
    { key: "concept", prefix: "con", folder: "concepts", label: "Concept", color: "9467bd", builtin: true },
    { key: "claim", prefix: "clm", folder: "claims", label: "Claim", color: "d62728", builtin: true },
  ],
  statuses: [
    { key: "outline", label: "Outline", description: "Its points, not yet written out", color: "GRAY" },
    { key: "draft", label: "Draft", description: "Written, not yet revised", color: "YELLOW" },
    { key: "revised", label: "Revised", description: "Revised for sense and flow", color: "BLUE" },
    { key: "checked", label: "Checked", description: "Its facts and sources checked", color: "GREEN" },
  ],
  fields: [
    { key: "sources", label: "Sources", role: "drawn on", type: { kind: "entities", entityType: "source" }, mentionAdds: true, outline: { column: true, filter: true }, snapshot: true },
    { key: "people", label: "People", role: "in it", type: { kind: "entities", entityType: "person" }, mentionAdds: true },
    { key: "concepts", label: "Concepts", role: "explained", type: { kind: "entities", entityType: "concept" }, mentionAdds: true, threads: true, lanes: true, outline: { column: true, filter: true }, snapshot: true },
    { key: "claims", label: "Claims", role: "made", type: { kind: "entities", entityType: "claim" }, mentionAdds: true },
    { key: "entities", label: "Also in it", role: "in it", type: { kind: "own-entities" }, mentionAdds: true },
  ],
  // Citations: a footnote cites a source, and the compiled book ends with a bibliography.
  modules: ["presence", "citations"],
  // Issues lead Revise: fact checks and citations needed are a non-fiction book's revision.
  sidebar: [
    { key: "plan", label: "Plan", pages: ["outline", "index", "notes", "relationships", "story-map", "progress"] },
    { key: "revise", label: "Revise", pages: ["issues", "compare"] },
  ],
  fieldOrder: ["sources", "people", "concepts", "claims", "entities"],
  // Who argues what, and how the ideas build on each other.
  graphTypes: ["person", "concept", "claim"],
  issueKinds: [
    { key: "fact-check", label: "Fact check", color: "d93f0b", description: "A fact to verify" },
    { key: "citation", label: "Citation needed", color: "fbca04", description: "A source to find and cite" },
    { key: "research", label: "Research", color: "0075ca", description: "Something to look into" },
    { key: "idea", label: "Idea", color: "a2eeef", description: "Something to try" },
  ],
};
