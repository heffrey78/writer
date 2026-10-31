import type { BookKind } from "@writer/core";

/**
 * A journal (#5): years (if it has them), months and entries, a day's writing each, with an index of
 * the people, places, events and values in it. Entries are dated (story time's `when`), and presence
 * shows who and what runs through them. A journal kept as a novel in gh-writer keeps its IDs when it's
 * converted: the Novel's prefixes are its former ones.
 */
export const journal: BookKind = {
  key: "journal",
  label: "Journal",
  plural: "Journals",
  prefix: "jn",
  formerPrefixes: ["nv"],
  levels: [
    { key: "year", label: "Year", plural: "Years", prefix: "yr", list: "years", optional: true, titled: true, formerPrefixes: ["pt"] },
    { key: "month", label: "Month", plural: "Months", prefix: "mon", list: "months", titled: true, formerPrefixes: ["ch"] },
  ],
  piece: { key: "entry", label: "Entry", plural: "Entries", article: "an", prefix: "ent", list: "entries", madeByDate: true, formerPrefixes: ["sc"] },
  words: {
    content: { label: "Journal", plural: "Journals" },
    codex: { label: "Index", plural: "Indexes", article: "an" },
    entity: { label: "Item", plural: "Items", article: "an" },
  },
  folders: { content: "entries", codex: "index", notes: "notes" },
  entityTypes: [
    { key: "person", prefix: "per", folder: "people", label: "Person", plural: "People", color: "1f77b4", builtin: true, is: "person", formerPrefixes: ["char"] },
    { key: "place", prefix: "pl", folder: "places", label: "Place", color: "2ca02c", builtin: true, is: "place", formerPrefixes: ["loc"] },
    { key: "event", prefix: "ev", folder: "events", label: "Event", color: "ff7f0e", builtin: true },
    { key: "value", prefix: "val", folder: "values", label: "Value", color: "9467bd", builtin: true, formerPrefixes: ["theme"] },
  ],
  statuses: [
    { key: "draft", label: "Draft", description: "Written, not yet finished for the day", color: "GRAY" },
    { key: "kept", label: "Kept", description: "Finished for the day", color: "GREEN" },
  ],
  fields: [
    { key: "people", label: "People", role: "there", type: { kind: "entities", entityType: "person" }, mentionAdds: true, outline: { column: true, filter: true }, snapshot: true },
    { key: "places", label: "Places", role: "here", type: { kind: "entities", entityType: "place" }, mentionAdds: true, lanes: true, marks: { present: "here" } },
    { key: "events", label: "Events", role: "happened", type: { kind: "entities", entityType: "event" }, mentionAdds: true },
    { key: "entities", label: "Also in it", role: "there", type: { kind: "own-entities" }, mentionAdds: true },
    {
      key: "values",
      label: "Values",
      role: "lived",
      snapshot: true,
      marks: { carries: "strongly", present: "present" },
      type: {
        kind: "entities",
        entityType: "value",
        item: [
          { key: "strength", label: "Strength", kind: "scale", min: 1, max: 3, labels: { "1": "faint", "2": "medium", "3": "strong" }, options: { "1": "1 (faint)", "2": "2", "3": "3 (strong)" } },
          { key: "note", label: "Note", kind: "text", onCard: false },
        ],
      },
    },
  ],
  // An entry's date first on its card, then who, where and what.
  modules: ["presence", "story-time", "daily"],
  // Looking back comes first, from the journal page, where today's is written too; a journal has
  // little use for an outline, or for comparing drafts.
  sidebar: [
    { key: "look-back", label: "Look back", pages: ["read", "calendar", "notes", "issues"] },
    { key: "people-and-places", label: "People and places", pages: ["index", "relationships", "story-map", "progress"] },
  ],
  home: "read",
  // On a phone, after the journal page: the days, the notes and who and where.
  bar: ["calendar", "notes", "index"],
  newestFirst: true,
  fieldOrder: ["when", "people", "places", "events", "entities", "values"],
  issueKinds: [
    { key: "follow-up", label: "Follow up", color: "0075ca", description: "Something to come back to" },
    { key: "fact", label: "Fact", color: "fbca04", description: "Something to check" },
  ],
};
