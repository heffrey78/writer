import { imageUrl } from "@writer/client";
import { insertPicture, pictureAt, setPicture, type PictureCallbacks } from "@writer/editor";
import type { Editor } from "@tiptap/core";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { PictureInTextDialog, type PictureRequest } from "./picture-in-text.tsx";

export interface Pictures {
  /** Where a picture in the text loads from: the server's images route. */
  pictureUrl: (path: string) => string | undefined;
  /** The editor's callbacks for pictures dropped, pasted, changed or replaced, in the editor `get` gives. */
  picturesFor: (get: () => Editor | undefined) => PictureCallbacks;
  /** Ask for a new picture to put in `editor` at its caret: Add a picture, Insert a picture… in the palette. */
  ask: (editor: Editor | undefined, file?: File) => void;
  /** The dialog, while one is asked about. */
  dialog: ReactNode;
}

/**
 * The picture flow of the writing view and a note's page (heffrey78/gh-writer#203, #200): a picture
 * to add (dropped, pasted, from a button or the palette) or change (Enter, a double-click, the
 * picture's toolbar) is asked about in a dialog, saved in images/ and put in, or changed, in the
 * editor it came from.
 */
export function usePictures(novelId: string): Pictures {
  const pictureUrl = useCallback((path: string) => imageUrl(novelId, path), [novelId]);
  const [request, setRequest] = useState<PictureRequest>();
  // The editor the picture goes in: in a run, the one it was dropped on or asked for in.
  const pictureIn = useRef<Editor>(undefined);
  const picturesFor = (get: () => Editor | undefined): PictureCallbacks => {
    const edit = (at: number, change: boolean) => {
      const editor = get();
      const picture = editor && !editor.isDestroyed ? pictureAt(editor, at) : undefined;
      pictureIn.current = editor;
      if (picture) setRequest({ kind: "edit", at, picture, ...(change ? { change } : {}) });
    };
    return {
      add: (files, at) => {
        pictureIn.current = get();
        setRequest({ kind: "add", at, ...(files[0] ? { file: files[0] } : {}) });
      },
      edit: (at) => edit(at, false),
      change: (at) => edit(at, true),
    };
  };
  const ask = (editor: Editor | undefined, file?: File) => {
    if (!editor || editor.isDestroyed) return;
    pictureIn.current = editor;
    setRequest({ kind: "add", at: editor.state.selection.from, ...(file ? { file } : {}) });
  };
  const dialog = request && (
    <PictureInTextDialog
      novelId={novelId}
      request={request}
      pictureUrl={pictureUrl}
      onDone={(picture) => {
        setRequest(undefined);
        // Once the dialog has closed and given the text its focus back.
        requestAnimationFrame(() => {
          const editor = pictureIn.current;
          if (!editor || editor.isDestroyed) return;
          if (request.kind === "add") insertPicture(editor, picture, request.at);
          else setPicture(editor, request.at, picture);
        });
      }}
      onClose={() => setRequest(undefined)}
    />
  );
  return { pictureUrl, picturesFor, ask, dialog };
}
