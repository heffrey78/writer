# Developing Writer

This guide is for people working on Writer itself. For using it, see [USER.md](USER.md).

## Setup

You need Node.js 22.18 or later (it runs TypeScript directly, so there's no build step for the server or CLI) and git.

```sh
npm install
npm run build                      # the web app, into packages/web/dist
npx writer serve examples/sample-novel
```

For working on the UI, `npm run dev` serves the web app with hot reload through Vite, with a real writer server inside it. That server uses your own library unless you point `WRITER_CONFIG_DIR` at another folder, which is wise while experimenting. `npm run playground -w @writer/editor` serves the editor on its own, with every sample scene and a 10,000-word chapter.

## Architecture

Writer is a local-first web app (decision [D2](https://github.com/heffrey78/gh-writer/issues/22)). `writer serve` starts a server on 127.0.0.1 that reads and writes the novel's git repository on disk, and opens the browser on it with a token made for that launch, traded for a session cookie. The browser app talks only to that server; the server talks to git and to GitHub.

```
browser ── web (React) ── client (API, autosave) ──HTTP──► server (Hono) ── core (format, model)
                                                             │  ├── git (the git port: system git, or libgit2)
                                                             │  ├── GitHub (REST API, device-flow sign-in)
                                                             │  └── export (DOCX, EPUB, PDF)
cli ── serve / validate / snapshots / compile ───────────────┘
```

The novel itself is the source of truth: plain Markdown and YAML files ([format spec](docs/format/v3.md), decision [D3](https://github.com/heffrey78/gh-writer/issues/23)). Story facts live in files and GitHub Issues hold work and discussion ([D1](https://github.com/heffrey78/gh-writer/issues/21)). The stack is TypeScript throughout, React, TipTap/ProseMirror, React Flow, Hono and the system git ([D4](https://github.com/heffrey78/gh-writer/issues/24)). Signing in to GitHub and using that for git is [D5](https://github.com/heffrey78/gh-writer/issues/91); compiling with our own TypeScript and pure-JavaScript libraries is [D6](https://github.com/heffrey78/gh-writer/issues/122); versions as branches, adopted by merging, compared commit to commit, are [D7](https://github.com/heffrey78/gh-writer/issues/129).

## Packages

| Package | What it is |
|---|---|
| [`core`](packages/core) | The novel format: JSON Schemas, types, the loader (`loadBook`) and story model, the validator, word counts, IDs, edits to YAML that keep comments and layout, three-way merge, diagram data and SVG snapshots, issue anchors and labels, the compiler's book model (`compileBook`), and comparing two states of a novel with a word-level diff (`compareNovels`). Runs in the browser and in Node. |
| [`editor`](packages/editor/README.md) | The prose editor: TipTap schema, lossless Markdown round-trip, the scene and chapter editors, mentions, find and replace, spell check, word counts and the conflict resolver. |
| [`client`](packages/client/README.md) | The browser side of the server: a typed API client and autosave. |
| [`server`](packages/server/README.md) | The local server: Hono API, library, file writes, background commits, sync, checkpoints, versions, comparisons, GitHub connection, issue cache and outbox, compile route. Its README documents the API. |
| [`web`](packages/web) | The app: library, writing view, story bible, diagrams, issues, command palette. React, react-query, zustand, Radix, cmdk and Tailwind. |
| [`export`](packages/export) | DOCX (hand-written WordprocessingML), EPUB 3 and PDF (pdfkit, with Liberation Serif) from a compiled book; zipped with fflate. |
| [`cli`](packages/cli) | `writer serve`, `validate`, `snapshots`, `compile`, `migrate` and `new-id`, and the entry points bundled into novel repositories. |
| [`desktop`](packages/desktop) | The desktop app: a Tauri shell that runs the server bundle on its own Node and git, and opens a window on it. |
| [`mobile`](packages/mobile) | The Android app (D16): the web app and the engine in a Tauri webview, its git (libgit2, in process), files, GitHub's HTTP and the token in Rust. See *The Android app*. |
| [`git2-port`](packages/git2-port) | The git port over libgit2, in Rust (D16): the same operations as the server's git, for Android, where there's no git binary. A stdio binary for the contract suite on the desktop. |
| [`kinds`](packages/kinds) | The kinds of book the app ships, as data (D14, D15): the Novel's levels, ID prefixes, folders, built-in entry types, statuses, issue kinds, its scenes' fields (each field's type is how the schema, the validator, the Scene card, the outline, comparisons and mentions read it), the modules it uses and its words on screen. See *Kinds and modules*. |

Other folders:

- `templates/novel`: the template every new novel starts from, including its workflows and vendored tools.
- `examples/sample-novel`: *The Bridge at Varn*, the sample used by tests, screenshots and the playground.
- `docs/format/v3.md`: the format spec.
- `scripts/`: the bundler for vendored tools and the sample compile.

## Kinds and modules

A kind of book is data in `packages/kinds` (D14, D15): the Novel, the Journal (#5; `examples/sample-journal` is one) and the Campaign (#6; `examples/sample-campaign`). A module is a first-party feature that some kinds use and others don't, in `packages/modules/<name>` (`@writer/module-<name>`), with a core half, a web half and a server half where it needs them, under subpath exports. A kind lists its modules by id, in `modules`.

The base never imports a kind or a module: `packages/core/test/boundary.test.ts` fails if any file of the base packages does, except the app's entry points, which register what the app ships:

- `registerKinds()` from `@writer/kinds` registers the modules' core halves, then the kinds. The CLI, the bundles vendored into books, the editor's playground and the tests' setup call it. A kind is registered with what its modules add (`withModules`), and `loadBook` completes a kind passed to it the same way.
- The web app's `main.tsx` registers the modules' web halves (`registerWebModule`). The web app gets the book's kind, complete, with the book from the server.
- The CLI's `main.ts` and the dev server (`vite.config.ts`) register the modules' server halves (`registerServerModule`).

A module may need another (`needs`): off-page events need story time, and a kind that lists one without the other is refused when it's registered.

The rest of the code reads a book's kind from its model (`book.kind`), or in the web app from `useBookKind()`. The words on screen come from the kind too (#22): `vocabulary(kind)` in core, or `useWords()` in the web app, says the book, its levels, its piece, its content, its codex and an entity in the forms a sentence needs (`w.piece.one` "scene", `w.piece.a` "a scene", `w.level("chapter").count(3)` "3 chapters", `w.codex.One` "Story bible"). Base code never writes "scene" or "chapter" itself.

A module contributes only through these extension points. Each was added when a module needed it (D14), so the list grows as modules move out of the base:

| Extension point | Half | What it is |
|---|---|---|
| `fields` | core (`defineModule`) | Fields a piece's front matter holds, declared as a kind declares them (`FieldDef`), after the kind's own unless the kind's `fieldOrder` places them. They're in the schema and the validator's reference checks, on the piece's card, and in the outline, comparisons and mentions as their declaration says. A module can't declare a field its kind already has. |
| `entityTypes` | core | Entry types of the codex, after the kind's own unless the kind's `entityTypeOrder` places them (the plotline). |
| `checks` | core | Validator checks: a code, its severity, and `find(book)`, which returns what it found (file, message, and a pointer or line). They run after the base's, in the app, on the CLI and in a book's GitHub Action. |
| `snapshots` | core | Diagrams for the book's `diagrams/` folder, and a section of its README, after the relationships, in the order the kind lists its modules. The vendored snapshot writer and the app draw the same bytes. |
| `views` | web (`WebModule`) | Pages of the book: a route under it (and below it, `path/*`), a label and an icon, listed in the sidebar's Plan or Revise group after the base's views, and in the palette under "Go to". A view with no group has no place in either: it's reached another way (Today's entry, at /today). |
| `shelfActions` | web | What the module offers on a book's tile on the shelf, and in the shelf's palette: opening the book at a page of its own (Today's entry). The library lists each book's kind and the kind's modules (`kind`, `modules`), so the shelf knows. `command` names the action's palette command in the book, which the shelf also offers for the book opened last, and which a desktop menu item runs (the shell's `command`, a palette command by its id, run where it's offered). |
| `commands` | web | Palette commands while a book of a kind that uses the module is open. |
| `storyMapTabs` | web | Tabs of the story map, in the order the kind lists its modules, each at `/story-map/<key>` and under "Go to" (the swimlanes, presence, the timeline). Every tab is a module's: a kind without any has no story map. |
| `facts` | core | What the module says about a piece among its facts, after where it stands in the book ("A flashback: 3 days before …"). |
| `clock` | core | A `StoryClock`: the story time some pieces span. A place's profile shows it only through `storyClock(book)`. |
| `records` | core | Kinds of record the module keeps (`RecordTypeDef`): a Markdown file each in a folder of the codex (`bible/events/`), front matter then prose, with an ID prefix, its words (a noun, its group among the codex's entries, what's said after one's title among pieces), its fields (declared as a piece's, from the kind), keys that name a piece, whether prose may mention one, its schema, and optionally a list of them in one YAML file (format v1's `events.yaml`). The base loads them into `book.moduleRecords`, checks their IDs, fields, links and mentions, reserves their prefix and folder, lists them among what refers to an entry (`backlinks`, `mentionsOf`) and compares them. Story time places those with a story-time field among the pieces. |
| `layouts` | core | Compile layouts (`CompileLayout`): how a compiled book's pages read in the Word file and the PDF, and its EPUB's headings: a chapter's and a part's heading, the title page, the running header, the line spacing, the end mark, and what the compile dialog says of each format. A kind names one (`compileLayout: "manuscript"`); without one its modules bring, it compiles in the base's plain layout (`PLAIN_LAYOUT`, in the kind's words). The writers in `packages/export` read only the compiled book. |
| `conversions` | core | What a book of the kind can be made instead (`Conversion`: a novel kept as a journal, a Journal): the writes that do it on the book as format 3 has it, or why it can't. The base runs one in one commit (`convertBook`: the format move first where needed, the module's writes, the diagrams redrawn, the new kind's tools and workflows in place of the old's, the old folders' .gitkeep files gone), from the palette ("Make this book a journal…", asked first) or `writer convert [dir] --to <kind>`. The book's workspace opens afresh as its new kind. |
| `migrations` | core | The module's step of moving a novel to a newer format: the files it writes for format 2, or why the book can't move. The base's `migration` runs each, then moves the manifest. |
| `records` | web | How the app shows the module's records (`WebRecordType`): a page at `/<key>/<id>`, over the codex's gallery and in the Entry tab; a section of the gallery after the entries; what a mention card shows; making one from its title, at `/<key>/new`, and from a note. `useNewRecord` asks for a new one from anywhere (the Timeline does). |
| `routes` | server (`ServerModule`) | Routes under a book at `/api/novels/:id/<module>/…`, answered only for a book whose kind lists the module (404 otherwise). The client reaches them with `api.module(id, module, method, path, body, { passing })`, which answers a refusal of the code `passing` instead of throwing it. A route makes its change with `ws.bible.change(fn, { format, migrate })`: one commit, on the book as `format` has it (a novel in an older format is moved first, in the same commit, when the writer agrees). The CLI's and the dev server's entry points register them. |
| `service` | server | What the module keeps for an open book whose kind lists it (the drafting board's store), made with the book's workspace: its routes reach it with `ws.module(id)`. It's told after each sync with GitHub that brought something (`synced`), and its `onChange` news reaches the book's open pages as a `module` event naming it, which refreshes the queries under `keys.module(bookId, id)`. |
| `outlineViews` | web | Views of the outline beside its table and cards, at `/outline/<key>`, in reading order only (the drafting board). |
| `profileSections` | web | Sections of the profile of an entry of a type (a plotline's beats). |
| `outlineOrders` | web | Orders the outline's table and cards can show beside reading order, at `?order=<key>` (story time). The order switch shows only when a module adds one. |
| `dayToDate` | web | What a module offers under a story-time editor once a day of the story has become a date (dating Day 1 from it). |

A module's web half imports the web app's own parts through `@writer/web/<path>` (the web package exports its `src`), and its server half the server's through `@writer/server`; the web app's tsconfig checks module web halves, the root's their core and server halves. The web app registers the modules' core halves too, for what the base reads through them in the browser (a piece's facts, the story clock, the records' types). A module may use another's public exports when it `needs` it (off-page events read story time's timeline), never its internals.

Features never ask for a module's field by name. A field says what it is to the rest of the app instead. `carries` marks the entry that carries a piece (the point of view): presence rings it, the timeline can run a lane for each, profiles count it, the drafting board mirrors it, all through `carrierOf(kind, piece)`. `role` says how an entry in it is in the piece ("set here"). `lanes` lets the timeline run a lane for each of its entries, named by its entry type ("Location"). `threads` makes its entries threads through the book: the graph can show only what's in one's scenes, and a piece's facts say where one begins or ends. `marks` says how an entry reads on its presence strip ("a major beat"). `snapshot` puts its entries' presence among the book's diagrams (the characters', the themes'). An entry type says what its entries are where a feature needs to know (`is: "person"` or `"place"`): story time's overlap warning reads people and places from it, not from the keys `character` and `location`. Presence reads what an item carries from the field's declared item properties: a choice (the first value the strongest), a scale, a text. `entriesOf(book, piece, type?)` gives every entry a piece's fields name. A kind without the module has none of it: no carrier, so no rings, no such lanes and no board field.

The modules so far:

| Module | Package | Adds |
|---|---|---|
| point-of-view (#27) | `@writer/module-point-of-view` | The `pov` field, which carries its piece, and the `W_POV_NOT_PRESENT` check. |
| plotlines (#28) | `@writer/module-plotlines` | The plotline type and the `plotlines` field (weight, beat; lanes and a thread), the swimlanes as the story map's first tab with their gaps and the `plotline_gap` setting, the beats on a plotline's profile, and `diagrams/plotlines.svg`. |
| presence (#29) | `@writer/module-presence` | The matrix of entries against pieces as a story-map tab, for each entry type the kind's fields list (and the book's own types, where a field takes them), editing what an item carries from its field's item properties; and `diagrams/presence-<folder>.svg` for the types of fields marked `snapshot`. How an entry is in a piece (`presence` in core diagrams) stays in the base: an entry's strip reads it too. |
| story-time (#30) | `@writer/module-story-time` | The `when` field (with its duration), Day 1's date (`calendar.start`, set through its `PUT …/story-time/calendar` route), the timeline as a story-map tab and `diagrams/timeline.svg`, the outline in story time, a piece's facts in story time, the `W_TIME_OVERLAP` check, and the story clock. The `story-time` field kind (its value, schema, card editor and comparison) stays the base's. Other modules' records with a time (off-page events) are placed among the pieces, in their own words. |
| drafting-board (#31) | `@writer/module-drafting-board` | The outline's Board view, its palette command, and its mirror on a GitHub Project: the store (the module's service, with a GitHub connection) and its routes (`…/drafting-board`, `…/sync`, `…/conflicts/:scene`). Its columns and the project's Status options are the kind's statuses, and its POV field is there only for a kind whose pieces have a carrier. The names on GitHub (the `gh-writer-board` marker, POV, Part, Chapter, "Scene status", "Scene ID") stay gh-writer's, so its boards are still found. Its core half only names it: nothing of it is in the book's files. |
| manuscript-format (#32) | `@writer/module-manuscript-format` | Standard manuscript format as a compile layout, the Novel's: "Chapter Four: The Flood" and "Part One", the title page's contact details and rounded word count, Surname / SHORT TITLE / page, double spacing, THE END, and the dialog's "for agents and editors". The Novel compiles the same bytes as before. |
| daily (#38) | `@writer/module-daily` | Needs story-time. Today's entry: the piece dated the writer's today (its `when`), or a new one at the end of its month, in its year where the book keeps years, made with them in one commit (`POST …/daily/today`, through ManuscriptOperations.placePiece) and opened, at /today; from the palette (daily.today), the book's tile on the shelf, and the desktop menu's Today's Entry. The calendar of a month's entries, under Plan. The Journal's. |
| to-journal (#39) | `@writer/module-to-journal` | The Novel's conversion to a Journal, for a journal kept as a novel (a chapter a month, a scene a day): manuscript/ to entries/, bible/ to index/ (characters, locations and themes to people, places and values), chapters to months and parts to years, scenes' lists to an entry's fields, statuses to draft and kept, each undated entry dated from its title ("Tuesday, 10/20/2026"); every ID, mention, relationship and note kept. It refuses a point of view, plotlines, off-page events and untitled chapters, and drops a kind of relationship for plotlines that nothing uses. |
| off-page-events (#33) | `@writer/module-off-page-events` | Needs story-time. The event record type (`bible/events/<slug>.md`, `evt_`, its schema, and format v1's `bible/events.yaml`), its page, its section of the codex and its mention card, writing one as a piece, a note made into one, the palette's New off-page event and Off the page commands, its routes (`…/off-page-events/events`, `…/notes/:note`), the "Dramatizes" fact, the `W_EVENTS_YAML` check, and format 2's move of `events.yaml` to files. An event's lists are the kind's piece fields of the same keys (`characters`, `locations`, `plotlines`), as the format says. The Novel lists it before story time, so the event a scene dramatizes is said first among its facts. |

### Kinds for tests

Tests use kinds the app doesn't ship, in `packages/core/test/kinds.ts`, to show the base reads a kind rather than a novel: the diary (one level), the saga (three, all a novel's words), and the field guide (#35). The field guide is the proof of the base: regions, habitats and families of species, an atlas of observers and sites, its own statuses, issue kinds and one field (`seen_at`), and no modules. `examples/sample-field-guide` is a book of it, which loads, validates and compiles (`packages/core/test/field-guide.test.ts`), runs through the CLI (`packages/cli/test/main.test.ts`) and opens in the app (`packages/web/e2e/field-guide.spec.ts`): the shelf, writing view, tree, atlas, notes, sync and compile, with no novel's words on screen. A test that runs `writer` on a book of a test kind runs `packages/cli/test/with-test-kinds.ts`, the CLI with the test kinds registered too; an e2e spec does so with `test.use({ entry: withTestKinds })`.

## Checks

| Command | Runs |
|---|---|
| `npm run typecheck` | TypeScript on every package |
| `npm test` | Vitest unit and integration tests (`packages/*/test`) |
| `npm run test:e2e` | Playwright: the editor playground, then the built web app against real servers |
| `npm run check` | typecheck and unit tests |

Run `npx playwright install chromium` in `packages/editor` once before the first e2e run. The e2e tests also run in WebKit, the engine of the desktop app's window on macOS and Linux. CI runs both (`E2E_BROWSERS=chromium,webkit` is the default there); elsewhere only Chromium runs unless you set `E2E_BROWSERS`. Playwright's WebKit needs Ubuntu's libraries: on Ubuntu, `npx playwright install --with-deps webkit`; elsewhere, its Docker image (`mcr.microsoft.com/playwright`). On other Linux distributions (Arch, say), Playwright's WebKit is missing only Ubuntu 24.04's `libicu74` and `libflite1`. Fetch those packages from archive.ubuntu.com and check them against the archive's `Packages` index. Copy their libraries into `~/.cache/ms-playwright/webkit-*/minibrowser-{wpe,gtk}/sys/lib`, since Playwright's launcher ignores `LD_LIBRARY_PATH`. Then run with `PLAYWRIGHT_SKIP_VALIDATE_HOST_DEPENDENCIES=1 E2E_BROWSERS=chromium,webkit`. The web e2e tests run against the **built** app, so `npm run test:e2e` builds it first; if you run Playwright directly, run `npx vite build` in `packages/web` after changing the UI.

Each web e2e test starts its own `writer serve` on a temp copy of the sample novel (`packages/web/e2e/fixtures.ts`), with a fake GitHub (`packages/server/test/fake-github.ts`) that serves the REST API, the device flow and git over HTTP. Most views also run an [axe](https://github.com/dequelabs/axe-core) audit, many in both light and dark themes; new UI should too. Performance benchmarks (`*.performance.spec.ts`) run after the rest, one at a time.

CI (`.github/workflows/ci.yml`) runs typecheck, unit tests, validation of the sample novel, epubcheck on the sample's EPUB, every e2e test, the git port's contract suite against libgit2, and the Android app's ports (`cargo test` in `packages/mobile/ports`).

### The engine and its hosts

The server's logic is an engine (D16): `@writer/server/engine` (`packages/server/src/engine-index.ts`, and `createEngine` in `engine.ts`), the API over the writer's library and books, with nothing of Node in it. A host gives it ports first (`setPorts`: git, files, and the host's facts: its environment, its folders, how paths are written there), then a library, its workspaces and a GitHub connection. On Node, `useNodePorts()` gives git itself, the disk and `node-host.ts` (the platform's folders, the OS keychain, the gh CLI), and `app.ts` wraps the engine with the session check, the app's own routes, compiling and the built web app. In a browser or on Android, the client calls the engine's `fetch` in process. `test/engine.test.ts` bundles the engine for a browser with esbuild (any `node:` import fails it, and Node's globals are looked for), and runs it on in-memory ports. Modules' server halves import from `@writer/server/engine`, never `@writer/server`.

Compiling stays on Node for now: `@writer/export` reads its fonts from disk and uses `node:zlib`.

The engine can run in the page, as on Android: `writer serve --engine-in-page` serves the app and a bridge to its ports (`node-bridge.ts`, at /bridge) in place of the API. The page starts the engine with remote ports over the bridge (`remote-ports.ts`: a call names the port and the operation; bytes travel as base64), registers a service worker (`packages/web/public/engine-sw.js`) that hands every request to `/api/` to it, pictures and event streams included, and renders once the worker controls the page. The page's Content Security Policy forbids compiling the schemas there, so the shipped kinds' validators are compiled ahead of time (`scripts/compile-schemas.ts`, into `packages/kinds/generated` by `npm run build:template`; a test fails when they're stale). The writing view's e2e specs run this way too (the `engine-in-page-*` projects).

### The git port

The server reaches git only through its git port (D16; `packages/server/src/git-port/port.ts`), so that its logic can run where there's no git binary. Each entry point gives the server its ports (`useNodePorts()` on Node: the CLI, the web dev server and the tests); code asks for `gitPort()`. On Node the port runs git itself (`git-port/node.ts`, the only code that does; `test/git-boundary.test.ts` checks). On Android it's libgit2 (`packages/git2-port`), reached through `git2GitPort` (`git-port/git2.ts`), which maps the port's calls onto git2-port's operations whichever way they travel: the stdio binary in the tests, Tauri's invoke in the app. Paths are relative to the book's folder, which may sit inside a larger repository.

The server reaches the disk through its files port in the same way (`files-port/port.ts`, `filesPort()`; `bookSource(root)` gives core's loader a book's files). Its adapters are node:fs with chokidar (`files-port/node.ts`) and memory (`files-port/memory.ts`, for tests), held to `test/files-port.test.ts`. The port is primitives: an atomic write (temp file, flushed, renamed, folder flushed), reads, listings, stat, watch. The rules stay in the server (`files.ts`): which paths a book may have, no symlinks leading out of it, writes refused when the file changed underneath.

`packages/server/test/git-port.test.ts` is the port's contract: what any adapter must do, including a sync with a conflict through the fake GitHub. It runs git's adapter always, and libgit2's too where it's built, then both on the same repositories, expecting the same answers down to object IDs. To include libgit2: `cargo build --release` in `packages/git2-port` (Rust 1.85 or later, a C compiler and CMake; libgit2 is built from source), then run the suite. A new git operation goes in the port, both adapters and the suite together.

## The templates and their tools

Each kind of book has a template, `templates/<kind>/`: what a new book of it starts as, from the shelf's New (which asks for the kind and lists those the server has templates for) or the CLI. A new book gets fresh IDs for the template's placeholders (`<prefix>_temp…`, of any prefix), its title and author, its diagrams drawn, and a first commit. The server bundle carries `templates/` beside it (`WRITER_TEMPLATES`).

Books can't install Writer, so each template carries its tools as single-file esbuild bundles in `.github/gh-writer/`: `validate.mjs`, `snapshots.mjs`, and `compile.mjs` with its fonts. They know every kind the app ships, so every template has the same bytes: they're built into `templates/novel/` and copied into the others (`scripts/vendor-tools.ts`). **After changing `core`, `export`, a kind, a module's core half or the CLI entry points, run `npm run build:template`**, which rebuilds them and redraws the templates' and the samples' diagram snapshots. A test fails if the vendored bundles don't match the source.

The compiled files must be the same bytes in the app, on the command line and in a novel's GitHub Action. A test compiles a committed copy of the sample both ways, in different time zones, and compares them. Keep anything time-, zone- or platform-dependent out of the output: dates come from the commit, IDs from the novel, zip timestamps are written in UTC, and PDFs are compressed with fflate rather than Node's zlib.

`npm run screenshots -w @writer/web` retakes the README's screenshots (`docs/screenshots/`) from the sample novel.

## The server bundle

The desktop app runs the server on Node's official binary, as one script ([D9](https://github.com/heffrey78/gh-writer/issues/170)). `npm run build:server` builds the web app, then bundles the `writer` command into `dist/server/writer.mjs` with what it reads at run time beside it: the keychain's native module (`node_modules/@napi-rs/keyring*`, for this platform), the web app (`web/`), the novel template (`template/`) and the compiler's type (`fonts/`). The bundle's entry point (`packages/cli/src/bundle.ts`) points `WRITER_WEB`, `WRITER_TEMPLATE` and `WRITER_FONTS` at those folders, unless they're already set; from the source tree, each falls back to its place in the checkout. A test builds the bundle and checks it serves, and compiles the same bytes as the source.

`npm run fetch:runtime [target]` fetches what the bundle runs on for one platform (`linux-x64`, `darwin-arm64`, `darwin-x64` or `win32-x64`; by default this machine's) into `dist/runtime/<target>/`. That's Node's official binary and GitHub's portable git (dugite-native), each checked against a checksum pinned in `scripts/fetch-runtime.ts`, plus their licences and where git's source is. Git Credential Manager, Git LFS, Perl, gitweb and translations are left out, which takes git from about 150 MB to about 40 MB. It has no symbolic links, since app bundlers copy what a link points to. git runs its built-ins itself, so their dashed links are dropped, as Git for Windows does. The transport commands git runs by name (`git-upload-pack` and friends) and `git-remote-https` become copies. The app answers git's credential prompts itself, and reads git's messages in English. This portable git doesn't find its own parts unaided: it needs `GIT_EXEC_PATH` (`libexec/git-core`) and `GIT_TEMPLATE_DIR` (`share/git-core/templates`), and on Linux `GIT_SSL_CAINFO` (`ssl/cacert.pem`). On Linux, its https helper uses the system's `libcurl.so.4`. To bump Node or git, change the version and its checksums at the top of the script. For this machine's own target, the script checks that node and git run with nothing else on PATH.

## The desktop app

`packages/desktop` is a Tauri 2 app ([D2](https://github.com/heffrey78/gh-writer/issues/22), [D9](https://github.com/heffrey78/gh-writer/issues/170)) around the same server and web app. Building it needs Rust, and on Linux WebKitGTK 4.1 (see [Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/)). `npm run desktop` builds the server bundle, fetches this machine's runtime, then runs the app in development. The bundle and runtime are its resources (`server/` and `runtime/`, from `tauri.conf.json` and `tauri.linux.conf.json`).

The shell (`src-tauri/src`) does the following:
- **Starting.** It starts the server: `runtime/node/node server/writer.mjs serve --sidecar`, with `WRITER_GIT` set to `runtime/git` and `WRITER_ASKPASS` set to its own executable. Neither is set when the writer has chosen *Use This Computer's git* (`settings.json` in the app's config folder).
- **Windows.** The library has a window of its own (`main`), and each novel gets one (`novel-<library id>`). Every window starts on the loading page and, once the server is up, is sent to its page there. Windows stay on the server's pages, and other links, `target=_blank` included, open in the writer's browser. Each window's title follows its page. Sizes and positions are remembered.
- **Signing in.** The shell sets the server's session cookie itself, as `SameSite=Lax`, rather than using the `?token=` redirect. WebKitGTK counts the navigation from the loading page as cross-site, so it would withhold the server's `Strict` cookie.
- **Commands for pages.** The server's pages may call ten commands, and only these (`capabilities/default.json`): `flushed`, `page_ready`, `pick_folder`, `open_novel`, `show_library`, `set_recent`, `edit` (the webview's own Cut, Copy, Paste and Select all, on Linux; false elsewhere), `clipboard_text`, `can_inspect` and `inspect` (the inspector, in a debug build). The page's side is `packages/web/src/desktop.ts`. The shell runs commands in a page through `window.writer.run` (`go` to a path, `about`), keeping them until the page says it's ready.
- **Right-click.** The page draws its own menu (`packages/web/src/context-menu.tsx`, [#243](https://github.com/heffrey78/gh-writer/issues/243)) and the webview's never shows. What was clicked can add items to it through `contributeMenuItems` (`@writer/editor`): the spelling suggestions, Raise an issue…. A page can't read the clipboard, so Paste asks the shell: on Linux `edit` runs WebKitGTK's own Paste, which keeps formatting; elsewhere the page pastes `clipboard_text` itself.
- **Menu.** File has New Book…, Open Folder… and Clone from GitHub… (the library's own dialogs, in its window), Open Recent, Your Books, Use This Computer's git (which restarts the server; every window comes back where it was), Close Window and Quit. Edit and Help (About Writer) complete it.
- **One copy.** A second launch hands its arguments to the running one and exits. A folder passed on the command line, or dropped on the library window, opens through `/?add=open&path=…`: added and opened, or the dialog says why not. Only the library window takes drops; a novel's window leaves them to its page (pictures on portraits).
- **Closing and quitting.** Closing a window, quitting, or SIGTERM, SIGINT or SIGHUP (logging out) has each page save what's typed: the shell calls `window.writer.flushAll()`, and the page answers with `flushed`. Then the shell closes the server's stdin and waits for it to commit and exit, killing it after 15 seconds.
- **Askpass.** The executable doubles as git's askpass program (`src/askpass.rs`). Started with one of git's username or password prompts as its only argument, it prints `x-access-token` or the token from `WRITER_GIT_TOKEN` and exits before opening any window.
- **Crashes.** If the app itself dies, the closed pipe stops the server. If the server stops on its own, the app offers to restart it.

`e2e/desktop.spec.ts` in the web app checks the page's side, with a stand-in for the shell.

Installers for Linux:

| Command | Makes | Size |
|---|---|---|
| `npm run desktop:arch` | an Arch package (`packages/desktop/arch/writer-*.pkg.tar.zst`; install with `sudo pacman -U`), repackaged from the .deb by `arch/PKGBUILD` | about 58 MB |
| `npm run build:server && npm run fetch:runtime`, then `npx tauri build` in `packages/desktop` | the .deb (`src-tauri/target/release/bundle/deb/`) | about 82 MB |

Both use the system's WebKitGTK. There's no AppImage: it has to carry WebKitGTK itself, which comes to 165 MB. `arch/build.sh` fails if the package is over the 100 MB budget.

Updates: on Linux the app can't replace itself (Tauri updates only AppImages there). The server checks GitHub's latest release once a day (`GET /api/app`), and the top bar says when a newer one is out. About Writer shows its notes and links to its download. The updater signing key is for the macOS and Windows updaters to come. Writer doesn't have its own key yet: `src-tauri/updater.key.pub` is still gh-writer's, and nothing reads it. Before the first signed release, make one with `npx tauri signer generate -w ~/.tauri/writer.key` and keep its password in the keychain (`secret-tool store --label 'Writer updater key' service writer-updater key ~/.tauri/writer.key`). Replace `src-tauri/updater.key.pub` with the new public key, and put the private key and its password in Actions secrets (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).

About Writer also shows the versions of the app, Node and git. In the desktop app it shows the licences of what it ships, from the `licenses/` resource folder (Writer's, Node's, git's, and where git's source is).

Cutting a release:

1. Set the version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `arch/PKGBUILD` (setting `pkgrel=1` again).
2. Commit, then tag `v1.2.3` (or `v1.2.3-rc.1` for a pre-release) and push the tag.
3. The Desktop workflow (`.github/workflows/desktop.yml`) checks that the tag names that version. It builds the .deb on Ubuntu 22.04 and makes the Arch package from it.
4. It installs each on a clean container with no git and runs `scripts/smoke-desktop.ts` on the packaged Node, against a fake GitHub. The smoke test signs in, clones, takes the account's name and email, writes, syncs (pushing through the app's askpass) and quits, then starts the app under Xvfb and quits it with SIGTERM.
5. It drafts a GitHub Release with both packages and git's source (git and dugite-native, at the pinned versions; GPL-2.0).
6. Publish the draft when it's right. The app offers the latest published release, never a draft or a pre-release.

The workflow also runs on pull requests that touch the desktop app or its scripts, without the release, and by hand (*Run workflow*). To run the smoke test on this machine against an installed package: `node scripts/build-smoke.ts`, then `/usr/lib/writer/runtime/node/node dist/smoke/smoke-desktop.mjs --sample dist/smoke/sample-novel`. Set `WRITER_SMOKE_ALLOW_GIT=1` if this machine has git.

The server's messages go to `server.log` in the app's log folder (`~/.local/share/io.github.heffrey78.writer/logs` on Linux). The previous run's are in `server.previous.log`. `cargo test` in `src-tauri` runs the shell's unit tests.

## The Android app

`packages/mobile` is Writer on Android (D16): a Tauri 2 app whose webview runs the web app and the engine together. Nothing runs a server. The page knows it's in the app because it's served from `tauri.localhost`, and starts the engine with `tauriHost()` (`packages/web/src/engine/in-page.ts`) before it renders, as in *The engine and its hosts*. The app's Rust is the engine's host, through three commands:

- `git`: one git port operation, run in process by `packages/git2-port`; a clone's or a fetch's progress comes back on a channel.
- `port`: an operation of the files, host, http or secrets port, by name, as `remote-ports.ts` calls it.
- `listen`: the channel every watch's events come back on.

The ports are in `packages/mobile/ports`, apart from Tauri so `cargo test` runs them anywhere (CI does):

- **Files** (`files.rs`): everything lives in the app's own folder (`/data/user/0/io.github.heffrey78.writer`): `books/`, `config/`, `templates/`, the git configuration and the sealed token. Writes are atomic, as on the desktop. Watching uses inotify (notify), leaves out `.git/` and the temp files, and tells a new file (`add`) from a changed one (`change`), as chokidar does.
- **Secrets** (`secrets.rs`): the GitHub token is sealed with AES-GCM by a key that never leaves Android's keystore, and only the sealed bytes are kept, in `secrets/github`. A token the key can't open (after a reinstall) is forgotten, and the writer signs in again.
- **Host** (`host.rs`): the folders, and the templates, which are built into the app and written to `templates/` when the app's differ from what's there. `env.json` in the app's folder, if present, is the engine's environment: the e2e run uses it to point the app at a fake GitHub.

The rest is in `src-tauri`:

- **HTTP.** Requests to GitHub go out from Rust (reqwest with rustls and Mozilla's roots), since github.com's device flow sends no CORS headers for a page.
- **libgit2.** It trusts the device's certificates, added in memory from Conscrypt's and the system's folders (`git2_port::trust_certificates_in`). Its global configuration, the writer's name and email, is `.gitconfig` in the app's folder.

`packages/mobile/android-plugin` is a Tauri plugin with Kotlin in it (`android/`). It does four things. It keeps the page clear of the status and navigation bars and the keyboard, since the app draws edge to edge. It opens other sites in the phone's browser (its `on_navigation` hook and `view` command): in the webview, GitHub's sign-in page would take the app's place, and the engine's waiting sign-in with it. Its `seal` and `open` commands are the keystore cipher. It also gives the engine's service worker the webview's own request handler. Without that, Android's webview fetches the worker's script, and whatever the worker lets through, from the network, and the page would never be served.

In the page, `onAndroid` (`packages/web/src/platform.ts`) is true in the app. With no folders of the writer's to open on a phone, it leaves out Open a folder. Where the engine runs in the page, unsaved text is also kept on the host: `unsaved.json` in the config folder, written through the files port at each change, and read as the engine starts (`packages/web/src/engine/kept.ts`). Android can kill the app at any moment, and the browser's own storage is written to disk some seconds late. The tab's session keeps a copy as well, for when the host is the one that stops. An app killed in the foreground can lose the last 300 ms of typing, the editor's pause. A backgrounded app loses nothing: its page was hidden first, which hands the editor's text on at once.

The rest of the app is the same at phone width: the sidebar opens over the text, the palette is in the ⋯ menu as Commands…, and so are the right sidebar's tabs where there's no room for its strip (`page-menu.ts`) (`e2e/phone.spec.ts`, by touch at 412 px).

Building uses Unity's Android SDK, NDK and JDK, and Rust from its own rustup folder, as `env.sh` says. Nothing is installed system-wide. `packages/mobile/build.sh [aarch64|x86_64]` builds the web app and then a debug-signed APK: `aarch64` for a phone, `x86_64` for the emulator. The generated Gradle project (`src-tauri/gen/android`) isn't committed; the script makes it and points it at platform 36 and target 34.

`node packages/mobile/e2e.ts [APK]` runs the app end to end on a device or the emulator. It installs the APK and clears the app's data, then drives the webview with Playwright's Android support, against a fake GitHub on this computer reached through `adb reverse`. It signs in with a code, starts a journal and writes in it, puts it on GitHub, clones a novel and syncs a change made elsewhere. It then checks the files on the device and on GitHub. Set `ADB` if adb isn't on PATH. An emulator that works here: the `emulator` package and `system-images;android-36;google_apis;x86_64` from `sdkmanager`, installed into a folder of their own with `--sdk_root`, run headless with `-no-window -gpu swangle_indirect -feature -Vulkan` (the other GPU modes crash this emulator, 37.2, when the webview draws).

## Conventions

- **Writers, not developers, use the app.** No git terms in the UI: "checkpoint", not "tag"; "sync", not "push". Messages say what happened and what to do next.
- **Never lose words.** Writes are atomic, refused when the file changed underneath (with a conflict to resolve), and unsaved text survives a crash. Edits to YAML keep the author's comments and layout. Untouched Markdown is saved byte for byte.
- **Keyboard and screen readers first.** Everything works without a mouse and is in the command palette; dialogs trap and restore focus; live regions announce what changed.
- **Code style.** Match the surrounding code: its comment density, naming and idiom. Comments explain why. Prefer plain, specific names.
- **Tests with the change.** A bug fix comes with the test that would have caught it.

## Names kept from gh-writer

Writer reads and writes gh-writer's novels, issues and boards, so a few names stay gh-writer's ([#14](https://github.com/heffrey78/writer/issues/14)):

- `.github/gh-writer/`: a novel's vendored tools (`TOOLS_DIR`), and the novel template's.
- `<!-- gh-writer {…} -->`: the hidden footer of an issue raised from a passage, which anchors it there (gh-writer D1).
- `<!-- gh-writer-board: … -->` and `<!-- gh-writer-create: … -->`: the markers that find a novel's drafting board on GitHub and match issues made offline.
- `.git/gh-writer/`: the caches each clone keeps (issues, board, stats, discarded versions). They're the clone's state, so the two apps share them.
- `urn:gh-writer:<id>`: an EPUB's identifier. A reader would take a recompiled book with a new one for a different book.
- The JSON Schemas' `$id` URLs, and links to gh-writer's issues (`heffrey78/gh-writer#N`).

Everything else is Writer's own: its packages (`@writer/*`), the `writer` command, `WRITER_*` variables, and the desktop app's identifier (`io.github.heffrey78.writer`), folders and keychain entry. So Writer and gh-writer can be installed side by side without sharing a library or a sign-in. Writer has its own GitHub OAuth App too (`GITHUB_CLIENT_ID` in `packages/server/src/github.ts`, with Device Flow enabled and tokens that don't expire, since the app keeps one token and never refreshes it), so a sign-in made in gh-writer isn't Writer's.

## Project tracking

Work is tracked as GitHub issues in this repository, through the gh-project MCP server: requirements, decisions and tasks, grouped into milestones. A requirement goes Draft → Approved → Implemented → Validated; approving and validating are the owner's decisions. Tasks link to their requirement, and a task is done when it's committed, pushed and CI is green. Commit messages say what changed and why, and refer to their task (`Refs #14`).

Writer's decisions are numbered from D13 ([D13](https://github.com/heffrey78/writer/issues/9)); D1 to D12 are gh-writer's and still hold unless one of Writer's supersedes them. gh-writer's issues are the record of how the app got here. In this repository, `#N` is Writer's issue, so a reference to one of gh-writer's is written `heffrey78/gh-writer#N`.

## License

[MIT](LICENSE.md). The Liberation Serif fonts are under the SIL Open Font License 1.1.
