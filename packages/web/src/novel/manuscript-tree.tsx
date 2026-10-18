import { countWords, pieceLevel, sectionById, type Book, type LevelDef, type Section } from "@writer/core";
import { ChevronDown, ChevronRight, Ellipsis, FilePlus, FolderPlus, History, Layers, Plus } from "lucide-react";
import { ContextMenu, DropdownMenu } from "radix-ui";
import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { useCommands, type Command } from "../commands.ts";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { chapterTitle } from "./navigation.tsx";
import { dropMove, itemOf, stepMove, useStructure, type ItemKind, type Structure } from "./structure.ts";
import type { Workspace } from "./workspace.ts";
import { MoveToDialog, RecentlyDeletedDialog, TitleDialog } from "./structure-dialogs.tsx";

const number = new Intl.NumberFormat();

interface TreeNode {
  id: string;
  /** The piece's key ("scene") or the section's level ("chapter", "part"). */
  kind: ItemKind;
  /** A piece, a section that holds pieces (it opens, as a chapter does), or one further out (it folds, as a part does). */
  role: "piece" | "inner" | "outer";
  title: string;
  level: number;
  parent: string | null;
  /** Position among siblings, 1-based, and how many there are (aria-posinset/setsize). */
  pos: number;
  size: number;
  words: number;
  hasChildren: boolean;
}

type Dialog =
  | { kind: "rename"; id: string; title: string }
  | { kind: "new-scene"; chapter: string; after?: string | null }
  | { kind: "new-section"; level: LevelDef; parent: string | null; after: string | null }
  | { kind: "move"; id: string }
  | { kind: "deleted" };

/**
 * The manuscript as a tree: its sections at each level of its kind (a novel's parts and chapters) and
 * its pieces (scenes), with word counts. Arrows move, Enter opens,
 * F2 renames, Delete deletes (with Undo), Alt+Up/Down moves an item, letters jump; drag and drop
 * reorders; the context menu (right-click, Shift+F10) has the rest.
 */
export function ManuscriptTree({ novelId, novel, structure, current }: { novelId: string; novel: Book; structure: Structure; current: string | undefined }) {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string>();
  const [dialog, setDialog] = useState<Dialog>();
  const [drop, setDrop] = useState<{ id: string; at: "before" | "after" | "inside" }>();
  const dragging = useRef<string | undefined>(undefined);
  const typed = useRef({ text: "", at: 0 });
  /** An item moved from the keyboard: re-rendered elsewhere, it loses focus, so it gets it back. */
  const refocus = useRef<string | undefined>(undefined);
  const tree = useRef<HTMLDivElement>(null);

  const { levels, piece } = novel.kind;
  const inner = pieceLevel(novel);
  const levelOf = (key: string) => levels.find((l) => l.key === key);
  /** The level a section's children are at; none for one that holds pieces. */
  const childLevel = (key: string) => levels[levels.findIndex((l) => l.key === key) + 1];
  const parentLevel = (key: string) => levels[levels.findIndex((l) => l.key === key) - 1];

  const all = useMemo(() => {
    const out: TreeNode[] = [];
    const words = new Map(novel.allPieces.map((s) => [s.id, countWords(s.body)]));
    /** Sections in a list, each followed by what it holds; returns their words. */
    const sectionNodes = (sections: Section[], level: number, parent: string | null): number => {
      let total = 0;
      sections.forEach((s, i) => {
        const at = out.length;
        out.push({ id: s.id, kind: s.level, role: s.level === inner ? "inner" : "outer", title: chapterTitle(novel, s), level, parent, pos: i + 1, size: sections.length, words: 0, hasChildren: false });
        let n = 0;
        if (s.level === inner) {
          const pieces = s.childIds.map((id) => novel.allPieces.find((p) => p.id === id)).filter((p) => p !== undefined);
          pieces.forEach((p, j) => out.push({ id: p.id, kind: piece.key, role: "piece", title: p.title, level: level + 1, parent: s.id, pos: j + 1, size: pieces.length, words: words.get(p.id) ?? 0, hasChildren: false }));
          n = pieces.reduce((w, p) => w + (words.get(p.id) ?? 0), 0);
          out[at]!.hasChildren = pieces.length > 0;
        } else {
          const children = novel.sections.filter((c) => c.parentId === s.id);
          n = sectionNodes(children, level + 1, s.id);
          out[at]!.hasChildren = children.length > 0;
        }
        out[at]!.words = n;
        total += n;
      });
      return total;
    };
    sectionNodes(novel.sections.filter((s) => !s.parentId), 1, null);
    return out;
  }, [novel, inner, piece.key]);

  // Visible: everything whose ancestors are all expanded.
  const visible = useMemo(() => {
    const hidden = new Set<string>();
    return all.filter((n) => {
      if (n.parent && (collapsed.has(n.parent) || hidden.has(n.parent))) {
        hidden.add(n.id);
        return false;
      }
      return true;
    });
  }, [all, collapsed]);

  const active = focused && visible.some((n) => n.id === focused) ? focused : (current ?? visible[0]?.id);
  const focusNode = (id: string | undefined) => {
    if (!id) return;
    setFocused(id);
    requestAnimationFrame(() => tree.current?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus());
  };
  useEffect(() => {
    const id = refocus.current;
    if (!id) return;
    const el = tree.current?.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (el && document.activeElement !== el) el.focus();
  }, [all]);

  const open = (n: TreeNode) => {
    if (n.role === "outer") return toggle(n.id);
    void navigate(`/novels/${novelId}/${n.role === "piece" ? "scene" : "chapter"}/${n.id}`);
  };
  /** What a rename starts from: a section's own title (none for an untitled chapter, not "Chapter 3"). */
  const titleOf = (n: TreeNode) => (n.role === "piece" ? n.title : (sectionById(novel, n.id)?.title ?? ""));
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onKey = (e: KeyboardEvent) => {
    const i = visible.findIndex((n) => n.id === active);
    const n = visible[i];
    if (!n) return;
    const go = (target: TreeNode | undefined) => {
      e.preventDefault();
      focusNode(target?.id);
    };
    // The context menu from the keyboard. Chromium turns Shift+F10 into a contextmenu event by itself;
    // WebKit (the desktop app's window on macOS and Linux) doesn't, so the tree opens it at the item.
    if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
      e.preventDefault();
      const item = e.target as HTMLElement;
      const box = item.getBoundingClientRect();
      item.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.left + 16, clientY: box.bottom }));
      return;
    }
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      refocus.current = n.id;
      void Promise.resolve(structure.step(n.id, e.key === "ArrowUp" ? -1 : 1)).finally(() => setTimeout(() => (refocus.current = undefined), 1000));
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        return go(visible[i + 1]);
      case "ArrowUp":
        return go(visible[i - 1]);
      case "Home":
        return go(visible[0]);
      case "End":
        return go(visible.at(-1));
      case "ArrowRight":
        e.preventDefault();
        if (n.hasChildren && collapsed.has(n.id)) toggle(n.id);
        else if (n.hasChildren) focusNode(visible[i + 1]?.id);
        return;
      case "ArrowLeft":
        e.preventDefault();
        if (n.hasChildren && !collapsed.has(n.id)) toggle(n.id);
        else focusNode(n.parent ?? undefined);
        return;
      case "Enter":
        e.preventDefault();
        return open(n);
      case "F2":
        e.preventDefault();
        return setDialog({ kind: "rename", id: n.id, title: titleOf(n) });
      case "Delete":
        e.preventDefault();
        focusNode(visible[i + 1]?.id ?? visible[i - 1]?.id);
        void structure.remove(n.id);
        return;
    }
    // Typeahead: the next item whose title starts with what's been typed.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /\S/.test(e.key)) {
      const now = Date.now();
      typed.current = { text: now - typed.current.at < 700 ? typed.current.text + e.key.toLowerCase() : e.key.toLowerCase(), at: now };
      const order = [...visible.slice(i + 1), ...visible.slice(0, i + 1)];
      const match = order.find((x) => x.title.toLowerCase().startsWith(typed.current.text));
      if (match) go(match);
    }
  };

  // ——— Drag and drop ———
  const canDrop = (target: TreeNode, at: "before" | "after" | "inside") => {
    const dragged = all.find((x) => x.id === dragging.current);
    if (!dragged || target.id === dragging.current) return false;
    // Inside: a piece into a section that holds pieces, a section into one of the level above.
    if (at === "inside") return dragged.role === "piece" ? target.role === "inner" : parentLevel(dragged.kind)?.key === target.kind;
    return dragged.kind === target.kind;
  };
  const onDragOver = (e: DragEvent, target: TreeNode) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    const draggedKind = all.find((x) => x.id === dragging.current)?.kind;
    const at = draggedKind !== target.kind ? "inside" : y < 0.5 ? "before" : "after";
    if (!canDrop(target, at)) return setDrop(undefined);
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDrop({ id: target.id, at });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const id = dragging.current;
    const target = drop;
    setDrop(undefined);
    dragging.current = undefined;
    if (!id || !target) return;
    if (target.at === "inside") {
      // Into a section (a scene into a chapter, a chapter into a part): at its end.
      const list = sectionById(novel, target.id)?.childIds ?? [];
      void structure.move(id, list.filter((x) => x !== id).length, target.id);
      return;
    }
    const move = dropMove(novel, id, target.id, target.at === "after");
    if (move) void structure.move(id, move.index, move.to);
  };

  /** What can be done to an item: the right-click menu and the toolbar's ⋯ menu both list these. */
  type Action = { label: string; keys?: string; disabled?: boolean; danger?: boolean; run: () => void } | "separator";
  const actions = (n: TreeNode): Action[] => {
    const up = stepMove(novel, n.id, -1);
    const down = stepMove(novel, n.id, 1);
    const chapterOf = n.role === "piece" ? n.parent : n.role === "inner" ? n.id : null;
    const child = childLevel(n.kind);
    // Where it can move to: a piece to another section that holds pieces, a section to another of the level above.
    const moveTo = n.role === "piece" ? inner : n.kind !== novel.levels[0] ? parentLevel(n.kind)?.key : undefined;
    return [
      ...(n.role !== "outer" ? [{ label: "Open", run: () => open(n) }] : []),
      { label: "Rename…", keys: "F2", run: () => setDialog({ kind: "rename", id: n.id, title: titleOf(n) }) },
      ...(chapterOf ? [{ label: `New ${piece.key} ${n.role === "piece" ? "after this" : "at the start"}`, run: () => setDialog({ kind: "new-scene", chapter: chapterOf, after: n.role === "piece" ? n.id : null }) }] : []),
      ...(n.role === "outer" && child ? [{ label: `New ${child.key} at the start`, run: () => setDialog({ kind: "new-section", level: child, parent: n.id, after: null }) }] : []),
      ...(n.role !== "piece" ? [{ label: `New ${n.kind} after this`, run: () => setDialog({ kind: "new-section", level: levelOf(n.kind)!, parent: n.parent, after: n.id }) }] : []),
      "separator",
      { label: "Move up", keys: "Alt+↑", disabled: !up, run: () => void structure.step(n.id, -1) },
      { label: "Move down", keys: "Alt+↓", disabled: !down, run: () => void structure.step(n.id, 1) },
      ...(moveTo ? [{ label: `Move to ${moveTo}…`, run: () => setDialog({ kind: "move", id: n.id }) }] : []),
      ...(n.role === "piece" && n.pos < n.size ? [{ label: `Merge with the next ${piece.key}`, run: () => void structure.merge(n.id) }] : []),
      "separator",
      { label: "Delete", keys: "Del", danger: true, run: () => void structure.remove(n.id) },
    ];
  };
  const itemClass = "flex cursor-pointer items-center justify-between gap-6 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent-soft data-[disabled]:opacity-50";
  const menuClass = "z-50 min-w-52 rounded-md border border-rule bg-raised p-1 text-ink shadow-lg";

  const menu = (n: TreeNode) => (
    // Inside the page's main area, so the menu sits within a landmark.
    <ContextMenu.Portal container={document.getElementById("main")}>
      <ContextMenu.Content className={menuClass}>
        {actions(n).map((a, i) =>
          a === "separator" ? (
            <ContextMenu.Separator key={i} className="my-1 h-px bg-rule" />
          ) : (
            <ContextMenu.Item key={a.label} className={cn(itemClass, a.danger && "text-danger")} disabled={a.disabled ?? false} onSelect={a.run}>
              {a.label} {a.keys && <kbd className="text-xs text-muted">{a.keys}</kbd>}
            </ContextMenu.Item>
          ),
        )}
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );

  const currentChapter = novel.allPieces.find((s) => s.id === current)?.sectionId ?? (novel.allSections.some((c) => c.id === current && c.level === inner) ? current : novel.sections.find((c) => c.level === inner)?.id);
  const currentNode = all.find((n) => n.id === current);
  /** The open chapter's section at a level: itself, or what it's in (its part). */
  const currentAt = (level: string): string | undefined => {
    let s = sectionById(novel, currentChapter);
    while (s && s.level !== level) s = sectionById(novel, s.parentId);
    return s?.id;
  };
  /** Where "New <level>" puts a section: in the open chapter's section of the level above (or the first), after its own. */
  const newSection = (level: LevelDef): Dialog => {
    const above = parentLevel(level.key);
    const parent = level.key === novel.levels[0] || !above ? null : (currentAt(above.key) ?? novel.sections.find((s) => s.level === above.key)?.id ?? null);
    const after = currentAt(level.key) ?? (level.key === inner ? null : (novel.sections.filter((s) => s.level === level.key).at(-1)?.id ?? null));
    return { kind: "new-section", level, parent, after };
  };
  /** Levels the book uses, innermost first, as the New menu lists them; one that needs a section above it that isn't there yet can't be added. */
  const usable = [...novel.levels].reverse().map((key) => {
    const level = levelOf(key)!;
    const above = parentLevel(key);
    return { level, disabled: key !== novel.levels[0] && !!above && !novel.sections.some((s) => s.level === above.key) };
  });
  // The toolbar's ⋯ acts on the item last focused in the tree, or the open one.
  const target = all.find((n) => n.id === focused) ?? currentNode;
  useCommands((): Command[] => {
    const here = currentNode;
    return [
      ...(currentChapter ? [{ id: "tree.newScene", title: `New ${piece.key}`, group: "Manuscript", run: () => setDialog({ kind: "new-scene", chapter: currentChapter, ...(here?.role === "piece" ? { after: here.id } : {}) }) }] : []),
      ...usable.map(({ level }) => ({ id: level.key === inner ? "tree.newChapter" : `tree.new.${level.key}`, title: `New ${level.key}`, group: "Manuscript", run: () => setDialog(newSection(level)) })),
      ...novel.sections
        .filter((s) => s.level !== inner)
        .flatMap((s): Command[] => [
          { id: `tree.rename.${s.id}`, title: `Rename ${s.level} “${s.title ?? ""}”…`, group: "Manuscript", run: () => setDialog({ kind: "rename", id: s.id, title: s.title ?? "" }) },
          { id: `tree.delete.${s.id}`, title: `Delete ${s.level} “${s.title ?? ""}”`, group: "Manuscript", run: () => void structure.remove(s.id) },
        ]),
      { id: "tree.deleted", title: "Recently deleted", group: "Manuscript", run: () => setDialog({ kind: "deleted" }) },
      ...(here
        ? [
            { id: "tree.rename", title: `Rename ${here.kind}…`, group: "Manuscript", keys: "F2", run: () => setDialog({ kind: "rename", id: here.id, title: titleOf(here) }) },
            { id: "tree.up", title: `Move ${here.kind} up`, group: "Manuscript", keys: "Alt-ArrowUp", run: () => void structure.step(here.id, -1) },
            { id: "tree.down", title: `Move ${here.kind} down`, group: "Manuscript", keys: "Alt-ArrowDown", run: () => void structure.step(here.id, 1) },
            ...(here.role === "piece" ? [{ id: "tree.moveTo", title: `Move ${piece.key} to ${inner}…`, group: "Manuscript", run: () => setDialog({ kind: "move", id: here.id }) }] : []),
            ...(here.role === "piece" && here.pos < here.size ? [{ id: "tree.merge", title: `Merge ${piece.key} with the next`, group: "Manuscript", run: () => void structure.merge(here.id) }] : []),
            { id: "tree.delete", title: `Delete ${here.kind}`, group: "Manuscript", keys: "Delete", run: () => void structure.remove(here.id) },
          ]
        : []),
    ];
  }, [currentNode, currentChapter, novel, structure]);

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Manuscript actions">
        {/* New scene, chapter or part, after where the caret is: one menu, not a row of buttons. */}
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <Button size="sm" variant="ghost">
              <Plus className="size-4" aria-hidden /> New <ChevronDown className="size-3.5 text-muted" aria-hidden />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal container={document.getElementById("main")}>
            <DropdownMenu.Content align="start" className={menuClass}>
              <DropdownMenu.Item
                className={cn(itemClass, "justify-start gap-2")}
                disabled={!currentChapter}
                onSelect={() => currentChapter && setDialog({ kind: "new-scene", chapter: currentChapter, ...(current && novel.allPieces.some((s) => s.id === current) ? { after: current } : {}) })}
              >
                <FilePlus className="size-4" aria-hidden /> {piece.label}
              </DropdownMenu.Item>
              {usable.map(({ level, disabled }) => {
                const Icon = level.key === inner ? FolderPlus : Layers;
                return (
                  <DropdownMenu.Item key={level.key} className={cn(itemClass, "justify-start gap-2")} disabled={disabled} onSelect={() => setDialog(newSection(level))}>
                    <Icon className="size-4" aria-hidden /> {level.label}
                  </DropdownMenu.Item>
                );
              })}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "deleted" })} aria-label="Recently deleted" title="Recently deleted">
          <History className="size-4" aria-hidden />
        </Button>
        {target && (
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
              <Button size="sm" variant="ghost" aria-label={`Actions for “${target.title}”`} title={`Actions for “${target.title}”`}>
                <Ellipsis className="size-4" aria-hidden />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal container={document.getElementById("main")}>
              <DropdownMenu.Content align="end" className={menuClass}>
                <DropdownMenu.Label className="px-2 py-1 text-xs font-semibold text-muted">{target.title}</DropdownMenu.Label>
                {actions(target).map((a, i) =>
                  a === "separator" ? (
                    <DropdownMenu.Separator key={i} className="my-1 h-px bg-rule" />
                  ) : (
                    <DropdownMenu.Item key={a.label} className={cn(itemClass, a.danger && "text-danger")} disabled={a.disabled ?? false} onSelect={a.run}>
                      {a.label} {a.keys && <kbd className="text-xs text-muted">{a.keys}</kbd>}
                    </DropdownMenu.Item>
                  ),
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>
      <div role="tree" aria-label="Manuscript" ref={tree} onKeyDown={onKey} className="grid gap-px text-sm" onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrop(undefined)}>
        {visible.map((n) => (
          <ContextMenu.Root key={n.id} modal={false}>
            <ContextMenu.Trigger asChild>
              <div
                role="treeitem"
                data-id={n.id}
                aria-level={n.level}
                aria-posinset={n.pos}
                aria-setsize={n.size}
                aria-expanded={n.hasChildren ? !collapsed.has(n.id) : undefined}
                aria-selected={n.id === current}
                aria-label={`${n.title}, ${number.format(n.words)} words`}
                tabIndex={n.id === active ? 0 : -1}
                draggable
                onDragStart={(e) => {
                  dragging.current = n.id;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", n.title);
                }}
                onDragOver={(e) => onDragOver(e, n)}
                onDrop={onDrop}
                onDragEnd={() => {
                  dragging.current = undefined;
                  setDrop(undefined);
                }}
                onFocus={() => setFocused(n.id)}
                onClick={() => open(n)}
                style={{ paddingLeft: `${(n.level - 1) * 0.875 + 0.25}rem` }}
                className={cn(
                  "relative flex cursor-pointer items-center gap-1 rounded-md py-1 pr-2 outline-none hover:bg-paper focus-visible:outline-2 focus-visible:outline-accent",
                  n.id === current && "bg-accent-soft font-medium",
                  n.role === "outer" && "mt-2 text-xs font-semibold tracking-wide text-muted uppercase",
                  n.role === "piece" && "text-muted",
                  n.id === current && n.role === "piece" && "text-ink",
                  drop?.id === n.id && drop.at === "inside" && "ring-2 ring-accent",
                  drop?.id === n.id && drop.at === "before" && "before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:bg-accent",
                  drop?.id === n.id && drop.at === "after" && "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-accent",
                )}
              >
                {n.hasChildren ? (
                  <span
                    aria-hidden
                    className="flex size-4 shrink-0 items-center justify-center text-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(n.id);
                    }}
                  >
                    {collapsed.has(n.id) ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                  </span>
                ) : (
                  <span className="size-4 shrink-0" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate">{n.title}</span>
                {n.role !== "outer" && (
                  <span className="text-xs text-muted tabular-nums" aria-hidden>
                    {number.format(n.words)}
                  </span>
                )}
              </div>
            </ContextMenu.Trigger>
            {menu(n)}
          </ContextMenu.Root>
        ))}
      </div>

      {dialog?.kind === "rename" && (
        <TitleDialog
          title={`Rename ${itemOf(novel, dialog.id)?.kind ?? "it"}`}
          initial={dialog.title}
          required={titleRequired(novel, dialog.id)}
          action="Rename"
          submit={(title) => structure.rename(dialog.id, title)}
          onClose={() => {
            setDialog(undefined);
            focusNode(dialog.id);
          }}
        />
      )}
      {dialog?.kind === "new-scene" && <TitleDialog title={`New ${piece.key}`} action={`Add ${piece.key}`} submit={(title) => structure.createScene(dialog.chapter, title, dialog.after)} onClose={() => setDialog(undefined)} />}
      {dialog?.kind === "new-section" && (
        <TitleDialog
          title={`New ${dialog.level.key}`}
          {...(dialog.level.titled ? {} : { label: "Title (optional)", required: false })}
          action={`Add ${dialog.level.key}`}
          submit={(title) => structure.createSection(dialog.level.key, dialog.parent, title || undefined, dialog.after)}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === "move" && <MoveToDialog novel={novel} id={dialog.id} structure={structure} onClose={() => setDialog(undefined)} />}
      {dialog?.kind === "deleted" && <RecentlyDeletedDialog novelId={novelId} structure={structure} onClose={() => setDialog(undefined)} />}
    </div>
  );
}

/** Whether renaming an item needs a title: a piece's, and a section's whose level is `titled` (a part's, not a chapter's). */
function titleRequired(novel: Book, id: string): boolean {
  const section = sectionById(novel, id);
  return !section || !!novel.kind.levels.find((l) => l.key === section.level)?.titled;
}

/**
 * The tree with its structural actions, for the workspace's sidebar. `current` is the open chapter
 * or scene. Memoised, and given that rather than reading the address itself, so a change to a
 * view's query (a filter, a threshold) doesn't re-render a long book's tree.
 */
export const ManuscriptSidebar = memo(function ManuscriptSidebar({
  novelId,
  novel,
  workspace,
  current,
}: {
  novelId: string;
  novel: Book;
  workspace: Workspace;
  current: string | undefined;
}) {
  const structure = useStructure(novelId, novel, workspace);
  return <ManuscriptTree novelId={novelId} novel={novel} structure={structure} current={current} />;
});
