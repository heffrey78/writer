import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { editYaml, kindOf, loadBook, MANIFEST, newId, NOVEL_MANIFEST } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { snapshots } from "@writer/core/snapshots";
import { hasGitIdentity } from "./committer.ts";
import { git } from "./git.ts";

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
  const kind = await kindOf({ read: (path) => readFile(join(template, path), "utf8").catch(() => undefined) });
  const roots = [MANIFEST, NOVEL_MANIFEST, ...(kind ? [kind.folders.content, kind.folders.codex, kind.folders.notes].map((f) => `${f}/`) : []), "diagrams/"];

  for (const file of await files(template)) {
    const to = join(dest, file);
    await mkdir(dirname(to), { recursive: true });
    if (!STORY_FILE.test(file) || !roots.some((r) => file === r || file.startsWith(r))) {
      await copyFile(join(template, file), to);
      continue;
    }
    let text = (await readFile(join(template, file), "utf8")).replace(TEMPLATE_ID, (id, prefix: string) => fresh(id, prefix));
    if (file === NOVEL_MANIFEST || file === MANIFEST) text = editYaml(text, [{ path: ["title"], value: title }, ...(author ? [{ path: ["author"], value: author }] : [])]);
    await writeFile(to, text);
  }
  const readme = join(dest, "README.md");
  await writeFile(readme, (await readFile(readme, "utf8")).replace(/^# .*$/m, `# ${title}`));
  for (const [file, text] of snapshots(await loadBook(nodeSource(dest)))) await writeFile(join(dest, file), text);

  const g = git(dest);
  await g.raw(["init", "-q", "-b", "main"]);
  if (identity) {
    await g.raw(["config", "user.name", identity.name]);
    await g.raw(["config", "user.email", identity.email]);
  } else if (!(await hasGitIdentity(dest))) {
    throw new NeedsIdentity();
  }
  await g.raw(["add", "-A"]);
  await g.raw(["commit", "-q", "-m", `Start ${title}`]);
}

/** Every file under `dir`, as paths relative to it with forward slashes. */
async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split("\\").join("/"))
    .sort();
}
