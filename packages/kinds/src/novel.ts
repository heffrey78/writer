import type { BookKind } from "@writer/core";

/** A novel: parts (if it has them), chapters and scenes, with a story bible (gh-writer's format v2). */
export const novel: BookKind = {
  key: "novel",
  label: "Novel",
  plural: "Novels",
  prefix: "nv",
  levels: [
    { key: "part", label: "Part", plural: "Parts", prefix: "pt", list: "parts", optional: true, titled: true },
    { key: "chapter", label: "Chapter", plural: "Chapters", prefix: "ch", list: "chapters" },
  ],
  piece: { key: "scene", label: "Scene", plural: "Scenes", prefix: "sc", list: "scenes" },
  words: {
    content: { label: "Manuscript", plural: "Manuscripts" },
    codex: { label: "Story bible", plural: "Story bibles", short: "Bible" },
    entity: { label: "Entry", plural: "Entries", article: "an" },
  },
  folders: { content: "manuscript", codex: "bible", notes: "notes", events: "events" },
  entityTypes: [
    { key: "character", prefix: "char", folder: "characters", label: "Character", color: "1f77b4", builtin: true },
    { key: "location", prefix: "loc", folder: "locations", label: "Location", color: "2ca02c", builtin: true },
    { key: "theme", prefix: "theme", folder: "themes", label: "Theme", color: "9467bd", builtin: true },
  ],
  statuses: [
    { key: "idea", label: "Idea", description: "A scene not yet planned", color: "GRAY" },
    { key: "outlined", label: "Outlined", description: "Planned, not yet written", color: "BLUE" },
    { key: "drafted", label: "Drafted", description: "Written in a first draft", color: "YELLOW" },
    { key: "revised", label: "Revised", description: "Rewritten after a draft", color: "ORANGE" },
    { key: "final", label: "Final", description: "Done", color: "GREEN" },
  ],
  fields: [
    { key: "locations", label: "Where", group: "Locations", role: "set here", type: { kind: "entities", entityType: "location" }, mentionAdds: true, lanes: true, marks: { present: "set here" } },
    { key: "characters", label: "Characters", role: "present", type: { kind: "entities", entityType: "character" }, mentionAdds: true, outline: { column: true, filter: true } },
    { key: "when", label: "When", type: { kind: "story-time", durationKey: "duration" } },
    { key: "entities", label: "Also in it", role: "present", type: { kind: "own-entities" }, mentionAdds: true },
    {
      key: "themes",
      label: "Themes",
      role: "theme",
      marks: { carries: "strongly", present: "present" },
      type: {
        kind: "entities",
        entityType: "theme",
        item: [
          { key: "strength", label: "Strength", kind: "scale", min: 1, max: 3, labels: { "1": "faint", "2": "medium", "3": "strong" }, options: { "1": "1 (faint)", "2": "2", "3": "3 (strong)" } },
          { key: "note", label: "Note", kind: "text", onCard: false },
        ],
      },
    },
  ],
  // Its modules' fields and types where they've always been: point of view first on the card,
  // plotlines after when, the plotline type after locations.
  modules: ["point-of-view", "plotlines"],
  fieldOrder: ["pov", "locations", "characters", "when", "plotlines", "entities", "themes"],
  entityTypeOrder: ["character", "location", "plotline", "theme"],
  issueKinds: [
    { key: "plot-hole", label: "Plot hole", color: "d73a4a", description: "Something in the story that can't happen" },
    { key: "continuity", label: "Continuity", color: "fbca04", description: "Facts that don't agree" },
    { key: "research", label: "Research", color: "0075ca", description: "Something to look up" },
    { key: "idea", label: "Idea", color: "a2eeef", description: "Something to try" },
    { key: "revision", label: "Revision", color: "7057ff", description: "Something to rewrite" },
  ],
};
