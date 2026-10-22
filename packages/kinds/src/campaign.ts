import type { BookKind } from "@writer/core";

/**
 * A tabletop campaign (#6), as a game master plans and runs it: arcs of sessions, a session's prep
 * before it and its notes after, and a codex of NPCs and player characters, locations, factions,
 * items and quests. Quests are threads through the sessions; relationships change at a session, so
 * the graph shows the campaign as it moves. Presence shows who turns up when, and story time the
 * world's calendar. No dice or rules: Writer plans and remembers, the table plays.
 */
export const campaign: BookKind = {
  key: "campaign",
  label: "Campaign",
  plural: "Campaigns",
  prefix: "cmp",
  levels: [{ key: "arc", label: "Arc", plural: "Arcs", article: "an", prefix: "arc", list: "arcs", titled: true }],
  piece: {
    key: "session",
    label: "Session",
    plural: "Sessions",
    prefix: "ses",
    list: "sessions",
    // Prep as many game masters do it, then a place for what happened.
    template: "## Strong start\n\n## Scenes\n\n## Secrets and clues\n\n## NPCs\n\n## Locations\n\n## Treasure\n\n## At the table\n",
    quickNote: { command: "Note from the table", title: "At the table" },
  },
  words: {
    content: { label: "Campaign", plural: "Campaigns" },
    codex: { label: "Codex", plural: "Codices" },
    entity: { label: "Entry", plural: "Entries", article: "an" },
  },
  folders: { content: "sessions", codex: "codex", notes: "notes" },
  entityTypes: [
    { key: "npc", prefix: "npc", folder: "npcs", label: "NPC", plural: "NPCs", color: "1f77b4", builtin: true, is: "person" },
    { key: "pc", prefix: "pc", folder: "player-characters", label: "Player character", color: "17becf", builtin: true, is: "person" },
    { key: "location", prefix: "loc", folder: "locations", label: "Location", color: "2ca02c", builtin: true, is: "place" },
    { key: "faction", prefix: "fac", folder: "factions", label: "Faction", color: "9467bd", builtin: true },
    { key: "item", prefix: "itm", folder: "items", label: "Item", color: "8c564b", builtin: true },
    { key: "quest", prefix: "qst", folder: "quests", label: "Quest", color: "d62728", builtin: true },
  ],
  statuses: [
    { key: "planned", label: "Planned", description: "An idea for a session", color: "GRAY" },
    { key: "prepped", label: "Prepped", description: "Ready to run", color: "BLUE" },
    { key: "played", label: "Played", description: "Run at the table", color: "GREEN" },
  ],
  fields: [
    { key: "party", label: "Party", role: "playing", type: { kind: "entities", entityType: "pc" }, mentionAdds: true },
    { key: "npcs", label: "NPCs", role: "in it", type: { kind: "entities", entityType: "npc" }, mentionAdds: true, outline: { column: true, filter: true }, snapshot: true },
    { key: "locations", label: "Where", group: "Locations", role: "visited", type: { kind: "entities", entityType: "location" }, mentionAdds: true, lanes: true, marks: { present: "visited" } },
    { key: "factions", label: "Factions", role: "in play", type: { kind: "entities", entityType: "faction" }, mentionAdds: true },
    { key: "items", label: "Items", role: "in play", type: { kind: "entities", entityType: "item" }, mentionAdds: true },
    { key: "quests", label: "Quests", role: "advanced", type: { kind: "entities", entityType: "quest" }, mentionAdds: true, threads: true, lanes: true, outline: { column: true, filter: true }, snapshot: true },
    { key: "entities", label: "Also in it", role: "in it", type: { kind: "own-entities" }, mentionAdds: true },
  ],
  // The world's calendar under the session's title, then who and what is in it.
  modules: ["presence", "story-time"],
  sidebar: [
    { key: "prep", label: "Prep", pages: ["index", "notes", "outline", "issues"] },
    { key: "world", label: "The world", pages: ["relationships", "story-map"] },
    { key: "look-back", label: "Look back", pages: ["progress", "compare"] },
  ],
  fieldOrder: ["when", "party", "npcs", "locations", "factions", "items", "quests", "entities"],
  // Who stands with whom: the factions are on the graph with the people.
  graphTypes: ["npc", "pc", "faction"],
  issueKinds: [
    { key: "loose-end", label: "Loose end", color: "fbca04", description: "A thread to pick up" },
    { key: "ruling", label: "Ruling", color: "0075ca", description: "A rules call to look up" },
    { key: "idea", label: "Idea", color: "a2eeef", description: "Something to try" },
  ],
};
