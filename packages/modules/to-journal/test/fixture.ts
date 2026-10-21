import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/*
 * A journal kept as a novel, as gh-writer's journal keepers have them: a chapter a month, a scene a
 * day titled by its date (some dated in `when`, some not), the people and places in the story bible,
 * a theme with a strength, relationships, a note on a day, and a kind of relationship for plotlines
 * that nothing uses. Format 3 (book.yaml, kind: novel), as the owner's.
 */

const lines = (...l: string[]) => `${l.join("\n")}\n`;

export const JOURNAL_AS_NOVEL: Record<string, string> = {
  "book.yaml": lines("schema_version: 3", "kind: novel", "id: nv_j0vrna", "title: Journal", 'author: "Jeff"', "relationship_types:", "  - key: partner", "    label: Partner of", "    symmetric: true", "  - key: mentor", "    label: Mentor of", "    from_types: [character]", "    to_types: [character]", "  - key: explores", "    label: Explores", "    from_types: [plotline]", "    to_types: [theme]"),
  "manuscript/_order.yaml": lines("chapters: [ch_0ctb26]"),
  "manuscript/01-october-2026/_chapter.yaml": lines("id: ch_0ctb26", "title: October 2026", "scenes: [sc_0810ab, sc_1020ab]"),
  "manuscript/01-october-2026/01-thursday-10-08-2026.md": lines("---", "id: sc_0810ab", "title: Thursday, 10/08/2026", "status: drafted", "characters: [char_a1exab]", "when:", "  at: 2026-10-08", "---", "[Alex](#char_a1exab) and I walked to [Troy](#loc_tr0yab)."),
  "manuscript/01-october-2026/02-tuesday-10-20-2026.md": lines("---", "id: sc_1020ab", "title: Tuesday, 10/20/2026", "status: idea", "characters:", "  - char_a1exab", "locations: [loc_tr0yab]", "themes:", "  - id: theme_10veab", "    strength: 3", "---", "I'm nervous this morning.", "", "Today, I want to plough through as much as possible."),
  "bible/characters/alex.md": lines("---", "id: char_a1exab", "name: Alex", "---"),
  "bible/characters/me.md": lines("---", "id: char_meab00", "name: Me", "aliases: [I]", "---"),
  "bible/characters/.gitkeep": "",
  "bible/locations/troy.md": lines("---", "id: loc_tr0yab", "name: Troy", "---"),
  "bible/themes/love.md": lines("---", "id: theme_10veab", "name: Love", "---"),
  "bible/plotlines/.gitkeep": "",
  "bible/events/.gitkeep": "",
  "bible/relationships.yaml": lines("relationships:", "  - {id: rel_a1exme, from: char_a1exab, to: char_meab00, type: partner}"),
  "notes/a-walk.md": lines("---", "id: note_wa1kab", "title: Another walk", "scenes: [sc_1020ab]", "---", "With [Alex](#char_a1exab)."),
  "diagrams/layouts.yaml": lines("layouts: {}"),
};

/** The fixture in `dir`, a git repository with one commit. */
export function journalAsNovel(dir: string, files = JOURNAL_AS_NOVEL): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
  git("init", "-q", "-b", "main");
  // Its own name and email, for the conversion's commit too: CI's git knows nobody.
  git("config", "user.name", "Test Author");
  git("config", "user.email", "author@example.com");
  git("add", "-A");
  git("commit", "-qm", "Start");
  return dir;
}
