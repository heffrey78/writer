import type { Piece } from "@writer/core";
import { getMarkdown } from "@writer/editor";
import { SceneEditor, type SceneEditorProps } from "@writer/editor/react";
import type { Editor } from "@tiptap/core";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useStore } from "zustand";
import { useCommands } from "../commands.ts";
import { Button } from "../ui/button.tsx";
import type { Workspace } from "./workspace.ts";

/**
 * A run of pieces the writing view writes (#64), in the order its caller gives, each in its own
 * editor: a journal's entries, newest first. It says nothing of the book's order, which stays as the
 * order files have it.
 */
export interface Run {
  /** Tells one run from another: the caret is put in `caret` once for each. */
  key: string;
  heading: string;
  /** Beside the heading: the run's own controls (Reading). */
  controls?: ReactNode;
  pieces: readonly Piece[];
  /** Over a piece's text: its title, its date. `body` is its text as it stands. */
  header(piece: Piece, body: string): ReactNode;
  /** A piece's text before its editor is made (off screen), and while reading. */
  preview(piece: Piece, body: string): ReactNode;
  /** Text only: no editors. */
  reading?: boolean;
  /** The button that shows more of the run: "Earlier entries". */
  more: string;
  /** Shown when there's nothing in the run. */
  empty?: ReactNode;
  /** The piece the caret goes to, at its end, as the run opens. */
  caret?: string;
}

/** What the writing view gives a piece's editor: its tools, with the editor they act on. */
export type RunTools = Omit<SceneEditorProps, "markdown" | "onChange" | "label" | "sceneId" | "onReady" | "autofocus">;

/** How many pieces show at first, and how many more each time the writer reaches the end. */
const BATCH = 10;

interface Props {
  run: Run;
  workspace: Workspace;
  /** A piece's editor's accessible name. */
  label: (piece: Piece) => string;
  /** The writing view's tools for a piece's editor, given how to reach that editor. */
  tools: (piece: Piece, editor: () => Editor | undefined) => RunTools;
  /** An editor took the caret: the writing view's commands and panels follow it. */
  onFocus: (editor: Editor, piece: Piece) => void;
  /** Words for the commands that move between pieces: "entry". */
  piece: string;
}

/** The run's pieces, a batch at a time; each piece's editor is made as it comes near the screen. */
export function RunPieces({ run, workspace, label, tools, onFocus, piece: noun }: Props) {
  const [shown, setShown] = useState(BATCH);
  const [want, setWant] = useState<{ id: string; at: "start" | "end" }>();
  const active = useRef<string | undefined>(undefined);
  const end = useRef<HTMLDivElement>(null);
  const more = shown < run.pieces.length;
  const pieces = run.pieces.slice(0, shown);

  // The caret where the run's caller asks, once for each run.
  const placed = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!run.caret || placed.current === run.key || run.reading) return;
    const at = run.pieces.findIndex((p) => p.id === run.caret);
    if (at < 0) return;
    placed.current = run.key;
    setShown((n) => Math.max(n, at + 1));
    setWant({ id: run.caret, at: "end" });
  }, [run.key, run.caret, run.pieces, run.reading]);

  useEffect(() => {
    const at = end.current;
    if (!at || !more || typeof IntersectionObserver === "undefined") return;
    const seen = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setShown((n) => n + BATCH), { rootMargin: "400px" });
    seen.observe(at);
    return () => seen.disconnect();
  }, [more, shown]);

  /** The caret to the piece `by` places on from the one it's in, at its start going on and its end going back. */
  const step = (by: 1 | -1, from = active.current) => {
    const at = run.pieces.findIndex((p) => p.id === from);
    const to = run.pieces[at < 0 ? 0 : at + by];
    if (!to) return false;
    setShown((n) => Math.max(n, run.pieces.indexOf(to) + 1));
    setWant({ id: to.id, at: by > 0 ? "start" : "end" });
    return true;
  };
  useCommands(
    () =>
      run.reading
        ? []
        : [
            { id: "writing.nextInRun", title: `Go to the next ${noun}`, group: "Writing", keys: "Alt-PageDown", run: () => void step(1) },
            { id: "writing.previousInRun", title: `Go to the previous ${noun}`, group: "Writing", keys: "Alt-PageUp", run: () => void step(-1) },
          ],
    [run, noun],
  );

  if (run.pieces.length === 0) return <>{run.empty}</>;
  return (
    <>
      <ol aria-label={run.heading} className="grid gap-10">
        {pieces.map((piece) => (
          <li key={piece.id}>
            <RunPiece
              piece={piece}
              run={run}
              workspace={workspace}
              label={label(piece)}
              tools={tools}
              want={want?.id === piece.id ? want.at : undefined}
              onWanted={() => setWant(undefined)}
              onFocus={(editor) => {
                active.current = piece.id;
                onFocus(editor, piece);
              }}
              onStep={(by) => step(by, piece.id)}
            />
          </li>
        ))}
      </ol>
      {more && (
        <div ref={end} className="flex justify-center">
          <Button onClick={() => setShown((n) => n + BATCH)}>{run.more}</Button>
        </div>
      )}
    </>
  );
}

interface PieceProps {
  piece: Piece;
  run: Run;
  workspace: Workspace;
  label: string;
  tools: Props["tools"];
  /** The caret is asked for here, at the start or the end. */
  want: "start" | "end" | undefined;
  onWanted: () => void;
  onFocus: (editor: Editor) => void;
  /** Off the end or the start of the text by arrow: on to the next piece or back to the one before. */
  onStep: (by: 1 | -1) => boolean;
}

/** One piece of a run: its header, then its text, as a preview until it comes near the screen and as an editor from then on. */
function RunPiece({ piece, run, workspace, label, tools, want, onWanted, onFocus, onStep }: PieceProps) {
  const at = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [editor, setEditor] = useState<Editor>();
  const file = useStore(workspace.store, (s) => s.files[piece.file]);
  const body = file?.body ?? piece.body;
  const writing = !run.reading && (near || want !== undefined);

  useEffect(() => {
    const el = at.current;
    if (near || run.reading || !el) return;
    // Without an observer (an old webview), every piece shown is written in.
    if (typeof IntersectionObserver === "undefined") return setNear(true);
    const seen = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setNear(true), { rootMargin: "600px" });
    seen.observe(el);
    return () => seen.disconnect();
  }, [near, run.reading]);

  useEffect(() => {
    if (writing) void workspace.open([piece.file]);
    else setEditor(undefined);
  }, [writing, workspace, piece.file]);

  // Let the workspace see text typed but not reported yet, so a change on disk never replaces it.
  useEffect(() => {
    if (!editor) return;
    return workspace.live(piece.file, () => (editor.isDestroyed ? undefined : getMarkdown(editor)));
  }, [editor, workspace, piece.file]);

  const latest = useRef({ onFocus });
  latest.current = { onFocus };
  useEffect(() => {
    if (!editor) return;
    const focused = () => latest.current.onFocus(editor);
    if (editor.isFocused) focused();
    editor.on("focus", focused);
    return () => void editor.off("focus", focused);
  }, [editor]);

  useEffect(() => {
    if (!want) return;
    if (!editor || editor.isDestroyed) {
      at.current?.scrollIntoView({ block: "nearest" });
      return;
    }
    editor.commands.focus(want);
    onWanted();
  }, [want, editor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arrow keys off the text's last line go on to the next piece; off its first, back to the one before.
  const onKeyDown = (e: KeyboardEvent) => {
    if (!editor || editor.isDestroyed || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const { doc, selection } = editor.state;
    const down = e.key === "ArrowDown" && selection.empty && selection.$head.index(0) === doc.childCount - 1 && editor.view.endOfTextblock("down");
    const up = e.key === "ArrowUp" && selection.empty && selection.$head.index(0) === 0 && editor.view.endOfTextblock("up");
    if ((down || up) && onStep(down ? 1 : -1)) e.preventDefault();
  };

  return (
    <article ref={at} aria-label={piece.title} className="grid gap-2">
      {run.header(piece, body)}
      {writing && file ? (
        <div onKeyDown={onKeyDown}>
          <SceneEditor
            key={piece.file}
            label={label}
            sceneId={piece.file}
            markdown={file.body}
            onChange={(md) => workspace.change(piece.file, md)}
            onReady={setEditor}
            {...tools(piece, () => editor)}
          />
        </div>
      ) : (
        run.preview(piece, body)
      )}
    </article>
  );
}
