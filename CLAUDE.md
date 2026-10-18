# Writer

Writer is a local-first writing app for desktop (Tauri) and later Android. It grows out of [gh-writer](https://github.com/heffrey78/gh-writer), a novel-writing app, into a general base where each kind of book gets its own words, structure and features. The kinds are Novel and Journal first, then Campaign (tabletop RPG) and Non-fiction. A book is a git repository of plain Markdown and YAML, synced through GitHub. Books sit on a shelf: a journal is one book, and so is a novel or a campaign.

**Writer should not try to be everything to everyone.** A feature belongs in the base only if every kind wants it. Anything else goes in a module that some kinds use.

## Status

The plan lives in this repository's issues (see *Project tracking*). Its order:

1. Import gh-writer as a snapshot, rename it to Writer, and get every check green (#1, D13 #9).
2. Keep gh-writer v2 novels opening unchanged (#2).
3. Generalize: kinds (#3, D15 #11) and modules (#4, D14 #10), starting from the inventory (#17).
4. The Journal kind, the first proof of the base (#5).
5. Roadmap: Campaign (#6), Non-fiction (#7), Android (#8, D16 #12).

D13–D15 are accepted (2026-10-18). D16 (Android) is **Proposed** until a spike confirms it: don't build on a proposed decision as if it were settled, and point it out when work depends on one.

## gh-writer is the reference

- Source: `../gh-writer` (sibling checkout), or https://github.com/heffrey78/gh-writer.
- Its issues are the complete record of why the app is as it is: requirements, decisions D1–D12 (#21–#24, #91, #122, #129, #143, #170, #177, #198, #206, #215 there; two are numbered D8, #143 and #177) and about 190 tasks with evidence. Read the decision before changing what it decided.
- gh-writer's D1–D12 hold for Writer unless one of Writer's decisions supersedes them (D13). Writer's decisions are numbered from D13.
- **Issue numbers collide.** In this repository `#5` is Writer's issue. Write gh-writer's as `heffrey78/gh-writer#5` or as full URLs, in issues, commits, docs and code comments alike.

## Principles (inherited, and binding)

- **Files are the truth.** Story facts live in the book's files, and work and discussion live in GitHub Issues (gh-writer D1). A book is readable and editable without the app.
- **One home per fact. References use immutable IDs. Order lives in order files** (gh-writer D3).
- **Never lose words.** Writes are atomic and refused when the file changed underneath, which raises a conflict to resolve. Unsaved text survives a crash. YAML edits keep the author's comments and layout. Untouched Markdown is saved byte for byte.
- **Writers, not developers.** No git terms in the UI ("checkpoint", not "tag"; "sync", not "push"). Messages say what happened and what to do next. Each kind uses its own words: never show "scene" to a journal keeper.
- **Keyboard and screen readers first.** Everything works without a mouse and is in the command palette. Dialogs trap and restore focus. Live regions announce changes.
- **Same bytes everywhere.** Compiled files and diagram snapshots are identical in the app, on the CLI and in a book's GitHub Action, in any time zone.
- **Keep the git and GitHub integration**: sync, versions as branches, checkpoints as tags, issues anchored to passages, the drafting board.

## Architecture

Inherited from gh-writer; [DEVELOPER.md](DEVELOPER.md) has the details, the desktop shell and the release steps:

```
web (React) ── client (API, autosave) ──HTTP──► server (Hono, 127.0.0.1, per-launch secret) ── core (format, model)
                                                  ├── git (system or bundled portable git, simple-git)
                                                  ├── GitHub (REST, device-flow sign-in)
                                                  └── export (DOCX, EPUB, PDF)
cli (serve, validate, snapshots, compile, migrate)    desktop (Tauri 2 shell running the server bundle on bundled Node + git)
```

- `core` runs in the browser and in Node, so keep `node:` imports out of it. Its Node-only parts are behind `@…/core/node`.
- Books vendor their tools (validate, snapshots, compile) as esbuild bundles under `.github/<app>/`. After changing core, export or the CLI entry points, rebuild the template (`npm run build:template`). A test fails if the bundles are stale.

Extensibility (D14, proposed): three layers, all shipped in the app.

- **Base:** shelf, outline, writing view, index, notes, events, sync, issues and compile.
- **Kinds:** data-first definitions of structure, vocabulary, types, statuses and templates.
- **Modules:** first-party features contributed only through typed extension points.

The base never imports a module or a kind. There are no run-time third-party plugins.

New server code keeps `node:` APIs at its edges, so splitting it into an engine behind ports stays cheap (D16, proposed).

## Stack and commands

TypeScript throughout, on Node ≥ 22.18, which runs `.ts` directly (no build for the server or CLI). The code uses erasable syntax only: no enums, no namespaces, no parameter properties. Strict tsconfig with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`. npm workspaces under `packages/*`. React 19, TipTap/ProseMirror, React Flow, react-query, zustand, Radix, cmdk and Tailwind 4 on Vite. Hono on the server. Tauri 2 (Rust) for the desktop shell.

| Command | Runs |
|---|---|
| `npm run check` | typecheck and the unit tests: run before every commit |
| `npm test` | Vitest (`packages/*/test`) |
| `npm run test:e2e` | Playwright: the editor playground, then the **built** web app against real servers |
| `npm run dev` | the web app with hot reload and a real server. Set `WRITER_CONFIG_DIR` to a scratch folder so it doesn't use your own library |
| `npx writer serve examples/sample-novel` | the app on the sample novel, after `npm run build` |
| `npm run build:template` | rebuild the vendored tools and diagram snapshots |
| `npm run desktop` | the desktop app in development |
| `npm run desktop:arch` | the Arch package, `packages/desktop/arch/writer-*.pkg.tar.zst` |

Names that stay gh-writer's on purpose (the `.github/gh-writer/` tools folder, the issue anchor footer, the board markers, `.git/gh-writer/` caches, the EPUB `urn:gh-writer:`) are listed in DEVELOPER.md under *Names kept from gh-writer*. Don't rename them: gh-writer's novels depend on them.

## Testing

- **Tests come with the change.** A bug fix includes the test that would have caught it.
- Unit and integration tests use Vitest, in `packages/<pkg>/test/`. Property tests use fast-check where input space is wide (IDs, merges, round-trips).
- **Round-trips are byte-exact**: Markdown through the editor, and YAML edits with comments and layout kept.
- e2e uses Playwright against the built app. Each test starts its own server on a temp copy of the sample book, with a fake GitHub that serves REST, the device flow and git over HTTP. Run in Chromium and WebKit (`E2E_BROWSERS=chromium,webkit`), since WebKit is the desktop webview. On this machine (CachyOS/Arch), WebKit needs the libicu74/libflite1 workaround in gh-writer's DEVELOPER.md and `PLAYWRIGHT_SKIP_VALIDATE_HOST_DEPENDENCIES=1`.
- New UI gets an axe audit, in light and dark themes.
- Performance benchmarks (`*.performance.spec.ts`) guard the 10,000-word chapter and large books. Generalizing the loader must not regress them.
- During the extraction, **every step keeps every check green**. The Novel kind must pass gh-writer's whole suite.

## Project tracking (gh-project MCP)

Work is tracked as issues in heffrey78/writer through the `gh-project` MCP server. Start a session with `get_status`.

- **Requirements** go Draft → Under Review → Approved → Implemented → Validated. **Approving and validating are the owner's decisions: ask before moving a requirement to Approved or Validated.**
- **Decisions** (ADRs) are Proposed → Accepted/Rejected. A decided one isn't rewritten: amend it with a dated correction, or supersede it.
- **Tasks** are sub-issues of their requirement, with effort, acceptance criteria, an implementation plan and a test plan. A task is Complete when it's committed, pushed and CI is green. Record the commit and the evidence (test counts, e2e results in both browsers) when setting it Complete.
- Projects are milestones: *Extraction: the Base from gh-writer*, *Journal*, *Roadmap*.

## Conventions

- **Commits:** the subject is a plain sentence saying what changed, in the writer's terms where it's user-facing (gh-writer's log is the model: "Focus mode stays in the writing view: other pages keep their chrome"). The body says why. End with `Refs #N` for the task.
- **Code:** match the surrounding code: its comment density, naming and idiom. Comments explain why. Prefer plain, specific names. Use the neutral terms (book, section, page, index, entry) in base code once the glossary (#17) settles them.
- **Docs:** plain, concrete sentences, as in gh-writer's DEVELOPER.md and format spec. Say what something does and what to do; no marketing.
- `main` is the default branch.
