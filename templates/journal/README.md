# Untitled Journal

This journal uses the [Writer](https://github.com/heffrey78/writer) format: plain Markdown and YAML files that you can edit in the Writer app, on github.com, or in any text editor.

## Where things go

| Path | What it holds |
|---|---|
| `book.yaml` | Title, author, and the kinds of relationships between the people and places in it. |
| `dictionary.txt` | Words the spell checker should accept. Names in the index are known already. |
| `entries/` | The journal. Each year is a folder with a `_year.yaml`, each month a folder inside it with a `_month.yaml`; each entry is a `.md` file inside its month, dated in its `when`. |
| `entries/_order.yaml`, `_year.yaml`, `_month.yaml` | **Order.** The months of a year and the entries of a month, by ID. The `01-` numbers in file names are just for tidy browsing. |
| `index/people/`, `places/`, `events/`, `values/` | One file per person, place, event or value. |
| `index/relationships.yaml` | Who is related to whom. |
| `notes/` | Notes to yourself: ideas, things to follow up. |
| `diagrams/README.md`, `diagrams/*.svg` | **Generated** snapshots: who is in which entry, and the entries in time. |

## Writing by hand

- Start every entry and index file with a `---` front matter block.
- Keep each paragraph on **one line**, with a blank line between paragraphs. This keeps change history readable.
- Every record has an ID such as `per_7f3k2q`. Never change an ID; rename files and titles freely.
- Mention a person in an entry as `[Ada](#per_7f3k2q)`.

## Checking your work

Every push runs the validator in GitHub Actions (`.github/workflows/validate.yml`). To run it yourself, with Node 22.18 or later: `node .github/gh-writer/validate.mjs`.
