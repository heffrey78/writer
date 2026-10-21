# Untitled Campaign

This campaign uses the [Writer](https://github.com/heffrey78/writer) format: plain Markdown and YAML files that you can edit in the Writer app, on github.com, or in any text editor.

## Where things go

| Path | What it holds |
|---|---|
| `book.yaml` | Title, author, the world's calendar, and the kinds of relationships in it (allies, rivals, members of a faction…). |
| `dictionary.txt` | Words the spell checker should accept: the world's names. Names in the codex are known already. |
| `sessions/` | The campaign. Each arc is a folder with an `_arc.yaml`; each session is a `.md` file inside it: its prep, and what happened at the table. |
| `sessions/_order.yaml`, `_arc.yaml` | **Order.** The arcs, and each arc's sessions, by ID. The `01-` numbers in file names are just for tidy browsing. |
| `codex/npcs/`, `player-characters/`, `locations/`, `factions/`, `items/`, `quests/` | One file per NPC, player character, location, faction, item or quest. |
| `codex/relationships.yaml` | Who is allied with, rival of or a member of whom, and from which session it starts or ends. |
| `notes/` | Notes: ideas, and what the players said at the table. |
| `diagrams/README.md`, `diagrams/*.svg` | **Generated** snapshots: who turns up in which session, the quests, and the campaign in the world's time. |

## Writing by hand

- Start every session and codex file with a `---` front matter block.
- Keep each paragraph on **one line**, with a blank line between paragraphs.
- Every record has an ID such as `npc_7f3k2q`. Never change an ID; rename files and titles freely.
- Mention an NPC in a session as `[Marta](#npc_7f3k2q)`.

## Checking your work

Every push runs the validator in GitHub Actions (`.github/workflows/validate.yml`). To run it yourself, with Node 22.18 or later: `node .github/gh-writer/validate.mjs`.
