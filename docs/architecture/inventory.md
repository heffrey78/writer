# Inventory: where the novel is built in

*A record of the starting point, kept as written. The work it led to is done (#3, #4). For how kinds and modules are now, see [DEVELOPER.md](../../DEVELOPER.md#kinds-and-modules).*

What [#3](https://github.com/heffrey78/writer/issues/3) (kinds) and [#4](https://github.com/heffrey78/writer/issues/4) (modules) start from: every feature of the app as imported from gh-writer, sorted into the **base**, the **Novel kind** or a **module** ([D14](https://github.com/heffrey78/writer/issues/10)), and every novel concept that's hard-coded, with where it's read. Written for [#17](https://github.com/heffrey78/writer/issues/17), at commit c22a411. It's a proposal for the owner to review: the classification and the glossary decide what the next tasks are.

- **Base:** every kind of book wants it. It works in neutral terms and shows each kind's words.
- **Novel kind:** data, not code: the novel's levels, words, built-in types, statuses, template and compile presets.
- **Module:** code that some kinds use and others don't, plugged in only through extension points.

## Glossary

Neutral terms for base code, never shown to writers. The kind's vocabulary supplies the words on screen.

| Neutral term (code) | Novel | Journal | Campaign | Non-fiction |
|---|---|---|---|---|
| book | novel | journal | campaign | book |
| section (a level above pieces) | part, chapter | month | arc | part, chapter |
| piece (the writing unit, one file) | scene | day (entry) | session | section |
| codex (the reference half of a book) | story bible | index | codex | research |
| entity (an item of the codex) | entry (character, location…) | person, place, event, value | NPC, place, faction, item, quest | source, person, concept |
| relationship, note | the same | the same | the same | the same |
| event (off page) | off-page event | (not used) | backstory | (not used) |

Changes from [D15](https://github.com/heffrey78/writer/issues/11) as proposed, because its terms collide with names already in the code:

- **piece, not page.** "Page" is what the web app calls every view (`novel-page.tsx`, `bible-page.tsx`, `notes-page.tsx`, `ui/page.ts`). "Piece" is used today only as an ordinary word in three comments (`core/merge.ts`, `editor/markdown.ts`, `editor/search.ts`).
- **codex, not index.** "Index" means a position throughout the code (`Relationship.index`, `indexById`).
- **entity, not entry.** The code and the format already say entity (`Entity`, `entity_types`, the scenes' `entities` field), and the format keeps those names. "Entry" stays the word on screen.
- **book, with the compiler's book renamed.** `core/compile.ts` has `Book` and `BookSection` (the compiled book and its front and back matter). They become `CompiledBook` and `Matter`.
- **kind is always qualified.** `BookKind` for the kind of book, `IssueKind` for the kinds of issue (`kind/plot-hole` labels on GitHub, `core/issue-kinds.ts`) and `RecordKind` (`core/model.ts`), so "kind" alone never appears in a type name.

For the owner: the Journal's writing unit and the codex's items both want the word "entry". The Journal's vocabulary has to pick one: a day is a "day" (and the Entry tab stays), or a codex item is something else ("person", "place", by type, with "index item" for the group).

## Novel concepts in the code

| Concept | Defined in | Read in | Goes to |
|---|---|---|---|
| Structure: manuscript → parts (optional) → chapters → scenes; `_order.yaml`, `_part.yaml`, `_chapter.yaml` | `core/load.ts`, `core/model.ts` (`Part`, `Chapter`, `Scene`, `topLevel`), `core/types.ts`, `core/schemas/` | core: compare, compile, diagrams, entry-presence, validate. server: manuscript, board. export: docx. web: manuscript-tree, structure, structure-dialogs, outline, board, compare-page, strip, profile, presence-page, swimlanes-page. editor: `chapter.ts` (a chapter as one document) | Base, with levels from the kind. The Novel kind declares part (optional) and chapter. The chapter editor becomes "a section as one document" |
| Folder names `manuscript/`, `bible/`, `diagrams/`, `images/`, `notes/` | `core/load.ts` (`NOTES_FOLDER`, `EVENTS_FOLDER`), server paths | core: load, validate. server: bible, manuscript, files, image-routes. web: 1 | Base, with the content and codex folder names from the kind (`manuscript/`, `bible/` for the Novel) |
| ID prefixes `nv`, `pt`, `ch`, `sc` | `core/ids.ts` (`STRUCTURE_PREFIXES`) | everywhere IDs are made | The kind: each level declares its prefix. New books get `bk_` (D15) |
| Built-in entity types character, location, plotline, theme (`char`, `loc`, `plot`, `theme`), colours | `core/ids.ts` (`BUILTIN_ENTITY_TYPES`, `RESERVED_PREFIXES`) | core: diagrams, facts, load, snapshots, validate. server: bible, board. web: new-entry, pictures (a location's picture is wide), strip, type-sections, event-page, graph-page, board, corkboard, item-modals, mention-sync, outline-time, scene-details, presence-page, timeline-page | The Novel kind's default types. Which types are "people" or "places" (for pictures and story time) becomes a property of the type, not its key |
| Scene fields `characters`, `locations` | `core/types.ts`, `core/load.ts` | core: diagrams (`LISTS`, `presentIn`), time (overlap), validate (`W_TIME_OVERLAP`), queries. web: scene-details, mention-sync (a mention adds the entity to these lists), timeline lanes | Declared fields: the Novel kind's entity-list fields for its character and location types. Other kinds declare theirs; v2's names stay |
| Scene field `pov` | `core/types.ts` | core: compare, diagrams, entry-presence (carries the scene), entry-profile, load, queries, snapshots, time, validate (`W_POV_NOT_PRESENT`). server: board (POV field), manuscript. web: entry-page, quick-entry, raise, board, corkboard(-order), outline(-time), scene-details, presence-page (ring), timeline-page (lanes) | Module **point-of-view** |
| Scene field `plotlines` (`{id, weight, beat}`), `plotline_gap` | `core/types.ts`, `core/diagrams.ts` (`swimlanes`, `gaps`) | core: compare, entry-profile (beats), facts, load, migrate, queries, snapshots, validate. server: bible, manuscript. web: swimlanes-page, gap-controls, type-sections, plotline-edits, corkboard, outline, scene-details, story-map, graph-page (filter), event-page | Module **plotlines** (with the plotline type, which the Novel kind lists) |
| Scene field `themes` (`{id, strength, note}`) | `core/types.ts` | core: diagrams, entry-presence, entry-profile (strength by scene), snapshots. web: type-sections, presence-page, scene-details, plotline-edits | The Novel kind's field (an entity list with a strength), drawn by **presence** |
| Scene statuses idea, outlined, drafted, revised, final | `core/load.ts` (`SCENE_STATUSES`), `core/types.ts`, schema | client: api. server: board (GitHub single-select options). web: board, board-github, outline | The kind: a piece's statuses, in order, with the first the default |
| Story time: `when`, `duration`, `calendar.start`, Day 1 | `core/time.ts`, `core/facts.ts`, `core/types.ts` | core: compare, diagrams (`timeline`, `jump`), entry-profile, load, migrate, stats, validate (`W_TIME_OVERLAP`). server: bible (`updateCalendar`), stats. web: timeline-page, day-one, outline-time, scene-details, mention-card, event-page, bible-page | Module **story-time**. The Journal dates its pieces from their place in the calendar instead |
| Off-page events (`bible/events/`, `evt_`), format v1's `events.yaml` and its migration | `core/load.ts`, `core/model.ts` (`StoryEvent`), `core/migrate.ts` | core: compare, entry-presence, facts, queries, time, validate. server: bible. web: events/*, strip, item-modals, mention-card, notes (promote), outline-time, writing-view, entry-tab | Module **off-page-events**, which needs story-time. Mentions of events stay base: any module's records can be mentionable |
| Issue kinds (Plot hole, Continuity, Research…) | `core/issue-kinds.ts` | web: issues/raise, parts | The kind: its issue kinds and their colours. The `kind/` label prefix stays (format) |
| Compile: standard manuscript format (Letter, Times 12 pt double-spaced, title page with contact and rounded word count, "Chapter Four") | `core/compile.ts` (`heading`, `numberWords`, `wordCount`), `export/docx.ts`, `export/pdf.ts`, `CompilePreset` | server: compile-routes. cli: compile. web: novel/compile | The compile pipeline and EPUB are base. Manuscript format is a layout in module **manuscript-format**, chosen by the Novel kind's default preset |
| `novel.yaml` and "novel" in names | `core/types.ts` (`NovelFile`), `core/model.ts` (`Novel`, `RecordKind "novel"`) | 458 uses in core, 591 in server, 2,084 in web | Base `Book`, manifest `book.yaml` (D15). Renamed in one mechanical step after the glossary is accepted |
| Words on screen: novel, scene, chapter, part, story bible, POV, plotline… | string literals | about 7,000 occurrences, most in web | Base reads them from the kind's vocabulary |
| Novel template | `templates/novel/` | server: new-novel. scripts: build:template, publish-template | One template per kind |
| Library: "novels", "isn't a novel" (no `novel.yaml`) | `server/library.ts` | library routes, web library | Base: books, recognised by `book.yaml` or (v2) `novel.yaml` |
| Desktop menu: New Novel…, Your Novels | `desktop/src-tauri/src/lib.rs` | | Base: the kind-neutral words ("New Book…", "Your Shelf"), with the kind chosen in the dialog |

## Features by package

### core (5,200 lines)

| File | Feature | Goes to |
|---|---|---|
| `load.ts`, `model.ts`, `types.ts`, `schemas.ts`, `source.ts`, `node.ts`, `parse.ts` | Loading a book into a model; JSON Schemas | Base, driven by the kind's structure and declared fields |
| `ids.ts` | IDs | Base; prefixes from the kind |
| `validate.ts` | Validator | Base checks; `W_POV_NOT_PRESENT` to point-of-view, `W_TIME_OVERLAP` to story-time, `W_EVENTS_YAML` to off-page-events |
| `edit.ts`, `merge.ts`, `word-diff.ts`, `compare.ts`, `words.ts`, `stats.ts` | YAML edits that keep layout, three-way merge, word diffs, comparing two states, word counts, writing statistics | Base. `compare.ts` describes pov, plotlines and story time changes: those descriptions come from each field's declaration |
| `queries.ts` | Backlinks, relationship history, notes of a scene | Base; `SceneLink` (pov, characters…) becomes "the field that links" |
| `entry-presence.ts`, `entry-profile.ts`, `facts.ts` | How an entity is in a piece; type-specific profile parts; "what the book says about a scene" | Base frame; the type-specific parts (a plotline's beats, a theme's strength, a location's visitors, story-time facts) move to their modules |
| `diagrams.ts`, `snapshots.ts`, `palette.ts` | Graph, swimlanes, presence, timeline data; SVG and Mermaid snapshots; relationship colours | Graph and palette base. Swimlanes to plotlines, presence to presence, timeline to story-time. Each module contributes its snapshots |
| `time.ts` | Story time | story-time |
| `compile.ts` | The compiled book model | Base; manuscript-format headings and title page to manuscript-format |
| `migrate.ts` | v1 → v2 | Base framework; the v1 events move belongs to off-page-events |
| `issue-anchor.ts`, `anchor-match.ts`, `issue-kinds.ts`, `entity-labels.ts` | Issues anchored to passages, issue kinds, entity labels | Base; issue kinds from the kind |
| `dictionary.ts` | The book's spell-check dictionary | Base |

### server (8,700 lines)

| File | Feature | Goes to |
|---|---|---|
| `server.ts`, `app.ts`, `security.ts`, `web.ts`, `app-info.ts` | The local server, its security, the web app, About and updates | Base |
| `library.ts`, `library-routes.ts`, `new-novel.ts`, `publish.ts` | The shelf, new books from a template, putting a book on GitHub | Base; the template from the kind |
| `workspace.ts`, `files.ts`, `operations.ts`, `committer.ts`, `commit-message.ts`, `conflicts.ts` | Files, atomic writes refused on change, background commits, conflicts | Base. Commit messages name scenes and entries: words from the kind |
| `git.ts`, `git-source.ts`, `sync.ts`, `versions.ts`, `version-routes.ts`, `checkpoints.ts`, `compare-routes.ts` | git, sync, versions, checkpoints, comparisons | Base |
| `github.ts`, `github-routes.ts`, `issues.ts`, `issues-routes.ts` | GitHub sign-in, issues and their cache | Base |
| `manuscript.ts`, `manuscript-routes.ts` | Making, moving and deleting parts, chapters and scenes | Base, over the kind's levels |
| `bible.ts`, `bible-routes.ts`, `image-routes.ts`, `diagrams.ts` | Codex entities, relationships, types, events, notes, pictures, layouts; `updateCalendar`, `updateTarget` | Base; events to off-page-events, calendar to story-time |
| `board.ts`, `board-routes.ts` | The drafting board on GitHub Projects | Module **drafting-board** (statuses from the kind) |
| `stats.ts`, `compile-routes.ts`, `migrate.ts` | Writing history, compile, migration | Base |

### client (1,200 lines)

`api.ts` (the typed API client) and `autosave.ts`: base. The API types name novels, scenes and statuses; they follow core's renames, and module routes get typed clients of their own.

### editor (5,000 lines)

All base: the TipTap schema and lossless Markdown, the chapter-as-one-document view, mentions and link suggestions, find and replace, spell check, word counts, writing modes, issue marks, pictures and the conflict resolver. `pinned-lines.ts` shows whichever details the app gives it, so the details come from the declared fields. Nothing here is novel-specific apart from the words "scene" and "chapter" in its types (493 and 119 uses), which become piece and section.

### web (18,800 lines)

| Area | Feature | Goes to |
|---|---|---|
| `layout.tsx`, `palette.tsx`, `commands.ts`, `global-commands.tsx`, `history.tsx`, `context-menu.tsx`, `desktop*.ts(x)`, `theme.ts`, `about.tsx`, `identity.tsx`, `ui/` | The app's frame, command palette, Back and Forward, right-click menu, desktop bridge, theme | Base. The palette and the sidebar are where modules add commands and views |
| `library/` | The shelf, covers, new/open/clone | Base; New asks for the kind |
| `novel/novel-page.tsx`, `writing-view.tsx`, `workspace.ts`, `manuscript-tree.tsx`, `structure*.ts(x)`, `sidebar.tsx`, `right-sidebar.tsx`, `notice.tsx`, `save-status.tsx`, `sync-badge.tsx`, `conflicts.tsx`, `spell.ts`, `current.ts`, `events.ts` | The book's workspace: writing view, tree, sidebars, saving, sync | Base |
| `novel/scene-details.tsx` (870 lines) | The Scene card: every detail of a scene, edited in place, and the pinned lines | Base frame, built from the declared fields. The largest single piece of work in the extraction |
| `novel/outline*.tsx`, `corkboard*.ts(x)` | Outline as a table and as cards, filters by POV, plotline, status, character | Base, with columns and filters from fields |
| `novel/board*.tsx` | Drafting board | drafting-board |
| `novel/drafts.tsx`, `versions.tsx`, `compare-page.tsx` | Versions, checkpoints, comparison | Base |
| `novel/progress-*.tsx`, `today-count.tsx` | Progress and goals | Base |
| `novel/compile.tsx` | Compile dialog | Base; presets from the kind and modules |
| `novel/mention-card.tsx`, `mention-sync.ts`, `entry-tab.tsx`, `item-modals.tsx`, `picture-in-text.tsx` | Mention cards, mentions that add to a scene's lists, the Entry tab, modals over galleries | Base; which list a mention adds to comes from the fields |
| `novel/story-map.tsx` | Story map: tabs of plotlines, presence, timeline | Base frame whose tabs modules contribute |
| `bible/` | The codex: gallery, profiles, relationships and arcs, types, pictures, quick entry | Base; `type-sections.tsx` (a location's visitors, a plotline's beats, a theme's strength) splits into the modules that own those parts |
| `graph/` | Relationship graph with a story-position slider | Base. Every kind planned has relationships |
| `swimlanes/`, `diagrams/gap-*` | Plotline swimlanes | plotlines |
| `presence/` | Presence matrices | Module **presence**: entities against pieces, for any entity type |
| `timeline/` | Timeline, Day 1 | story-time |
| `events/` | Off-page events | off-page-events |
| `notes/` | Notes, scene notes, promoting a note | Base; "promote to an event" is offered by off-page-events |
| `issues/`, `github/` | Issues, passage notes, Connect GitHub, Put on GitHub | Base |

### export, cli, desktop

- **export:** EPUB, zip, cover and files are base. `docx.ts` and `pdf.ts` lay out standard manuscript format and move to manuscript-format, with the base keeping a plain layout for kinds without one.
- **cli:** base. `serve`, `validate`, `snapshots`, `compile`, `migrate` and `new-id`, and the bundles vendored into books, which are built with each kind's modules.
- **desktop:** base. Only the menu's words are novel-specific.

## Modules

| Module | What it holds | Kinds that would use it |
|---|---|---|
| point-of-view | `pov` field, `W_POV_NOT_PRESENT`, POV filters, lanes and rings | Novel |
| plotlines | the plotline type and `plotlines` field (weight, beat), swimlanes, gaps, beats on profiles | Novel, maybe Campaign (quests) |
| presence | entities × pieces matrices, for any entity type | Novel, Journal, Campaign |
| story-time | `when`, `duration`, calendar and Day 1, the timeline, the outline in story time, `W_TIME_OVERLAP` | Novel, Campaign |
| off-page-events | events as files, their pages, gallery and modals, writing one as a scene, promoting a note | Novel, Campaign |
| drafting-board | the board in the app and on GitHub Projects | Novel, Non-fiction |
| manuscript-format | DOCX and PDF in standard manuscript format, numbered chapter headings, the submission title page | Novel |

The relationship graph, the codex, notes, mentions, issues, versions, progress and compile stay in the base: every kind planned wants them.

## Extension points the modules need

Read off the table above: each is needed by at least one module being extracted, so none is designed in the abstract.

1. **Fields** on pieces and events: a type (entity list filtered by entity type, with optional per-item data like weight or strength; enum; date; duration; text; tags), a label, validation, how it reads in the Scene card, the pinned lines, outline columns and filters, comparisons and commit messages, and whether a mention adds to it.
2. **Validator checks** with their codes and severities.
3. **Codex profile sections** for an entity type.
4. **Views**: a route with a sidebar entry (Plan or Revise), or a tab of the story map.
5. **Commands** in the palette and the ⋯ menu.
6. **Server routes** under a book, and a typed client for them.
7. **Snapshots**: files written into `diagrams/`.
8. **Compile layouts and presets.**
9. **Migrations** of a module's own files.

## Order of extraction

Each step keeps every check green and leaves the Novel exactly as it is. The tasks for #3 and #4 come from this list.

1. **Accept the glossary** (amend D15). Rename `Book`/`BookSection` in compile to `CompiledBook`/`Matter`.
2. **Kind definition in core**, and the Novel kind as data that reproduces today's constants: levels and prefixes, built-in types, statuses, folder names, issue kinds. Core reads them from the kind. A test generates v2's JSON Schemas from the Novel kind and compares them with the committed ones.
3. **Vocabulary**: a catalogue of the words on screen, read from the kind, area by area (library, writing view, codex, outline, issues, desktop menu). The e2e suite, which asserts the words, shows nothing changed.
4. **Neutral names in base code**: `Novel` → `Book`, `Scene` → `Piece`, `Chapter`/`Part` → `Section` with a level, in core, then server and client, then editor and web. Mechanical, one package at a time.
5. **Levels from the kind**: structure, order files, the tree and manuscript operations over any number of levels.
6. **Declared fields**: the loader, validator, edits, Scene card, outline and comparisons driven by field declarations. Novel's fields declared under their v2 names.
7. **Module registry** and the boundary test (the base imports no module), then the modules, one per step: point-of-view, plotlines, presence, story-time, off-page-events, drafting-board, manuscript-format.
8. **Manifest v3** (`book.yaml`, `kind:`), reading v2 as the Novel kind, `writer migrate` ([#2](https://github.com/heffrey78/writer/issues/2)).
9. **A test kind** with three levels, its own words and no modules: it loads, validates, compiles and shows its own words, with no change to the base.

Steps 2 and 3 can run alongside each other; 4 is best done before 5 and 6 so they're written in the new names.

## Questions for the owner

1. The Journal's word for its writing unit and for codex items (see *Glossary*).
2. Off-page events as a module (this proposal) or base: are backstory events useful in a journal or non-fiction?
3. The relationship graph in the base (this proposal) or a module.
4. Writing goals and progress in the base (this proposal): a journal's daily goal is the same feature.
