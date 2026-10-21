import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { editYaml, kindOf, loadBook, MANIFEST, newId, NOVEL_MANIFEST } from "@writer/core";
import { snapshots } from "@writer/core/snapshots";
import { hasGitIdentity } from "./committer.ts";
import { filesUnder } from "./files.ts";
import { bookSource, filesPort, gitPort } from "./ports.ts";

/**
 * The templates in this checkout of Writer (or beside the server bundle: WRITER_TEMPLATES), a folder
 * each by the kind's key: templates/novel, the same files a "Use this template" repository gets, and
 * templates/journal.
 */
export const TEMPLATES = process.env.WRITER_TEMPLATES || fileURLToPath(new URL("../../../templates", import.meta.url));

/** A kind's template: templates/<kind>. */
export const templateOf = (kind: string, root = TEMPLATES) => join(root, kind);

/** The Novel's template, whose tools a novel moved to a newer format takes. */
export const DEFAULT_TEMPLATE = templateOf("novel");

/** A template's placeholder IDs (`nv_temp1a`, `ent_temp2b`), each replaced with a fresh one of its prefix in every new book, as the novel's init.mjs does on GitHub. */
const TEMPLATE_ID = /\b([a-z]{2,8})_temp[0-9a-z]{2}\b/g;
const STORY_FILE = /\.(md|ya?ml)$/;

export interface NewNovel {
  /** The kind of book, by its key: a novel by default. */
  kind?: string;
  title: string;
  author?: string;
  /** Who commits, set in the new repository only: for authors whose git doesn't know them yet. */
  identity?: { name: string; email: string };
}

export class NeedsIdentity extends Error {
  constructor() {
    super("git doesn't know your name and email yet, so the book's history can't be started. Give a name and email for this book's history.");
    this.name = "NeedsIdentity";
  }
}

/**
 * Fill the empty folder `dest` with a new book from `template` (its kind's): fresh IDs, the title and
 * author, diagrams drawn for it, and a git repository on main with the whole of it in a first commit.
 * Throws NeedsIdentity when git has no name and email and none were given; the caller cleans up.
 */
export async function writeNewBook(template: string, dest: string, { title, author, identity }: NewNovel): Promise<void> {
  const ids = new Map<string, string>();
  const fresh = (id: string, prefix: string) => {
    if (!ids.has(id)) ids.set(id, newId(prefix));
    return ids.get(id)!;
  };
  // Its story files: the manifest, and the kind's folders.
  const files = filesPort();
  const text = async (path: string) => {
    const bytes = await files.read(path);
    return bytes === undefined ? undefined : decoder.decode(bytes);
  };
  const kind = await kindOf({ read: (path) => text(files.join(template, path)) });
  const roots = [MANIFEST, NOVEL_MANIFEST, ...(kind ? [kind.folders.content, kind.folders.codex, kind.folders.notes].map((f) => `${f}/`) : []), "diagrams/"];

  for (const file of await filesUnder(template)) {
    const to = files.join(dest, file);
    await files.makeDir(files.dirname(to));
    if (!STORY_FILE.test(file) || !roots.some((r) => file === r || file.startsWith(r))) {
      await files.copy(files.join(template, file), to);
      continue;
    }
    let content = (await text(files.join(template, file)))!.replace(TEMPLATE_ID, (id, prefix: string) => fresh(id, prefix));
    if (file === NOVEL_MANIFEST || file === MANIFEST) content = editYaml(content, [{ path: ["title"], value: title }, ...(author ? [{ path: ["author"], value: author }] : [])]);
    await files.write(to, content);
  }
  const readme = files.join(dest, "README.md");
  await files.write(readme, (await text(readme))!.replace(/^# .*$/m, `# ${title}`));
  for (const [file, content] of snapshots(await loadBook(bookSource(dest)))) await files.write(files.join(dest, file), content);

  const git = gitPort();
  await git.init(dest, "main");
  if (identity) {
    await git.setConfig(dest, "user.name", identity.name);
    await git.setConfig(dest, "user.email", identity.email);
  } else if (!(await hasGitIdentity(dest))) {
    throw new NeedsIdentity();
  }
  await git.stage(dest);
  await git.commit(dest, `Start ${title}`);
}

const decoder = new TextDecoder();
