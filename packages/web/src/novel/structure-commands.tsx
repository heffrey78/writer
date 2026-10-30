import { pieceLevel, sectionById, vocabulary, type Book, type LevelDef } from "@writer/core";
import { memo, useState } from "react";
import { useCommands, type Command } from "../commands.ts";
import { StructureDialogs, type StructureDialog } from "./structure-dialogs.tsx";
import { itemOf, newSectionPlace, openSection, siblingsOf, usableLevels, useStructure } from "./structure.ts";
import type { Workspace } from "./workspace.ts";

/**
 * The palette's commands for the book's structure: New, Rename, Move, Merge and Delete. They're the
 * book's, not the tree's, so they're there wherever the tree isn't: on a phone, and in focus mode.
 */
export const StructureCommands = memo(function StructureCommands({ novelId, novel, workspace, current }: { novelId: string; novel: Book; workspace: Workspace; current: string | undefined }) {
  const structure = useStructure(novelId, novel, workspace);
  const [dialog, setDialog] = useState<StructureDialog>();
  const w = vocabulary(novel.kind);
  const inner = pieceLevel(novel);
  const currentChapter = openSection(novel, current);
  const usable = usableLevels(novel);
  const newSection = (level: LevelDef): StructureDialog => ({ kind: "new-section", level, ...newSectionPlace(novel, level, current) });
  useCommands((): Command[] => {
    const item = current ? itemOf(novel, current) : undefined;
    const list = current ? (siblingsOf(novel, current)?.list ?? []) : [];
    const here = item && current ? { id: current, kind: item.kind, role: item.kind === novel.kind.piece.key ? "piece" : "section", pos: list.indexOf(current) + 1, size: list.length } : undefined;
    return [
      ...(currentChapter ? [{ id: "tree.newScene", title: `New ${w.piece.one}`, group: w.content.One, run: () => setDialog({ kind: "new-scene", chapter: currentChapter, ...(here?.role === "piece" ? { after: here.id } : {}) }) }] : []),
      ...usable.map(({ level }) => ({ id: level.key === inner ? "tree.newChapter" : `tree.new.${level.key}`, title: `New ${w.level(level.key).one}`, group: w.content.One, run: () => setDialog(newSection(level)) })),
      ...novel.sections
        .filter((s) => s.level !== inner)
        .flatMap((s): Command[] => [
          { id: `tree.rename.${s.id}`, title: `Rename ${w.level(s.level).one} “${s.title ?? ""}”…`, group: w.content.One, run: () => setDialog({ kind: "rename", id: s.id, title: s.title ?? "" }) },
          { id: `tree.delete.${s.id}`, title: `Delete ${w.level(s.level).one} “${s.title ?? ""}”`, group: w.content.One, run: () => void structure.remove(s.id) },
        ]),
      { id: "tree.deleted", title: "Recently deleted", group: w.content.One, run: () => setDialog({ kind: "deleted" }) },
      ...(here
        ? [
            { id: "tree.rename", title: `Rename ${w.of(here.kind).one}…`, group: w.content.One, keys: "F2", run: () => setDialog({ kind: "rename", id: here.id, title: sectionById(novel, here.id)?.title ?? itemOf(novel, here.id)?.title ?? "" }) },
            { id: "tree.up", title: `Move ${w.of(here.kind).one} up`, group: w.content.One, keys: "Alt-ArrowUp", run: () => void structure.step(here.id, -1) },
            { id: "tree.down", title: `Move ${w.of(here.kind).one} down`, group: w.content.One, keys: "Alt-ArrowDown", run: () => void structure.step(here.id, 1) },
            ...(here.role === "piece" ? [{ id: "tree.moveTo", title: `Move ${w.piece.one} to ${w.level(inner).one}…`, group: w.content.One, run: () => setDialog({ kind: "move", id: here.id }) }] : []),
            ...(here.role === "piece" && here.pos < here.size ? [{ id: "tree.merge", title: `Merge ${w.piece.one} with the next`, group: w.content.One, run: () => void structure.merge(here.id) }] : []),
            { id: "tree.delete", title: `Delete ${w.of(here.kind).one}`, group: w.content.One, keys: "Delete", run: () => void structure.remove(here.id) },
          ]
        : []),
    ];
  }, [current, currentChapter, novel, structure]);
  return dialog ? <StructureDialogs novelId={novelId} novel={novel} structure={structure} dialog={dialog} onClose={() => setDialog(undefined)} /> : null;
});
