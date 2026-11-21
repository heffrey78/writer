# Spike: where “Not a name here” is kept (#155)

A writer with a character called Will says once that the *will* in “I will go” isn't him, and it
stops being offered for linking: in the editor's underlines, in an entry's Appears in (#135), in In
this scene's Not linked here (#156) and in Tidy up (#137). Tidy up's “They're different” (two
entries that look alike but aren't) is the same kind of judgement and wants the same home.

This finding weighs where such judgements are kept. It recommends a file of their own in the
index's folder, one judgement per line, merged by git's union driver, and proposes it as D19 (#159)
because it adds a file to the format. Nothing is built on it until D19 is accepted; until then Not
linked offers only Link it (#154).

## What has to hold

- **Files are the truth** (gh-writer D1): every device and the CLI agree, so not on the device.
- **Untouched Markdown is saved byte for byte**, and a book is readable without the app.
- **Merges across devices**: two phones each dismissing a name, then syncing, keep both.
- **gh-writer v2 novels open unchanged**, and older copies of Writer still read a book that has it.
- **One rule**: the editor's underline, `passagesOf` and `namesNotLinkedIn` agree on what's dismissed.
- **Survives editing**: a judgement follows its sentence as the piece is edited around it, and is
  dropped, not misapplied, when the sentence is rewritten.

## The options

### A. A marker in the prose, beside the word

`I <!--not:char_w1ll00-->will go.` An HTML comment the editor keeps as a raw inline node.

- Exact: it sits on the occurrence, so it moves with it through any edit and merges as the text does.
- But it writes into the author's prose for something that isn't prose, and anyone reading the
  Markdown (GitHub's page, another editor) sees the comment. Compile must strip it from DOCX, EPUB
  and PDF, the word count and spell check must step over it, and gh-writer opening the novel shows
  it as raw Markdown in the text.
- “They're different” has no place in the prose: it's about two entries.

### B. A list in the entry's front matter

`not_names: [{ piece: sc_4rr1v4, sentence: "I will go.", nth: 0 }]` in Will's file.

- Readable, and it goes with the entry (deleted with it, carried over by a merge of entries).
- But an entry's file is edited often (its notes, now quotes from the text, #157), so two devices
  dismissing names and editing notes meet in one file; and the YAML list conflicts when both append.
- “They're different” names two entries: it would have to live in both files, or arbitrarily in one.
- It adds a key to the entry schema, which every reader of entries then has to know.

### C. A file of the index's own, one judgement per line (recommended)

`bible/not-names.yaml` in a novel (`index/` in a journal: the kind's codex folder), and
`bible/different.yaml` for Tidy up's pairs:

```yaml
# Words that look like an entry's name but aren't it here (Not a name here). One per line; kept by Writer.
- { entry: char_w1ll00, piece: sc_4rr1v4, sentence: "I will go before the bridge does.", nth: 0 }
- { entry: loc_br1dg3, piece: sc_f100d0, sentence: "They had to bridge the gap somehow.", nth: 0 }
```

```yaml
# Entries that look alike but aren't the same (They're different). One pair per line; kept by Writer.
- [char_b3n0vs, char_b3nj4m]
```

- The prose and the entries are untouched; the file reads plainly without the app, like
  `dictionary.txt` beside it.
- **Merges**: a top-level list of one-line items is what git's built-in `merge=union` driver handles
  well. Two devices that each add a line both keep theirs, in either order, and the result is still
  a valid list. The template's `.gitattributes` gets `bible/not-names.yaml merge=union` (and the
  pairs' file); the app adds the lines to an existing book's `.gitattributes` the first time it
  writes either file. Removing a line (Undo, or “Link it after all”) merges like any edit. In the
  rare case that one device removes a line while another adds the same line, the line stays.
- **Older copies and gh-writer**: an unknown file in the index's folder is ignored by both, which
  just keep underlining. Nothing else in the book changes, so no format version bump is needed.
- **Finding the occurrence again**: by the piece's ID, the sentence (as core's passages give it,
  `Passage.block.sentence`), and which occurrence of the name in that sentence (`nth`). The sentence is
  found again in the piece's text with `resolveAnchor`, as an issue's passage is. A sentence that no
  longer reads close enough leaves the judgement dormant: the name is offered again, which is safe.
  Tidy up can list the dormant ones and offer to drop them.
- **One rule**: core reads the file into the loaded book (`book.notNames`), and `passagesOf`,
  `namesNotLinkedIn` and the editor's link suggestions (given the list with the entries, as they're
  given the names now) all skip a dismissed occurrence through one function in `passages.ts`.

### D. On the device only

localStorage, like the index's recent entries. Fails the first requirement: another device, the CLI
and a collaborator would all still offer the word.

## Recommendation

Option C. It keeps the prose and the entries as the writer wrote them, merges cleanly across
devices with a driver git already has, gives Tidy up's pairs the same home, and older readers ignore
it. Proposed as **D19** (#159); #135's Not a name here and #137's They're different build on it once it's
accepted.

Open for the decision:

- The files' names and place: in the codex folder (`bible/`, `index/`), as above, or the book's root
  beside `dictionary.txt`.
- Whether `validate` warns on a dormant judgement (a sentence no longer found), or only Tidy up says so.
