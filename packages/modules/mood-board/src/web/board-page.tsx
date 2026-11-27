import { useQueryClient } from "@tanstack/react-query";
import { shownPictures, vocabulary, type Book } from "@writer/core";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Handle,
  NodeResizer,
  NodeToolbar,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useReactFlow,
  useViewport,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api, keys } from "@writer/web/api.ts";
import { useCommands } from "@writer/web/commands.ts";
import { useNotice } from "@writer/web/novel/notice.tsx";
import { useTheme } from "@writer/web/theme.ts";
import { ErrorAlert } from "@writer/web/ui/alert.tsx";
import { Button } from "@writer/web/ui/button.tsx";
import { Confirm } from "@writer/web/ui/confirm.tsx";
import { PictureInTextDialog } from "@writer/web/novel/picture-in-text.tsx";
import { ImagePlus, Library, StickyNote } from "lucide-react";
import { create } from "zustand";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { addCard as putLine, ENTRY_SIZE, NOTE_SIZE, pictureSize, placeCard, readBoardText, reorderCard, takeOffCard, type Board, type BoardCard, type Pair } from "../core/index.ts";
import { CardFace, shown } from "./cards.tsx";
import { boards, changeBoard } from "./client.ts";
import { BoardNameDialog } from "./board-name.tsx";
import { droppedPicture, measure, PutOnBoard, putCards } from "./put-on-board.tsx";

/*
 * A mood board (#207): its cards where the writer put them, at the size they gave them, on a board with
 * no edges (pan, zoom, Fit all). A card is moved and resized by mouse; its toolbar opens what it shows,
 * brings it to the front or sends it to the back, and takes it off the board (which Undo puts back).
 * Each change is a save of the board's file that changes the card's own line. A note's pictures are
 * tethered to its card by a dashed line, faint until one of them is selected.
 */

/** A card by its place in the board's file. */
type CardData = { card: BoardCard; index: number };
type CardNode = Node<CardData, "card">;

const id = (index: number) => `card-${index}`;
const indexOf = (nodeId: string) => Number(nodeId.slice("card-".length));
const round = (n: number) => Math.round(n);

/** What a card on the board can do, given to its node. */
interface BoardActions {
  novelId: string;
  book: Book;
  cards: readonly (BoardCard | undefined)[];
  notesShown: ReadonlySet<string>;
  count: number;
  open(path: string): void;
  reorder(index: number, to: "front" | "back"): void;
  takeOff(index: number): void;
  resized(index: number, at: Pair, size: Pair): void;
}

const Actions = createContext<BoardActions | null>(null);

const CardView = memo(function CardView({ id: nodeId, data, selected }: NodeProps<CardNode>) {
  const actions = useContext(Actions)!;
  const { card, index } = data;
  const what = shown(actions.book, card);
  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={48}
        minHeight={36}
        color="var(--ghw-accent)"
        onResizeEnd={(_, p) => actions.resized(index, [round(p.x), round(p.y)], [round(p.width), round(p.height)])}
      />
      <NodeToolbar isVisible={selected} position={Position.Bottom} align="start">
        <div role="toolbar" aria-label="Card" className="flex gap-0.5 rounded-lg border border-rule bg-raised p-1 text-sm whitespace-nowrap text-ink shadow-md">
          {what.opens && (
            <Button size="sm" variant="ghost" onClick={() => actions.open(what.opens!.path)}>
              {what.opens.label}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={index === actions.count - 1} onClick={() => actions.reorder(index, "front")}>
            Bring to front
          </Button>
          <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => actions.reorder(index, "back")}>
            Send to back
          </Button>
          <Button size="sm" variant="ghost" onClick={() => actions.takeOff(index)}>
            Take off the board
          </Button>
        </div>
      </NodeToolbar>
      {/* Where a tether starts and ends: never shown, and never dragged from. */}
      <Handle type="source" position={Position.Right} isConnectable={false} className="!pointer-events-none !opacity-0" />
      <Handle type="target" position={Position.Left} isConnectable={false} className="!pointer-events-none !opacity-0" />
      <div className="size-full" data-card={nodeId} onDoubleClick={() => what.opens && actions.open(what.opens.path)}>
        <CardFace novelId={actions.novelId} book={actions.book} card={card} cards={actions.cards} notesShown={actions.notesShown} />
      </div>
    </>
  );
});

/** A note's tether to one of its pictures' cards: dashed, faint, strong while either is selected. */
function Tether({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<{ strong: boolean }>>) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const strong = data?.strong ?? false;
  return <BaseEdge path={path} style={{ stroke: "var(--ghw-accent)", strokeWidth: strong ? 2 : 1.5, strokeDasharray: "6 5", opacity: strong ? 1 : 0.35 }} />;
}

const nodeTypes = { card: CardView };
const edgeTypes = { tether: Tether };

function toNodes(cards: readonly (BoardCard | undefined)[], selected: ReadonlySet<string>, book: Book): CardNode[] {
  return cards.flatMap((card, index): CardNode[] =>
    card
      ? [{
          id: id(index),
          type: "card",
          position: { x: card.at[0], y: card.at[1] },
          width: card.size[0],
          height: card.size[1],
          // The file's order is front to back: a later card is drawn over an earlier one.
          zIndex: index,
          data: { card, index },
          selected: selected.has(id(index)),
          ariaLabel: shown(book, card).label,
          className: "!cursor-grab",
        }]
      : [],
  );
}

/**
 * What's being added to the board (#208): a picture (chosen, or a file dropped or pasted, at where it
 * was dropped), a note, or an entry. Without `at`, it goes in the middle of what's in view.
 */
type Adding = { kind: "picture"; file?: File; at?: Pair } | { kind: "note" } | { kind: "entry" };
const useAdding = create<{ adding: Adding | undefined; set: (a: Adding | undefined) => void }>((set) => ({ adding: undefined, set: (adding) => set({ adding }) }));

/** The board's middle, as it's in view, for a card of `size` to be centred on. */
function useMiddle() {
  const { screenToFlowPosition } = useReactFlow();
  return useCallback(
    (size: Pair): Pair => {
      const box = document.querySelector("[data-board]")?.getBoundingClientRect();
      if (!box) return [0, 0];
      const p = screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
      return [round(p.x - size[0] / 2), round(p.y - size[1] / 2)];
    },
    [screenToFlowPosition],
  );
}

function AddTools({ book }: { book: Book }) {
  const set = useAdding((s) => s.set);
  const codex = vocabulary(book.kind).codex;
  useCommands(
    () => [
      { id: "board.addPicture", title: "Add a picture to the board…", group: "Board", keywords: ["image", "photo", "map"], run: () => set({ kind: "picture" }) },
      { id: "board.addNote", title: "Add a note to the board…", group: "Board", keywords: ["card"], run: () => set({ kind: "note" }) },
      { id: "board.addEntry", title: `Add from the ${codex.one} to the board…`, group: "Board", keywords: ["entry", "card", codex.one], run: () => set({ kind: "entry" }) },
    ],
    [codex.one],
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" onClick={() => set({ kind: "picture" })}>
        <ImagePlus className="size-4" aria-hidden /> Add a picture
      </Button>
      <Button size="sm" onClick={() => set({ kind: "note" })}>
        <StickyNote className="size-4" aria-hidden /> Add a note
      </Button>
      <Button size="sm" onClick={() => set({ kind: "entry" })}>
        <Library className="size-4" aria-hidden /> Add from the {codex.one}
      </Button>
    </div>
  );
}

/** The dialog for what's being added, putting its cards on the board where they go. */
function AddDialogs({ novelId, book, board }: { novelId: string; book: Book; board: Board }) {
  const { adding, set } = useAdding();
  const middle = useMiddle();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string>();
  useEffect(() => () => set(undefined), [set]);
  const close = () => set(undefined);
  if (!adding) return error ? <ErrorAlert className="mx-4 mb-2" title="Couldn't put it on the board" detail={error} /> : null;
  if (adding.kind === "picture")
    return (
      <PictureInTextDialog
        novelId={novelId}
        request={{ kind: "add", at: 0, ...(adding.file ? { file: adding.file } : {}) }}
        pictureUrl={() => undefined}
        words={{ title: "Add a picture to the board", action: "Add" }}
        onClose={close}
        onDone={(picture, saved) => {
          close();
          const size = saved ? pictureSize(saved.width, saved.height) : pictureSize(0, 0);
          const at: Pair = adding.at ? [round(adding.at[0] - size[0] / 2), round(adding.at[1] - size[1] / 2)] : middle(size);
          const card: BoardCard = { kind: "picture", picture: picture.url.replace(/^\//, ""), description: picture.alt, at, size };
          putCards(novelId, board, () => [card]).then(
            () => queryClient.invalidateQueries({ queryKey: keys.novel(novelId) }),
            (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
          );
        }}
      />
    );
  return <PutOnBoard novelId={novelId} book={book} board={board} choose={adding.kind} at={middle(adding.kind === "note" ? NOTE_SIZE : ENTRY_SIZE)} onClose={close} />;
}

function Zoom() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();
  useCommands(() => [{ id: "board.fitAll", title: "Fit all the cards in view", group: "Board", keywords: ["zoom", "board"], run: () => void fitView({ padding: 0.1, duration: 200 }) }], [fitView]);
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="ghost" onClick={() => void fitView({ padding: 0.1, duration: 200 })}>
        Fit all
      </Button>
      <span className="flex items-center rounded-md border border-rule bg-raised">
        <button type="button" aria-label="Zoom out" onClick={() => void zoomOut({ duration: 150 })} className="size-8 rounded-l-md hover:bg-panel">
          −
        </button>
        <span aria-live="polite" aria-label={`Zoom ${Math.round(zoom * 100)}%`} className="min-w-11 text-center text-xs text-muted tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" aria-label="Zoom in" onClick={() => void zoomIn({ duration: 150 })} className="size-8 rounded-r-md hover:bg-panel">
          +
        </button>
      </span>
    </div>
  );
}

function Canvas({ novelId, book, board, text, setText }: { novelId: string; book: Book; board: Board; text: string; setText: (t: string) => void }) {
  const navigate = useNavigate();
  const theme = useTheme((s) => s.theme);
  const queryClient = useQueryClient();
  const show = useNotice((s) => s.show);
  const [error, setError] = useState<string>();
  const read = useMemo(() => readBoardText(text), [text]);
  const cards = useMemo(() => read?.cards ?? [], [read]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [nodes, setNodes] = useState<CardNode[]>(() => toNodes(cards, selected, book));
  // The cards as the file has them, whenever it changes (a save here, a sync, another device).
  useEffect(() => setNodes(toNodes(cards, selected, book)), [cards, book]); // eslint-disable-line react-hooks/exhaustive-deps

  // Changes are made one after another, each on the file as the last one left it.
  const queue = useRef(Promise.resolve());
  const change = useCallback(
    (edit: (t: string) => string, then?: (before: string, after: string) => void) => {
      queue.current = queue.current.then(async () => {
        try {
          let before = "";
          const after = await changeBoard(novelId, board.file, (t) => ((before = t), edit(t)));
          setText(after);
          setError(undefined);
          then?.(before, after);
          void queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    },
    [novelId, board.file, setText, queryClient],
  );

  const notesShown = useMemo(() => new Set(cards.flatMap((c) => (c?.kind === "note" ? [c.note] : []))), [cards]);
  const actions: BoardActions = useMemo(
    () => ({
      novelId,
      book,
      cards,
      notesShown,
      count: cards.length,
      open: (path) => navigate(`/novels/${novelId}/${path}`),
      reorder: (index, to) => {
        setSelected(new Set([id(to === "front" ? cards.length - 1 : 0)]));
        change((t) => reorderCard(t, index, to));
      },
      takeOff: (index) => {
        setSelected(new Set());
        const card = cards[index];
        change(
          (t) => takeOffCard(t, index),
          (before, after) => {
            const name = card ? shown(book, card).label : "The card";
            // Undo puts the file back as it was, unless it changed meanwhile: then the card goes back on top.
            show({
              message: `${name} is off the board.`,
              action: {
                label: "Undo",
                run: () => {
                  show(undefined);
                  change((t) => (t === after ? before : t));
                },
              },
            });
          },
        );
      },
      resized: (index, at, size) => change((t) => placeCard(t, index, { at, size })),
    }),
    [novelId, book, cards, notesShown, navigate, change, show],
  );

  const onDragStop: OnNodeDrag<CardNode> = useCallback(
    (_, __, dragged) => {
      const moved = dragged.map((n) => ({ index: indexOf(n.id), at: [round(n.position.x), round(n.position.y)] as Pair }));
      change((t) => moved.reduce((acc, m) => placeCard(acc, m.index, { at: m.at }), t));
    },
    [change],
  );

  const strong = (a: string, b: string) => selected.has(a) || selected.has(b);
  const edges: Edge<{ strong: boolean }>[] = useMemo(() => {
    const noteCard = new Map(cards.flatMap((c, i) => (c?.kind === "note" ? [[c.note, id(i)] as const] : [])));
    return cards.flatMap((c, i) => {
      if (c?.kind !== "note-picture") return [];
      const source = noteCard.get(c.note);
      return source ? [{ id: `tether-${source}-${i}`, source, target: id(i), type: "tether", data: { strong: strong(source, id(i)) }, selectable: false, focusable: false, zIndex: -1 }] : [];
    });
  }, [cards, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // A picture dropped or pasted on the board: a file is described first and saved as any picture; one
  // dragged out of a note is a card of that note's picture, where it was dropped.
  const { screenToFlowPosition } = useReactFlow();
  const add = useAdding((s) => s.set);
  const onDrop = (e: React.DragEvent) => {
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
    const url = e.dataTransfer.getData("text/uri-list").split("\n").find((l) => l && !l.startsWith("#")) || /<img[^>]+src="([^"]+)"/.exec(e.dataTransfer.getData("text/html"))?.[1];
    const picture = !file && url ? droppedPicture(novelId, url) : undefined;
    if (!file && !picture) return;
    e.preventDefault();
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    if (file) return add({ kind: "picture", file, at: [round(p.x), round(p.y)] });
    void measure(novelId, picture!).then((size) => {
      const notes = book.notes.filter((n) => shownPictures(n.body).some((s) => s.path === picture));
      const note = notes.find((n) => notesShown.has(n.id)) ?? notes[0];
      const at: Pair = [round(p.x - size[0] / 2), round(p.y - size[1] / 2)];
      const card: BoardCard = note ? { kind: "note-picture", note: note.id, picture: picture!, at, size } : { kind: "picture", picture: picture!, at, size };
      change((t) => (readBoardText(t) ? putLine(t, card) : t));
    });
  };
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true], [role=dialog]")) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      add({ kind: "picture", file });
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [add]);

  return (
    <Actions.Provider value={actions}>
      {error && <ErrorAlert className="mx-4 mb-2" title="The board couldn't be saved" detail={error} />}
      <div className="relative min-h-0 flex-1" role="region" data-board aria-label={`Board: ${board.title}, ${cards.filter(Boolean).length === 1 ? "1 card" : `${cards.filter(Boolean).length} cards`}`} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <ReactFlow<CardNode, Edge<{ strong: boolean }>>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={(changes) =>
            setNodes((ns) => {
              let next = ns;
              for (const c of changes) {
                if (c.type === "position" && c.position) next = next.map((n) => (n.id === c.id ? { ...n, position: c.position! } : n));
                if (c.type === "dimensions" && c.dimensions && c.resizing) next = next.map((n) => (n.id === c.id ? { ...n, width: c.dimensions!.width, height: c.dimensions!.height } : n));
                if (c.type === "select") {
                  setSelected((s) => {
                    const out = new Set(s);
                    if (c.selected) out.add(c.id);
                    else out.delete(c.id);
                    return out;
                  });
                  next = next.map((n) => (n.id === c.id ? { ...n, selected: c.selected } : n));
                }
              }
              return next;
            })
          }
          onNodeDragStop={onDragStop}
          onPaneClick={() => setSelected(new Set())}
          elevateNodesOnSelect={false}
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.1 }}
          minZoom={0.1}
          maxZoom={4}
          onlyRenderVisibleElements
          proOptions={{ hideAttribution: true }}
          colorMode={theme}
          deleteKeyCode={null}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} />
        </ReactFlow>
        {!cards.length && <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted">Nothing on this board yet. Add a picture, a note or an entry, or drop a picture here.</p>}
      </div>
    </Actions.Provider>
  );
}

/** A board's page: its title and the board's tools, then the board. */
export function BoardPage({ novelId, book, board }: { novelId: string; book: Book; board: Board }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [text, setText] = useState<string>();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  // The board's file as it is, read again when the book changes on disk (a save, a sync).
  const version = useMemo(() => JSON.stringify(book.moduleFiles.find((f) => f.file === board.file)?.data), [book, board.file]);
  useEffect(() => {
    let live = true;
    api.readFile(novelId, board.file).then(
      (f) => live && setText(f.content),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [novelId, board.file, version]);

  useCommands(
    () => [
      { id: "board.rename", title: `Rename the board “${board.title}”…`, group: "Board", keywords: ["board", "title"], run: () => setRenaming(true) },
      { id: "board.delete", title: `Delete the board “${board.title}”…`, group: "Board", keywords: ["board", "remove"], run: () => setDeleting(true) },
    ],
    [board.title],
  );

  return (
    <ReactFlowProvider>
    <div className="flex h-full min-h-[28rem] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <h1 className="text-xl font-semibold">{board.title}</h1>
        <AddTools book={book} />
        <span className="flex-1" />
        <Zoom />
      </div>
      {error && <ErrorAlert className="m-4" title="The board couldn't be opened" detail={error} />}
      {text !== undefined && <Canvas key={board.file} novelId={novelId} book={book} board={board} text={text} setText={setText} />}
      <AddDialogs novelId={novelId} book={book} board={board} />
      {renaming && (
        <BoardNameDialog
          title="Rename the board"
          action="Rename"
          initial={board.title}
          onClose={() => setRenaming(false)}
          onName={async (title) => {
            await boards.rename(novelId, board.id, title);
            await queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
          }}
        />
      )}
      <Confirm
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete “${board.title}”?`}
        description="The board goes, and so do pictures that nothing else shows. Its notes and entries stay in the book. You can find the board again in the book's history."
        action="Delete the board"
        danger
        onConfirm={() =>
          void boards.delete(novelId, board.id).then(
            async () => {
              await queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
              navigate(`/novels/${novelId}/boards`);
            },
            (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
          )
        }
      />
    </div>
    </ReactFlowProvider>
  );
}
