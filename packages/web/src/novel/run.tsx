import type { Piece } from "@writer/core";
import { getMarkdown } from "@writer/editor";
import { SceneEditor, type SceneEditorProps } from "@writer/editor/react";
import type { Editor } from "@tiptap/core";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useStore } from "zustand";
import { useCommands } from "../commands.ts";
import { Button } from "../ui/button.tsx";
import { useNotice } from "./notice.tsx";
import type { Workspace } from "./workspace.ts";

/**
 * A run of pieces the writing view writes (#64), in the order its caller gives, each in its own
 * editor: a journal's entries, newest first. It says nothing of the book's order, which stays as the
 * order files have it.
 */
export interface Run {
  /** Tells one run from another. */
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
  /** Shown when there's nothing in the run, and nothing to begin. */
  empty?: ReactNode;
  /** A place at the top of the run to begin a new piece in: today's entry. */
  begin?: Begin;
  /**
   * Where the caret goes, at the end: a piece's ID, or BEGIN for the place to begin one. Once for each
   * `asked`: the navigation that asked for it (Today's entry, again).
   */
  caret?: { to: string; asked: string };
}

/**
 * The place a new piece begins (#64): an empty editor, and the piece made by the caller on its first
 * words. Typing goes on in the same editor meanwhile, and once the piece is in the run, the editor is
 * its own. Nothing typed, nothing made.
 */
export interface Begin {
  /** Its editor's name, and its prompt: "Write today's entry". */
  label: string;
  /** Over it, as a piece's header is. */
  header: ReactNode;
  /**
   * Make the piece: its ID, as soon as it's made and before the run has it (the book reloaded after),
   * so the place knows the piece as its own when it arrives.
   */
  make(): Promise<string>;
  /**
   * Where the words typed are kept in the tab's session storage until the piece's file has them, as
   * autosave keeps unsaved text: a reload or a crash before then finds them there, and makes the piece.
   */
  keep: string;
}

/** `caret` for the place to begin a piece. */
export const BEGIN = "begin";

/** What the writing view gives a piece's editor: its tools, with the editor they act on. */
export type RunTools = Omit<SceneEditorProps, "markdown" | "onChange" | "label" | "sceneId" | "onReady" | "autofocus">;

/** How many pieces show at first, and how many more each time the writer reaches the end. */
const BATCH = 10;

interface Props {
  run: Run;
  workspace: Workspace;
  /** A piece's editor's accessible name. */
  label: (piece: Piece) => string;
  /** The writing view's tools for a piece's editor (none yet in the place to begin one), given how to reach that editor. */
  tools: (piece: Piece | undefined, editor: () => Editor | undefined) => RunTools;
  /** An editor took the caret: the writing view's commands and panels follow it. */
  onFocus: (editor: Editor, piece: Piece | undefined) => void;
  /** Words for the commands that move between pieces: "entry". */
  piece: string;
}

/** The run's pieces, a batch at a time; each piece's editor is made as it comes near the screen. */
export function RunPieces({ run, workspace, label, tools, onFocus, piece: noun }: Props) {
  const [shown, setShown] = useState(BATCH);
  const [want, setWant] = useState<{ key: string; at: "start" | "end" }>();
  // The piece made in the place to begin one: it keeps the place's key, so React keeps its editor.
  const [begun, setBegun] = useState<string>();
  const active = useRef<string | undefined>(undefined);
  const end = useRef<HTMLDivElement>(null);
  const notify = useNotice((s) => s.show);
  const items: { key: string; piece?: Piece }[] = [
    ...(run.begin && !run.reading && !run.pieces.some((p) => p.id === begun) ? [{ key: BEGIN }] : []),
    ...run.pieces.map((piece) => ({ key: piece.id === begun ? BEGIN : piece.id, piece })),
  ];
  const more = shown < items.length;

  // The caret where the run's caller asks, once each time it asks.
  const placed = useRef<string | undefined>(undefined);
  useEffect(() => {
    const caret = run.caret;
    if (!caret || placed.current === caret.asked || run.reading) return;
    const at = items.findIndex((i) => i.key === caret.to || i.piece?.id === caret.to);
    if (at < 0) return;
    placed.current = caret.asked;
    setShown((n) => Math.max(n, at + 1));
    setWant({ key: items[at]!.key, at: "end" });
  }, [run.caret?.to, run.caret?.asked, run.pieces, run.reading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const at = end.current;
    if (!at || !more || typeof IntersectionObserver === "undefined") return;
    const seen = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setShown((n) => n + BATCH), { rootMargin: "400px" });
    seen.observe(at);
    return () => seen.disconnect();
  }, [more, shown]);

  /** The caret to the piece `by` places on from the one it's in, at its start going on and its end going back. */
  const step = (by: 1 | -1, from = active.current) => {
    const at = items.findIndex((i) => i.key === from);
    const to = at < 0 ? 0 : at + by;
    const item = items[to];
    if (!item) return false;
    setShown((n) => Math.max(n, to + 1));
    setWant({ key: item.key, at: by > 0 ? "start" : "end" });
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
    [run, noun, begun],
  );

  if (items.length === 0) return <>{run.empty}</>;
  return (
    <>
      <ol aria-label={run.heading} className="grid gap-10">
        {items.slice(0, shown).map(({ key, piece }) => (
          <li key={key}>
            <RunPiece
              piece={piece}
              began={key === BEGIN}
              run={run}
              workspace={workspace}
              label={piece ? label(piece) : (run.begin?.label ?? "")}
              tools={tools}
              want={want?.key === key ? want.at : undefined}
              onWanted={() => setWant(undefined)}
              onFocus={(editor) => {
                active.current = key;
                onFocus(editor, piece);
              }}
              onStep={(by) => step(by, key)}
              onMade={setBegun}
              onFailed={(e) => notify({ message: `Couldn't start the ${noun}: ${e instanceof Error ? e.message : String(e)}. Your words are kept here: type on to try again.` })}
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
  /** None yet in the place to begin one. */
  piece: Piece | undefined;
  /** It's the place to begin a piece, or the piece made there. */
  began: boolean;
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
  onMade: (id: string) => void;
  onFailed: (e: unknown) => void;
}

/**
 * One piece of a run: its header, then its text, as a preview until it comes near the screen and as
 * an editor from then on. Or the place to begin one, whose editor becomes the piece's once it's made.
 */
function RunPiece({ piece, began, run, workspace, label, tools, want, onWanted, onFocus, onStep, onMade, onFailed }: PieceProps) {
  const at = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [editor, setEditor] = useState<Editor>();
  const path = piece?.file;
  const file = useStore(workspace.store, (s) => (path ? s.files[path] : undefined));
  const body = file?.body ?? piece?.body ?? "";
  const writing = !run.reading && (near || want !== undefined || began);
  // In the place to begin a piece: the text last reported, which is the editor's until its piece's
  // file is open and has it (bound); and whether the piece is being made.
  const [kept] = useState(() => (began && !piece && run.begin ? stored(run.begin.keep) : undefined));
  const typed = useRef(kept ?? "");
  const making = useRef(false);
  const [bound, setBound] = useState(!began);
  // The same, at once: words reported between binding and the render after it go to the file.
  const boundNow = useRef(!began);
  const keep = useRef(run.begin?.keep);
  // Its editor keeps the place's name once its piece is made: changing the text box under the writer
  // (its attributes) restarts Android's keyboard mid-word.
  const [placeName] = useState(label);

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
    if (!writing) setEditor(undefined);
    else if (path) void workspace.open([path]);
  }, [writing, workspace, path]);

  // The piece made where it began: its file has the words typed so far once it's open.
  useEffect(() => {
    if (bound || !path) return;
    let gone = false;
    void workspace.open([path]).then(() => {
      if (gone) return;
      const f = workspace.store.getState().files[path];
      if (f && f.body !== typed.current) workspace.change(path, typed.current);
      if (keep.current) store(keep.current, undefined);
      boundNow.current = true;
      setBound(true);
    });
    return () => void (gone = true);
  }, [bound, path, workspace]);

  // Let the workspace see text typed but not reported yet, so a change on disk never replaces it.
  useEffect(() => {
    if (!editor || !path || !bound) return;
    return workspace.live(path, () => (editor.isDestroyed ? undefined : getMarkdown(editor)));
  }, [editor, workspace, path, bound]);

  const latest = useRef({ onFocus });
  latest.current = { onFocus };
  // Again once the piece begun here is made, for the panels to show it.
  useEffect(() => {
    if (!editor) return;
    const focused = () => latest.current.onFocus(editor);
    if (editor.isFocused) focused();
    editor.on("focus", focused);
    return () => void editor.off("focus", focused);
  }, [editor, piece?.id]);

  useEffect(() => {
    if (!want) return;
    // Asked for, it's written in from now on, as one that has come near the screen is.
    setNear(true);
    if (!editor || editor.isDestroyed) {
      at.current?.scrollIntoView({ block: "nearest" });
      return;
    }
    editor.commands.focus(want);
    onWanted();
  }, [want, editor]); // eslint-disable-line react-hooks/exhaustive-deps

  const make = () => {
    if (path || making.current || !run.begin) return;
    making.current = true;
    run.begin.make().then(onMade, (e: unknown) => {
      making.current = false;
      onFailed(e);
    });
  };
  const onChange = (md: string) => {
    typed.current = md;
    if (path && boundNow.current) return workspace.change(path, md);
    if (keep.current) store(keep.current, md);
    make();
  };
  // Made at the first keystroke, not the first pause: the place is the piece's as soon as it can be.
  useEffect(() => {
    if (!editor || path) return;
    const first = () => !editor.isEmpty && make();
    editor.on("update", first);
    return () => void editor.off("update", first);
  }, [editor, path]); // eslint-disable-line react-hooks/exhaustive-deps
  // Words kept from before a reload or a crash: the piece is made for them at once.
  useEffect(() => {
    if (kept) make();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Arrow keys off the text's last line go on to the next piece, off its first back to the one
  // before; Alt+PageDown and Alt+PageUp from anywhere in it.
  const onKeyDown = (e: KeyboardEvent) => {
    // Not a key the editor took (the @ menu's arrows): measuring the line moves the caret in the page.
    if (!editor || editor.isDestroyed || e.defaultPrevented || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.altKey) {
      if ((e.key === "PageDown" || e.key === "PageUp") && onStep(e.key === "PageDown" ? 1 : -1)) e.preventDefault();
      return;
    }
    const { doc, selection } = editor.state;
    const down = e.key === "ArrowDown" && selection.empty && selection.$head.index(0) === doc.childCount - 1 && editor.view.endOfTextblock("down");
    const up = e.key === "ArrowUp" && selection.empty && selection.$head.index(0) === 0 && editor.view.endOfTextblock("up");
    if ((down || up) && onStep(down ? 1 : -1)) e.preventDefault();
  };

  return (
    <article ref={at} aria-label={piece?.title ?? label} className="grid gap-2">
      {piece ? run.header(piece, body) : run.begin?.header}
      {writing && (file || began) ? (
        <div onKeyDown={onKeyDown}>
          <SceneEditor
            key={began ? BEGIN : path}
            label={began ? placeName : label}
            {...(began ? { placeholder: `${placeName}…` } : {})}
            sceneId={path ?? BEGIN}
            markdown={file && bound ? file.body : typed.current}
            onChange={onChange}
            onReady={setEditor}
            {...tools(piece, () => editor)}
          />
        </div>
      ) : (
        piece && run.preview(piece, body)
      )}
    </article>
  );
}

/** The words kept for a place to begin a piece, if any. */
function stored(key: string): string | undefined {
  try {
    return sessionStorage.getItem(key) || undefined;
  } catch {
    return undefined; // blocked by the browser's privacy settings
  }
}

function store(key: string, words: string | undefined): void {
  try {
    if (words) sessionStorage.setItem(key, words);
    else sessionStorage.removeItem(key);
  } catch {
    // Storage full or blocked: the editor still holds the words.
  }
}
