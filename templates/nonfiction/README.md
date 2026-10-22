# Untitled Book

This book uses the [Writer](https://github.com/heffrey78/writer) format: plain Markdown and YAML files that you can edit in the Writer app, on github.com, or in any text editor.

## Where things go

| Path | What it holds |
|---|---|
| `book.yaml` | Title, author, and the kinds of relationships between the index's entries (a concept builds on another, a person argues a claim…). |
| `dictionary.txt` | Words the spell checker should accept: the subject's terms. Names in the index are known already. |
| `text/` | The book. Each chapter is a folder with a `_chapter.yaml`; each section is a `.md` file inside it. Parts, if the book has them, are folders of chapters with a `_part.yaml`. |
| `text/_order.yaml`, `_chapter.yaml` | **Order.** The chapters (or parts), and each chapter's sections, by ID. The `01-` numbers in file names are just for tidy browsing. |
| `index/sources/`, `people/`, `concepts/`, `claims/` | One file per source, person, concept or claim. |
| `index/relationships.yaml` | How the index's entries are related: which concepts build on which, who argues what. |
| `notes/` | Research notes. |
| `diagrams/README.md`, `diagrams/*.svg` | **Generated** snapshots: which sources and concepts each chapter draws on, and how the ideas relate. |

## Writing by hand

- Start every section and index file with a `---` front matter block.
- Keep each paragraph on **one line**, with a blank line between paragraphs.
- Every record has an ID such as `con_7f3k2q`. Never change an ID; rename files and titles freely.
- Mention a concept in a section as `[path dependence](#con_7f3k2q)`.

## Checking your work

Every push runs the validator in GitHub Actions (`.github/workflows/validate.yml`). To run it yourself, with Node 22.18 or later: `node .github/gh-writer/validate.mjs`.
