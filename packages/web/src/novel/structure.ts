import { pieceLevel, pieceSections, sectionById, vocabulary, type Book, type LevelDef, type Section } from "@writer/core";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api, keys } from "../api.ts";
import { useNotesLeft } from "../notes/notes-left.tsx";
import { chapterTitle } from "./navigation.tsx";
import { useNotice } from "./notice.tsx";
import type { Workspace } from "./workspace.ts";

/** What an item is: the piece's key ("scene") or the section's level ("chapter", "part"), said with vocabulary(kind).of(). */
export type ItemKind = string;

/** What an ID is in the manuscript, with its title for messages. */
export function itemOf(novel: Book, id: string): { kind: ItemKind; title: string } | undefined {
  const piece = novel.allPieces.find((s) => s.id === id);
  if (piece) return { kind: novel.kind.piece.key, title: piece.title };
  const section = sectionById(novel, id);
  return section ? { kind: section.level, title: chapterTitle(novel, section) } : undefined;
}

/** The section holding pieces that's open: the one given, or the one holding the piece given. */
export function openSection(novel: Book, current: string | undefined): string | undefined {
  const inner = pieceLevel(novel);
  return novel.allPieces.find((s) => s.id === current)?.sectionId ?? (novel.allSections.some((c) => c.id === current && c.level === inner) ? current : undefined);
}

/** The levels the book uses, innermost first, as New lists them; one that needs a section above it that isn't there yet can't be added. */
export function usableLevels(novel: Book): { level: LevelDef; disabled: boolean }[] {
  const { levels } = novel.kind;
  return [...novel.levels].reverse().flatMap((key) => {
    const at = levels.findIndex((l) => l.key === key);
    const level = levels[at];
    if (!level) return [];
    const above = levels[at - 1];
    return [{ level, disabled: key !== novel.levels[0] && !!above && !novel.sections.some((s) => s.level === above.key) }];
  });
}

/** Where a new section goes at the end of the book: in the last section of the level above, after the last of its own there. */
export function newSectionAtEnd(novel: Book, level: LevelDef): { parent: string | null; after: string | null } {
  const { levels } = novel.kind;
  const above = level.key === novel.levels[0] ? undefined : levels[levels.findIndex((l) => l.key === level.key) - 1];
  const parent = (above && novel.sections.filter((s) => s.level === above.key).at(-1)?.id) || null;
  const after = novel.sections.filter((s) => s.level === level.key && (s.parentId ?? null) === parent).at(-1)?.id ?? null;
  return { parent, after };
}

/** Where a new section of a level goes: in the open chapter's section of the level above (or the first), after its own. */
export function newSectionPlace(novel: Book, level: LevelDef, current: string | undefined): { parent: string | null; after: string | null } {
  const inner = pieceLevel(novel);
  const open = openSection(novel, current);
  const at = (key: string): string | undefined => {
    let s = sectionById(novel, open);
    while (s && s.level !== key) s = sectionById(novel, s.parentId);
    return s?.id;
  };
  const { levels } = novel.kind;
  const above = levels[levels.findIndex((l) => l.key === level.key) - 1];
  const parent = level.key === novel.levels[0] || !above ? null : (at(above.key) ?? novel.sections.find((s) => s.level === above.key)?.id ?? null);
  const after = at(level.key) ?? (level.key === inner ? null : (novel.sections.filter((s) => s.level === level.key).at(-1)?.id ?? null));
  return { parent, after };
}

/** The ordered list an item sits in, and the container it belongs to (null: the top level). */
export function siblingsOf(novel: Book, id: string): { container: string | null; list: string[] } | undefined {
  const piece = novel.allPieces.find((s) => s.id === id);
  if (piece) {
    const section = sectionById(novel, piece.sectionId);
    return section ? { container: section.id, list: section.childIds } : undefined;
  }
  const section = sectionById(novel, id);
  if (!section) return undefined;
  if (section.parentId) return { container: section.parentId, list: sectionById(novel, section.parentId)?.childIds ?? [] };
  return { container: null, list: novel.sections.filter((s) => !s.parentId).map((s) => s.id) };
}

/** Whether a piece's section is `id`, or inside it. */
export function within(novel: Book, sectionId: string | undefined, id: string): boolean {
  const section = sectionById(novel, sectionId);
  return !!section && (section.id === id || within(novel, section.parentId, id));
}

/**
 * Where moving `id` up or down one place takes it: the server's `index` (in the list after it's taken
 * out) and container. A scene at the edge of its chapter goes to the end of the previous chapter or
 * the start of the next; anything else at an edge stays put (undefined).
 */
export function stepMove(novel: Book, id: string, direction: -1 | 1): { index: number; to: string | null } | undefined {
  const at = siblingsOf(novel, id);
  if (!at) return undefined;
  const i = at.list.indexOf(id);
  const j = i + direction;
  if (j >= 0 && j < at.list.length) return { index: j, to: at.container };
  if (!novel.allPieces.some((p) => p.id === id)) return undefined;
  const chapters = pieceSections(novel);
  const c = chapters.findIndex((x) => x.id === at.container);
  const next: Section | undefined = chapters[c + direction];
  if (!next) return undefined;
  return { index: direction < 0 ? next.childIds.length : 0, to: next.id };
}

/** Moving `id` to just before or after `target`, an item of the same kind: the server's index and container. */
export function dropMove(novel: Book, id: string, target: string, after: boolean): { index: number; to: string | null } | undefined {
  const at = siblingsOf(novel, target);
  if (!at || id === target) return undefined;
  const list = at.list.filter((x) => x !== id);
  return { index: list.indexOf(target) + (after ? 1 : 0), to: at.container };
}

/** Moves waiting their turn, per novel, shared by every view (tree, outline, corkboard, swimlanes). */
const queues = new Map<string, Promise<unknown>>();

/** Run `task` after the novel's earlier moves have finished. */
function enqueue<T>(novelId: string, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(novelId) ?? Promise.resolve()).catch(() => {}).then(task);
  queues.set(novelId, next);
  return next;
}

/**
 * Structural changes from the UI: unsaved text is saved first, the model is reloaded after, and the
 * result (or the reason it failed) is announced; a delete offers Undo.
 */
export function useStructure(novelId: string, novel: Book, workspace: Workspace) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const show = useNotice((s) => s.show);
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
  const m = api.manuscript;

  async function run<T>(what: string, op: () => Promise<T>, done?: (result: T) => string | undefined): Promise<T | undefined> {
    await workspace.autosave.flush();
    try {
      const result = await op();
      await refresh();
      const message = done?.(result);
      if (message) show({ message });
      return result;
    } catch (e) {
      show({ message: `Couldn't ${what}: ${e instanceof Error ? e.message : String(e)}` });
      return undefined;
    }
  }

  const w = vocabulary(novel.kind);
  const name = (id: string) => itemOf(novel, id)?.title ?? id;
  const where = (to: string | null) => (to ? (itemOf(novel, to)?.title ?? "") : "the top level");

  return {
    move: (id: string, index: number, to: string | null) =>
      enqueue(novelId, () => run("move it", () => m.move(novelId, id, index, to), () => `Moved “${name(id)}” to ${where(to)}, position ${index + 1}.`)),
    // Each step is worked out when its turn comes, from the model as the moves before it left it:
    // two quick presses move two places, not one twice.
    step: (id: string, direction: -1 | 1) =>
      enqueue(novelId, async () => {
        const now = queryClient.getQueryData<{ novel: Book }>(keys.novel(novelId))?.novel ?? novel;
        const target = stepMove(now, id, direction);
        if (!target) return undefined;
        const into = target.to !== siblingsOf(now, id)?.container ? ` into “${(target.to && itemOf(now, target.to)?.title) || ""}”` : "";
        return run("move it", () => m.move(novelId, id, target.index, target.to), () => `Moved “${name(id)}” ${direction < 0 ? "up" : "down"}${into}.`);
      }),
    rename: (id: string, title: string) => run("rename it", () => m.rename(novelId, id, title), () => `Renamed to “${title}”.`),
    /** `stay`: added from a list of them, which goes on showing, and says so itself. */
    createScene: (chapter: string, title: string, after?: string | null, { stay }: { stay?: boolean } = {}) =>
      run(`add the ${w.piece.one}`, () => m.createScene(novelId, chapter, title, after), ({ id }) => {
        if (stay) return undefined;
        void navigate(`/novels/${novelId}/scene/${id}`);
        return `Added the ${w.piece.one} “${title}”.`;
      }),
    /** A section at a level of the book's kind: one that holds pieces opens, as a chapter does. */
    createSection: (level: string, parent: string | null, title: string | undefined, after?: string | null, { stay }: { stay?: boolean } = {}) => {
      const { levels } = novel.kind;
      const child = levels[levels.findIndex((l) => l.key === level) + 1];
      return run(`add the ${w.level(level).one}`, () => m.createSection(novelId, level, parent, title, after), ({ id }) => {
        if (stay) return undefined;
        if (!child) {
          void navigate(`/novels/${novelId}/chapter/${id}`);
          return `Added the ${w.level(level).one}${title ? ` “${title}”` : ""}.`;
        }
        return `Added the ${w.level(level).one}${title ? ` “${title}”` : ""}. Add ${w.level(child.key).a} to it from its menu.`;
      });
    },
    remove: async (id: string) => {
      const item = itemOf(novel, id);
      // Notes on only what's going (heffrey78/gh-writer#222): kept unattached or deleted too, as the author says.
      const gone = new Set(novel.allPieces.filter((s) => s.id === id || within(novel, s.sectionId, id)).map((s) => s.id));
      const left = novel.notes.filter((n) => n.scenes.length > 0 && n.scenes.every((s) => gone.has(s)));
      const notes = left.length ? await useNotesLeft.getState().ask(`the ${item ? w.of(item.kind).one : "item"} “${item?.title ?? id}”`, left) : undefined;
      if (notes === null) return undefined;
      return run("delete it", () => m.delete(novelId, id, notes), (result) => {
        show({
          message: `Deleted the ${item ? w.of(item.kind).one : "item"} “${item?.title ?? id}”.`,
          ...(result.commit ? { action: { label: "Undo", run: () => void run("bring it back", () => m.restore(novelId, result.commit!, id), () => `“${item?.title ?? id}” is back.`) } } : {}),
        });
        return undefined;
      });
    },
    restore: (commit: string, id: string, title: string) => run("bring it back", () => m.restore(novelId, commit, id), () => `“${title}” is back.`),
    split: (scene: string, paragraph: number, title: string) =>
      run(`split the ${w.piece.one}`, () => m.split(novelId, scene, paragraph, title), () => `Split “${name(scene)}”: the rest is now “${title}”.`),
    merge: (scene: string) => {
      const chapter = novel.allSections.find((c) => c.level === pieceLevel(novel) && c.childIds.includes(scene));
      const next = chapter?.childIds[chapter.childIds.indexOf(scene) + 1];
      return run(`merge the ${w.piece.many}`, () => m.merge(novelId, scene), () => `Merged “${next ? name(next) : `the next ${w.piece.one}`}” into “${name(scene)}”.`);
    },
  };
}

export type Structure = ReturnType<typeof useStructure>;
