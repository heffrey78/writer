import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { editFrontMatter, editYaml, indexById, kindByKey, loadBook, numberedName, pieceLevel, slugify, startLevels, uniqueId, V2_KIND, type Book, type BookKind, type LevelDef, type Piece, type Section } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { parse, stringify } from "yaml";
import { git } from "./git.ts";
import { OperationError, transaction, type FileWrite, type OperationResult } from "./operations.ts";

/** A piece or section that was deleted and can be brought back. */
export interface DeletedItem {
  /** The commit that deleted it: restore it from the one before. */
  commit: string;
  date: string;
  /** The piece's key in the book's kind ("scene"), or the section's level ("chapter", "part"). */
  kind: string;
  id: string;
  title: string;
  /** Where it was, relative to the novel. */
  path: string;
}

/** What holds a list of children: a section, or the book itself (its _order.yaml). */
type Container = { section: Section } | { top: true };

type Item = { kind: "piece"; piece: Piece } | { kind: "section"; section: Section; level: LevelDef };

/** Pending changes on top of the disk: what every step of an operation reads and writes. */
class Overlay {
  readonly writes = new Map<string, string | null>();
  readonly root: string;
  constructor(root: string) {
    this.root = root;
  }

  async read(path: string): Promise<string | null> {
    if (this.writes.has(path)) return this.writes.get(path)!;
    return readFile(join(this.root, path), "utf8").catch(() => null);
  }

  set(path: string, content: string | null): void {
    this.writes.set(path, content);
  }

  /** Text files under `dir`, as they are now (pending changes included). */
  async files(dir: string): Promise<string[]> {
    const out = new Set<string>();
    const walk = async (d: string): Promise<void> => {
      for (const e of await readdir(join(this.root, d), { withFileTypes: true }).catch(() => [])) {
        const p = posix.join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else if (!e.name.startsWith(".")) out.add(p);
      }
    };
    await walk(dir);
    for (const [p, c] of this.writes) {
      if (!p.startsWith(`${dir}/`)) continue;
      if (c === null) out.delete(p);
      else out.add(p);
    }
    return [...out].sort();
  }

  /** Move files from → to all at once (contents read first, so names can be swapped). */
  async move(moves: [string, string][]): Promise<void> {
    const real = moves.filter(([a, b]) => a !== b);
    const contents = await Promise.all(real.map(([from]) => this.read(from)));
    for (const [from] of real) this.set(from, null);
    real.forEach(([, to], i) => this.set(to, contents[i]!));
  }

  /** The net changes: a file created and then moved on within the operation was never there. */
  changes(): FileWrite[] {
    return [...this.writes].filter(([path, content]) => content !== null || existsSync(join(this.root, path))).map(([path, content]) => ({ path, content }));
  }
}

/**
 * Reshaping the manuscript: create, rename, move, split, merge, delete and restore pieces and sections
 * at any of the book's kind's levels. Each is one commit. IDs never change; order files are edited in
 * place; numbered file and folder names follow the order (only the number changes, unless the item is
 * renamed).
 */
export class ManuscriptOperations {
  readonly root: string;
  #exclusive: <T>(fn: () => Promise<T>) => Promise<T>;
  #kindOf: () => BookKind;

  /** `kind`: the book's kind (the workspace says; a novel, format v2's, by default). */
  constructor(root: string, exclusive: <T>(fn: () => Promise<T>) => Promise<T>, kind: () => BookKind = () => kindByKey(V2_KIND)) {
    this.root = root;
    this.#exclusive = exclusive;
    this.#kindOf = kind;
  }

  /** A new scene in a chapter (a piece in a section of the innermost level), after `after` (null: first; omitted: last). */
  createScene(chapterId: string, { title, after }: { title: string; after?: string | null }): Promise<OperationResult & { id: string }> {
    return this.#exclusive(async () => {
      const novel = await this.#load();
      const { id, title: name, writes } = await this.sceneWrites(novel, chapterId, { title, ...(after !== undefined ? { after } : {}) });
      return { ...(await transaction(this.root, writes, `Manuscript: add ${novel.kind.piece.key} “${name}”`)), id };
    });
  }

  /**
   * What adding a piece to a section writes, for an operation to commit with its own changes: the
   * piece's file, with `front` after its ID, title and status, and the section's order and numbering.
   */
  async sceneWrites(novel: Book, chapterId: string, { title, after, front = {} }: { title: string; after?: string | null; front?: Record<string, unknown> }): Promise<{ id: string; title: string; file: string; writes: FileWrite[] }> {
    const o = new Overlay(this.root);
    const chapter = this.#holder(novel, chapterId);
    const name = required(title, "title");
    const id = uniqueId(novel.kind.piece.prefix, new Set(indexById(novel).keys()));
    const path = `${chapter.dir}/${slugify(name)}.md`;
    // In a piece's usual order: ID, title, synopsis and status, then the rest.
    const { synopsis, status = novel.kind.statuses[0]!.key, ...rest } = front;
    o.set(path, `---\n${stringify({ id, title: name, ...(synopsis ? { synopsis } : {}), status, ...rest }, { lineWidth: 0 })}---\n`);
    await this.#insert(o, novel, { section: chapter }, id, after);
    await this.#renumber(o, novel, { section: chapter }, new Map([[id, path]]));
    const writes = o.changes();
    // Where it is once numbered.
    const file = writes.find((w) => typeof w.content === "string" && w.path.endsWith(".md") && w.content.startsWith(`---\nid: ${id}\n`))!.path;
    return { id, title: name, file, writes };
  }

  /** A new, empty chapter in a part (or at the top level), after `after`. */
  createChapter(partId: string | null, options: { title?: string; after?: string | null }): Promise<OperationResult & { id: string }> {
    return this.#run(async (novel, o) => this.#createSection(novel, o, pieceLevel(novel), partId, options));
  }

  /** A new, empty part, after `after`: the level out from the chapters, only in a book that uses it. */
  createPart(options: { title: string; after?: string | null }): Promise<OperationResult & { id: string }> {
    return this.#run(async (novel, o) => {
      const level = novel.kind.levels.at(-2);
      if (!level) throw new OperationError("BAD_REQUEST", `A ${novel.kind.label.toLowerCase()} has no level out from its ${novel.kind.levels.at(-1)!.list}.`);
      return this.#createSection(novel, o, level.key, null, options);
    });
  }

  /** A new, empty section at a level of the book's kind, in `parentId` (null: at the top), after `after`. */
  createSection(level: string, parentId: string | null, options: { title?: string; after?: string | null }): Promise<OperationResult & { id: string }> {
    return this.#run(async (novel, o) => this.#createSection(novel, o, level, parentId, options));
  }

  async #createSection(novel: Book, o: Overlay, levelKey: string, parentId: string | null, { title, after }: { title?: string; after?: string | null }): Promise<{ message: string; id: string }> {
    const level = novel.kind.levels.find((l) => l.key === levelKey);
    if (!level) throw new OperationError("BAD_REQUEST", `A ${novel.kind.label.toLowerCase()} has no level “${levelKey}”.`);
    const parent = this.#containerFor(novel, level, parentId);
    const name = level.titled ? required(title, "title") : title?.trim();
    const id = uniqueId(level.prefix, new Set(indexById(novel).keys()));
    const dir = `${this.#dir(novel, parent)}/${slugify(name || level.key)}`;
    o.set(`${dir}/_${level.key}.yaml`, stringify({ id, ...(name ? { title: name } : {}), [childList(novel.kind, level)]: [] }, { lineWidth: 0, flowCollectionPadding: false }));
    await this.#insert(o, novel, parent, id, after);
    await this.#renumber(o, novel, parent, new Map([[id, dir]]));
    return { message: `Manuscript: add ${level.key}${name ? ` “${name}”` : ""}`, id };
  }

  /** A new title for a piece or section; its file or folder name follows. */
  rename(id: string, title: string): Promise<OperationResult> {
    return this.#run(async (novel, o) => {
      const name = title.trim();
      const item = this.#find(novel, id);
      if ((item.kind === "piece" || item.level.titled) && !name) throw new OperationError("BAD_REQUEST", "A title is required.");
      if (item.kind === "piece") {
        o.set(item.piece.file, editFrontMatter((await o.read(item.piece.file))!, [{ path: ["title"], value: name }]));
        await o.move([[item.piece.file, rename(item.piece.file, slugify(name), ".md")]]);
      } else {
        const { file, dir } = item.section;
        o.set(file, editYaml((await o.read(file))!, [name ? { path: ["title"], value: name } : { path: ["title"], remove: true }]));
        await this.#moveDir(o, dir, rename(dir, slugify(name || item.level.key), ""));
      }
      return { message: `Manuscript: rename ${kindOf(novel, item)} to “${name || "untitled"}”` };
    });
  }

  /**
   * Move a piece into a section (or a section into one of the level above, or at the top) at position
   * `index` among its new siblings. Reordering is a move within the same container.
   */
  move(id: string, { to, index }: { to?: string | null; index: number }): Promise<OperationResult> {
    return this.#run(async (novel, o) => {
      const item = this.#find(novel, id);
      let from: Container, target: Container;
      if (item.kind === "piece") {
        from = { section: this.#holder(novel, item.piece.sectionId!) };
        target = { section: this.#holder(novel, to ?? item.piece.sectionId!) };
      } else if (item.section.level === novel.levels[0]) {
        from = target = { top: true };
      } else {
        from = this.#containerFor(novel, item.level, item.section.parentId ?? null);
        target = this.#containerFor(novel, item.level, to === undefined ? (item.section.parentId ?? null) : to);
      }
      await this.#removeFrom(o, novel, from, id);
      const list = await this.#list(o, novel, target);
      const position = Math.max(0, Math.min(index, list.length));
      await this.#setList(o, novel, target, [...list.slice(0, position), id, ...list.slice(position)]);
      const paths = new Map<string, string>();
      if (!sameContainer(from, target)) {
        const dir = this.#dir(novel, target);
        if (item.kind === "piece") {
          const dest = `${dir}/${posix.basename(item.piece.file)}`;
          await o.move([[item.piece.file, dest]]);
          paths.set(id, dest);
        } else {
          const dest = `${dir}/${posix.basename(item.section.dir)}`;
          await this.#moveDir(o, item.section.dir, dest);
          paths.set(id, dest);
        }
        await this.#renumber(o, novel, from, new Map());
      }
      await this.#renumber(o, novel, target, paths);
      return { message: `Manuscript: move ${described(novel, item)}` };
    });
  }

  /**
   * Split a scene before its paragraph `paragraph` (0-based, counting blocks separated by blank lines):
   * the rest becomes a new scene, right after, titled `title`, keeping the first's status, point of view,
   * people, places, plotlines, themes and tags.
   */
  split(sceneId: string, { paragraph, title }: { paragraph: number; title: string }): Promise<OperationResult & { id: string }> {
    return this.#run(async (novel, o) => {
      const scene = this.#piece(novel, sceneId);
      const name = required(title, "title");
      const text = (await o.read(scene.file))!;
      const fmEnd = text.length - bodyOf(text).length;
      const body = text.slice(fmEnd);
      const starts = paragraphStarts(body);
      if (paragraph < 1 || paragraph >= starts.length) throw new OperationError("BAD_REQUEST", `Split between two paragraphs of the ${novel.kind.piece.key}.`);
      const cut = starts[paragraph]!;
      const first = text.slice(0, fmEnd) + body.slice(0, cut).replace(/\s*$/, "\n");
      const id = uniqueId(novel.kind.piece.prefix, new Set(indexById(novel).keys()));
      const keep = Object.fromEntries(
        Object.entries(parse(text.slice(0, fmEnd).replace(/^\uFEFF?---\r?\n/, "").replace(/---[ \t]*\r?\n?$/, "")) ?? {}).filter(([k]) =>
          ["status", "pov", "characters", "locations", "plotlines", "themes", "tags"].includes(k),
        ),
      );
      const path = `${posix.dirname(scene.file)}/${slugify(name)}.md`;
      o.set(scene.file, first);
      o.set(path, `---\n${stringify({ id, title: name, ...keep }, { lineWidth: 0 })}---\n${body.slice(cut)}`);
      const holder: Container = { section: this.#holder(novel, scene.sectionId!) };
      await this.#insert(o, novel, holder, id, sceneId);
      await this.#renumber(o, novel, holder, new Map([[id, path]]));
      return { message: `Manuscript: split “${scene.title}”, the rest as “${name}”`, id };
    });
  }

  /**
   * Merge a scene with the next one in its chapter: the next one's prose follows, its people and places
   * join the first's, and its file goes. Relationships that started or ended at it move to the first.
   */
  merge(sceneId: string): Promise<OperationResult> {
    return this.#run(async (novel, o) => {
      const scene = this.#piece(novel, sceneId);
      const chapter = this.#holder(novel, scene.sectionId!);
      const at = chapter.childIds.indexOf(sceneId);
      const next = novel.allPieces.find((s) => s.id === chapter.childIds[at + 1]);
      if (!next) throw new OperationError("BAD_REQUEST", `“${scene.title}” is the last ${novel.kind.piece.key} of its ${chapter.level}.`);
      const firstText = (await o.read(scene.file))!;
      const nextText = (await o.read(next.file))!;
      const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
      const edits = [
        ...(union(scene.characters, next.characters).length > scene.characters.length ? [{ path: ["characters"], value: union(scene.characters, next.characters) }] : []),
        ...(union(scene.locations, next.locations).length > scene.locations.length ? [{ path: ["locations"], value: union(scene.locations, next.locations) }] : []),
      ];
      const merged = editFrontMatter(firstText, edits).replace(/\s*$/, "\n") + "\n" + bodyOf(nextText).replace(/^\s+/, "");
      o.set(scene.file, merged);
      o.set(next.file, null);
      await this.#removeFrom(o, novel, { section: chapter }, next.id);
      await this.#retarget(o, novel, next.id, sceneId);
      await this.#renumber(o, novel, { section: chapter }, new Map());
      return { message: `Manuscript: merge “${next.title}” into “${scene.title}”` };
    });
  }

  /**
   * Delete a piece or a section (with what's in it). Its pieces are taken off the notes on them
   * (heffrey78/gh-writer#222); a note left on no piece is kept unattached or deleted as `notes` says,
   * and without it the delete is refused (NOTES_LEFT { notes }) for the app to ask. It stays in
   * history: see recentlyDeleted.
   */
  delete(id: string, { notes }: { notes?: "keep" | "delete" } = {}): Promise<OperationResult> {
    return this.#run(async (novel, o) => {
      const item = this.#find(novel, id);
      const gone = new Set(item.kind === "piece" ? [id] : novel.allPieces.filter((p) => within(novel, p.sectionId, id)).map((p) => p.id));
      const touched = novel.notes.filter((n) => n.scenes.some((s) => gone.has(s)) || n.pinned.some((s) => gone.has(s)));
      const left = touched.filter((n) => n.scenes.every((s) => gone.has(s)));
      if (left.length && !notes) {
        throw new OperationError("NOTES_LEFT", `${left.length === 1 ? "A note is" : `${left.length} notes are`} only on what's being deleted.`, { notes: left.map((n) => ({ id: n.id, title: n.title })) });
      }
      for (const n of touched) {
        const text = (await o.read(n.file)) ?? "";
        if (left.includes(n) && notes === "delete") {
          o.set(n.file, null);
          continue;
        }
        const scenes = n.scenes.filter((s) => !gone.has(s));
        const pinned = n.pinned.filter((s) => !gone.has(s));
        o.set(n.file, editFrontMatter(text, [scenes.length ? { path: ["scenes"], value: scenes } : { path: ["scenes"], remove: true }, pinned.length ? { path: ["pinned"], value: pinned } : { path: ["pinned"], remove: true }]));
      }
      if (item.kind === "piece") {
        const holder: Container = { section: this.#holder(novel, item.piece.sectionId!) };
        o.set(item.piece.file, null);
        await this.#removeFrom(o, novel, holder, id);
        await this.#renumber(o, novel, holder, new Map());
        return { message: `Manuscript: delete ${novel.kind.piece.key} “${item.piece.title}”` };
      }
      for (const f of await o.files(item.section.dir)) o.set(f, null);
      const parent = item.section.parentId ? ({ section: this.#section(novel, item.section.parentId) } as Container) : ({ top: true } as Container);
      await this.#removeFrom(o, novel, parent, id);
      await this.#renumber(o, novel, parent, new Map());
      return { message: `Manuscript: delete ${item.level.key} “${item.section.title ?? "untitled"}”` };
    });
  }

  /** Pieces and sections deleted from the manuscript, newest first, that aren't back already. */
  async recentlyDeleted(limit = 30): Promise<DeletedItem[]> {
    const kind = await this.#kind();
    const g = git(this.root);
    const log = await g.raw(["log", "--diff-filter=D", "--name-only", "--relative", "--format=%x1e%H%x1f%cI", "-n", "200", "--", kind.folders.content]).catch(() => "");
    const present = new Set(indexById(await this.#load()).keys());
    const sectionFile = new RegExp(`/_(${kind.levels.map((l) => l.key).join("|")})\\.yaml$`);
    const out: DeletedItem[] = [];
    for (const record of log.split("\x1e").filter((r) => r.trim())) {
      const [head, ...files] = record.trim().split("\n");
      const [commit, date] = head!.split("\x1f") as [string, string];
      const deleted = files.filter(Boolean);
      const containers = deleted.filter((f) => sectionFile.test(f)).map((f) => posix.dirname(f));
      // A section's own files are part of it; the outermost sections are the items.
      const tops = containers.filter((d) => !containers.some((other) => other !== d && d.startsWith(`${other}/`)));
      for (const dir of tops) {
        const level = kind.levels.find((l) => deleted.includes(`${dir}/_${l.key}.yaml`))!;
        const data = parse((await this.#show(`${commit}^`, `${dir}/_${level.key}.yaml`)) ?? "") as { id?: string; title?: string } | null;
        if (data?.id && !present.has(data.id)) out.push({ commit, date, kind: level.key, id: data.id, title: data.title ?? "untitled", path: dir });
      }
      for (const file of deleted.filter((f) => f.endsWith(".md") && !tops.some((d) => f.startsWith(`${d}/`)))) {
        const text = (await this.#show(`${commit}^`, file)) ?? "";
        const fm = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
        const data = (fm ? parse(fm) : null) as { id?: string; title?: string } | null;
        if (data?.id && !present.has(data.id)) out.push({ commit, date, kind: kind.piece.key, id: data.id, title: data.title ?? posix.basename(file), path: file });
      }
      if (out.length >= limit) break;
    }
    return out.slice(0, limit);
  }

  /** Bring back a deleted item from the commit before `commit` deleted it, into its place in the order. */
  restore(commit: string, id: string): Promise<OperationResult> {
    return this.#exclusive(async () => {
      const item = (await this.recentlyDeleted(200)).find((d) => d.commit === commit && d.id === id);
      if (!item) throw new OperationError("NOT_FOUND", "That isn't among the recently deleted.");
      const novel = await this.#load();
      const { kind } = novel;
      const o = new Overlay(this.root);
      const before = `${commit}^`;
      const isPiece = item.kind === kind.piece.key;
      const at = kind.levels.findIndex((l) => l.key === item.kind);
      // Where it was: its old container (by ID), and the sibling it followed.
      const parentDir = posix.dirname(item.path);
      const parentLevel = isPiece ? kind.levels.at(-1)! : parentDir === kind.folders.content ? undefined : kind.levels[at - 1];
      const parentFile = parentLevel ? `${parentDir}/_${parentLevel.key}.yaml` : orderPath(kind);
      const oldParent = (parse((await this.#show(before, parentFile)) ?? "") ?? {}) as Record<string, unknown>;
      const key = isPiece ? kind.piece.list : kind.levels[at]!.list;
      const oldList = Array.isArray(oldParent[key]) ? (oldParent[key] as string[]) : [];
      let container: Container;
      if (parentLevel) {
        const section = novel.allSections.find((s) => s.id === oldParent["id"]);
        if (!section) throw new OperationError("BAD_REQUEST", `The ${parentLevel.key} it was in is gone: bring that back first.`);
        container = { section };
      } else container = { top: true };

      // Its files, back under the container's current folder.
      const destDir = this.#dir(novel, container);
      const files = isPiece ? [item.path] : (await git(this.root).raw(["ls-tree", "-r", "--name-only", before, "--", `./${item.path}`])).split("\n").filter(Boolean);
      const taken = new Set((await o.files(destDir)).map((f) => f.slice(destDir.length + 1).split("/")[0]!));
      const base = posix.basename(item.path);
      let name = base;
      for (let n = 2; taken.has(name); n++) name = isPiece ? base.replace(/\.md$/, `-${n}.md`) : `${base}-${n}`;
      const newPath = `${destDir}/${name}`;
      for (const f of files) o.set(isPiece ? newPath : `${newPath}${f.slice(item.path.length)}`, (await this.#show(before, f)) ?? "");

      const current = await this.#list(o, novel, container);
      const previous = oldList.slice(0, oldList.indexOf(id)).reverse().find((s) => current.includes(s));
      const at2 = previous === undefined ? 0 : current.indexOf(previous) + 1;
      await this.#setList(o, novel, container, [...current.slice(0, at2), id, ...current.slice(at2)]);
      await this.#renumber(o, novel, container, new Map([[id, newPath]]));
      return transaction(this.root, o.changes(), `Manuscript: restore ${item.kind} “${item.title}”`);
    });
  }

  // ——— Steps ———

  #run<T extends object>(fn: (novel: Book, o: Overlay) => Promise<T & { message: string }>): Promise<OperationResult & Omit<T, "message">> {
    return this.#exclusive(async () => {
      const novel = await this.#load();
      const o = new Overlay(this.root);
      const { message, ...rest } = await fn(novel, o);
      return { ...(await transaction(this.root, o.changes(), message)), ...(rest as Omit<T, "message">) };
    });
  }

  /** The book's kind, without reading the book. */
  async #kind(): Promise<BookKind> {
    return this.#kindOf();
  }

  #load(): Promise<Book> {
    return loadBook(nodeSource(this.root), this.#kindOf());
  }

  async #show(rev: string, path: string): Promise<string | undefined> {
    return git(this.root).raw(["show", `${rev}:./${path}`]).catch(() => undefined);
  }

  #find(novel: Book, id: string): Item {
    const piece = novel.allPieces.find((s) => s.id === id);
    if (piece) return { kind: "piece", piece };
    const section = novel.allSections.find((s) => s.id === id);
    if (section) return { kind: "section", section, level: novel.kind.levels.find((l) => l.key === section.level)! };
    throw new OperationError("NOT_FOUND", `Nothing in the manuscript has the ID “${id}”.`);
  }

  #piece(novel: Book, id: string): Piece {
    const piece = novel.allPieces.find((s) => s.id === id);
    if (!piece) throw new OperationError("NOT_FOUND", `No ${novel.kind.piece.key} “${id}”.`);
    return piece;
  }

  /** A section of the innermost level: one that holds pieces (a chapter). */
  #holder(novel: Book, id: string): Section {
    const section = novel.allSections.find((s) => s.id === id && s.level === pieceLevel(novel));
    if (!section) throw new OperationError("NOT_FOUND", `No ${pieceLevel(novel)} “${id}”.`);
    return section;
  }

  #section(novel: Book, id: string): Section {
    const section = novel.allSections.find((s) => s.id === id);
    if (!section) throw new OperationError("NOT_FOUND", `Nothing in the manuscript has the ID “${id}”.`);
    return section;
  }

  /**
   * Where a section of `level` goes: in `parentId`, a section of the level above, or (null) at the top,
   * where only the level the book starts at may be.
   */
  #containerFor(novel: Book, level: LevelDef, parentId: string | null): Container {
    const { levels } = novel.kind;
    const above = levels[levels.indexOf(level) - 1];
    if (parentId) {
      const parent = novel.allSections.find((s) => s.id === parentId && s.level === above?.key);
      if (!parent) throw new OperationError("NOT_FOUND", `No ${above?.key ?? "section"} “${parentId}”.`);
      return { section: parent };
    }
    const top = levels.find((l) => l.key === novel.levels[0]);
    if (top && levels.indexOf(level) > levels.indexOf(top)) throw new OperationError("BAD_REQUEST", `In a book organised in ${top.list}, a ${level.key} belongs to a ${above!.key}.`);
    if (top && levels.indexOf(level) < levels.indexOf(top)) throw new OperationError("BAD_REQUEST", `This book is organised in ${top.list}, not ${level.list}.`);
    return { top: true };
  }

  /** The order file of a container, and the key its list is under. */
  async #orderFile(o: Overlay, novel: Book, c: Container): Promise<{ path: string; key: string }> {
    if ("section" in c) {
      const level = novel.kind.levels.find((l) => l.key === c.section.level)!;
      return { path: c.section.file, key: childList(novel.kind, level) };
    }
    // The top: the list _order.yaml has, else the first level a book must have (a novel's chapters).
    const path = orderPath(novel.kind);
    const data = (parse((await o.read(path)) ?? "") ?? {}) as Record<string, unknown>;
    const starts = startLevels(novel.kind);
    return { path, key: (starts.find((l) => l.list in data) ?? starts.at(-1)!).list };
  }

  async #list(o: Overlay, novel: Book, c: Container): Promise<string[]> {
    const { path, key } = await this.#orderFile(o, novel, c);
    const data = (parse((await o.read(path)) ?? "") ?? {}) as Record<string, unknown>;
    return Array.isArray(data[key]) ? (data[key] as string[]) : [];
  }

  async #setList(o: Overlay, novel: Book, c: Container, list: string[]): Promise<void> {
    const { path, key } = await this.#orderFile(o, novel, c);
    o.set(path, editYaml((await o.read(path)) ?? "", [{ path: [key], value: list }]));
  }

  async #insert(o: Overlay, novel: Book, c: Container, id: string, after: string | null | undefined): Promise<void> {
    const list = await this.#list(o, novel, c);
    const at = after === undefined ? list.length : after === null ? 0 : list.indexOf(after) + 1;
    if (after && !list.includes(after)) throw new OperationError("BAD_REQUEST", `“${after}” isn't in that ${"section" in c ? c.section.level : "list"}.`);
    await this.#setList(o, novel, c, [...list.slice(0, at), id, ...list.slice(at)]);
  }

  async #removeFrom(o: Overlay, novel: Book, c: Container, id: string): Promise<void> {
    await this.#setList(o, novel, c, (await this.#list(o, novel, c)).filter((x) => x !== id));
  }

  /** A container's folder: a section's, or the book's content folder. */
  #dir(novel: Book, c: Container): string {
    return "section" in c ? c.section.dir : novel.kind.folders.content;
  }

  /** Move every file under `from` to `to`. */
  async #moveDir(o: Overlay, from: string, to: string): Promise<void> {
    if (from === to) return;
    await o.move((await o.files(from)).map((f) => [f, `${to}${f.slice(from.length)}`] as [string, string]));
  }

  /**
   * Give a container's children their numbered names in list order. `paths` has the current path of
   * children that moved or are new in this operation (the model has the rest).
   */
  async #renumber(o: Overlay, novel: Book, c: Container, paths: Map<string, string>): Promise<void> {
    const list = await this.#list(o, novel, c);
    const current = (id: string): string | undefined => paths.get(id) ?? novel.allPieces.find((s) => s.id === id)?.file ?? novel.allSections.find((x) => x.id === id)?.dir;
    const fileMoves: [string, string][] = [];
    const dirMoves: [string, string][] = [];
    list.forEach((id, i) => {
      const path = current(id);
      if (!path) return;
      const isFile = path.endsWith(".md");
      const base = posix.basename(path, isFile ? ".md" : "");
      const slug = base.replace(/^\d+-/, "") || "untitled";
      const wanted = `${this.#dir(novel, c)}/${numberedName(i, list.length, slug)}${isFile ? ".md" : ""}`;
      if (wanted !== path) (isFile ? fileMoves : dirMoves).push([path, wanted]);
    });
    await o.move(fileMoves);
    // Folders move file by file; reading them all first lets two folders swap names.
    const all: [string, string][] = [];
    for (const [from, to] of dirMoves) for (const f of await o.files(from)) all.push([f, `${to}${f.slice(from.length)}`]);
    await o.move(all);
  }

  /** Relationships that start or end at `from` now do at `to`, and notes on it are on `to` (merged scenes). */
  async #retarget(o: Overlay, novel: Book, from: string, to: string): Promise<void> {
    // Notes on it are on the merged scene now (heffrey78/gh-writer#222); a pin goes too, unless that scene has one already.
    const pinnedThere = novel.notes.some((n) => n.pinned.includes(to));
    for (const n of novel.notes.filter((x) => x.scenes.includes(from) || x.pinned.includes(from))) {
      const scenes = [...new Set(n.scenes.map((s) => (s === from ? to : s)))];
      const pinned = [...new Set(n.pinned.flatMap((s) => (s !== from ? [s] : pinnedThere ? [] : [to])))];
      o.set(n.file, editFrontMatter((await o.read(n.file)) ?? "", [{ path: ["scenes"], value: scenes }, pinned.length ? { path: ["pinned"], value: pinned } : { path: ["pinned"], remove: true }]));
    }
    const path = `${novel.kind.folders.codex}/relationships.yaml`;
    let text = await o.read(path);
    if (text === null) return;
    for (const r of novel.relationships) {
      for (const bound of ["since", "until"] as const) {
        if (r[bound] === from) text = editYaml(text, [{ path: ["relationships", r.index, bound], value: to }]);
      }
    }
    o.set(path, text);
  }
}

/** The key a section of `level` lists its children under: the next level's list, or the pieces'. */
function childList(kind: BookKind, level: LevelDef): string {
  const next = kind.levels[kind.levels.indexOf(level) + 1];
  return next ? next.list : kind.piece.list;
}

const orderPath = (kind: BookKind) => `${kind.folders.content}/_order.yaml`;

/** Whether a section is `id` or inside it. */
function within(novel: Book, sectionId: string | undefined, id: string): boolean {
  const section = novel.allSections.find((s) => s.id === sectionId);
  return !!section && (section.id === id || within(novel, section.parentId, id));
}

/** What an item is, in the kind's words: "scene", "chapter", "part". */
const kindOf = (novel: Book, item: Item) => (item.kind === "piece" ? novel.kind.piece.key : item.level.key);

/** An item as a commit message names it: scene “The Bridge”, chapter, part “Act One”. */
function described(novel: Book, item: Item): string {
  if (item.kind === "piece") return `${novel.kind.piece.key} “${item.piece.title}”`;
  const { title } = item.section;
  return item.level.titled || title ? `${item.level.key} “${title ?? ""}”` : item.level.key;
}

function required(value: string | undefined, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new OperationError("BAD_REQUEST", `A ${field} is required.`);
  return value.trim();
}

const sameContainer = (a: Container, b: Container) => ("top" in a && "top" in b) || ("section" in a && "section" in b && a.section.id === b.section.id);

/** `path` with a new slug, keeping its number prefix: 03-old.md → 03-new.md. */
function rename(path: string, slug: string, ext: string): string {
  const base = posix.basename(path, ext);
  const number = /^(\d+)-/.exec(base)?.[1];
  return `${posix.dirname(path)}/${number ? `${number}-` : ""}${slug}${ext}`;
}

/** The body after front matter. */
function bodyOf(text: string): string {
  const m = /^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

/** Offsets where each paragraph (block separated by blank lines) starts in `body`: at the start of its first line. */
function paragraphStarts(body: string): number[] {
  const first = body.search(/\S/);
  if (first < 0) return [];
  const starts = [body.lastIndexOf("\n", first) + 1];
  for (const m of body.matchAll(/\n[ \t]*\r?\n(?=[ \t]*\S)/g)) starts.push(m.index + m[0].length);
  return [...new Set(starts)].sort((a, b) => a - b);
}
