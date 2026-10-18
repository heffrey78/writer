import type { BookKind } from "@writer/core";

/** A novel: parts (if it has them), chapters and scenes, with a story bible (gh-writer's format v2). */
export const novel: BookKind = {
  key: "novel",
  label: "Novel",
  prefix: "nv",
  levels: [
    { key: "part", label: "Part", prefix: "pt", list: "parts", optional: true, titled: true },
    { key: "chapter", label: "Chapter", prefix: "ch", list: "chapters" },
  ],
  piece: { key: "scene", label: "Scene", prefix: "sc", list: "scenes" },
  folders: { content: "manuscript", codex: "bible", notes: "notes", events: "events" },
  entityTypes: [
    { key: "character", prefix: "char", folder: "characters", label: "Character", color: "1f77b4", builtin: true },
    { key: "location", prefix: "loc", folder: "locations", label: "Location", color: "2ca02c", builtin: true },
    { key: "plotline", prefix: "plot", folder: "plotlines", label: "Plotline", color: "d62728", builtin: true },
    { key: "theme", prefix: "theme", folder: "themes", label: "Theme", color: "9467bd", builtin: true },
  ],
  statuses: [
    { key: "idea", label: "Idea", description: "A scene not yet planned", color: "GRAY" },
    { key: "outlined", label: "Outlined", description: "Planned, not yet written", color: "BLUE" },
    { key: "drafted", label: "Drafted", description: "Written in a first draft", color: "YELLOW" },
    { key: "revised", label: "Revised", description: "Rewritten after a draft", color: "ORANGE" },
    { key: "final", label: "Final", description: "Done", color: "GREEN" },
  ],
  issueKinds: [
    { key: "plot-hole", label: "Plot hole", color: "d73a4a", description: "Something in the story that can't happen" },
    { key: "continuity", label: "Continuity", color: "fbca04", description: "Facts that don't agree" },
    { key: "research", label: "Research", color: "0075ca", description: "Something to look up" },
    { key: "idea", label: "Idea", color: "a2eeef", description: "Something to try" },
    { key: "revision", label: "Revision", color: "7057ff", description: "Something to rewrite" },
  ],
};
