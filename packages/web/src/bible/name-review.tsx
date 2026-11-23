import { vocabulary, type Book } from "@writer/core";
import { linkName, passageRange } from "@writer/editor";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { requestPassage } from "../novel/go-to-passage.ts";
import { useCommands } from "../commands.ts";
import type { Workspace } from "../novel/workspace.ts";
import { useWritingEditor } from "../novel/writing-view.tsx";
import { Button } from "../ui/button.tsx";
import { linkPassage } from "./link-passage.ts";
import { judgementOf, useNotAName } from "./not-names.ts";
import { useNameReview } from "./tidy-state.ts";

/*
 * Review one by one (#137, #172): an entry's names not linked, from Tidy up, stepped through in the
 * writing view. Each opens with its sentence selected; Link it makes it a mention there (as Alt+Enter
 * does), Not a name here keeps that it isn't, Skip goes on. The bar says where the review is.
 */
export function NameReviewBar({ novelId, novel, workspace }: { novelId: string; novel: Book; workspace: Workspace }) {
  const review = useNameReview((s) => s.review);
  const navigate = useNavigate();
  const notAName = useNotAName(novelId, novel);
  const active = review?.novelId === novelId ? review : undefined;
  const entry = active && novel.entities.find((e) => e.id === active.entry);
  const passage = active?.passages[active.at];

  const stop = () => useNameReview.setState({ review: undefined });
  const go = (at: number) => {
    if (!active) return;
    if (at >= active.passages.length || at < 0) return stop();
    useNameReview.setState({ review: { ...active, at } });
    const to = requestPassage(novelId, active.passages[at]!);
    if (to) void navigate(to);
  };
  const link = async () => {
    if (!active || !passage) return;
    const editor = useWritingEditor.getState().editor;
    const range = editor && !editor.isDestroyed ? passageRange(editor.state.doc, passage.piece.file, passage.block) : undefined;
    if (editor && range) linkName(editor, range[0], range[1], active.entry);
    else await linkPassage(workspace, novel, passage, active.entry);
    go(active.at + 1);
  };
  const notHere = async () => {
    if (!active || !passage) return;
    const j = judgementOf(passage, active.entry);
    if (j) await notAName(j, passage.text.slice(...passage.at));
    go(active.at + 1);
  };
  // The review ends with the book it's of.
  useEffect(() => {
    if (active && !entry) stop();
  }, [active, entry]);

  useCommands(
    () =>
      active && entry
        ? [
            { id: "review.link", title: `Review: link this ${entry.name}`, group: "Review", run: () => void link() },
            { id: "review.notAName", title: "Review: not a name here", group: "Review", run: () => void notHere() },
            { id: "review.skip", title: "Review: skip to the next", group: "Review", run: () => go(active.at + 1) },
            { id: "review.stop", title: "Review: stop", group: "Review", run: stop },
          ]
        : [],
    [active, entry],
  );

  if (!active || !entry || !passage) return null;
  const w = vocabulary(novel.kind);
  return (
    <div role="region" aria-label="Review names not linked" className="flex flex-wrap items-center gap-2 border-b border-warn/40 bg-warn-soft px-4 py-1.5 text-sm">
      <span aria-live="polite" className="min-w-0 flex-1">
        {entry.name}, not linked: <b className="tabular-nums">{active.at + 1}</b> of {active.passages.length}, in “{passage.piece.title}”
      </span>
      <Button size="sm" variant="primary" onClick={() => void link()}>
        Link it
      </Button>
      {judgementOf(passage, active.entry) && (
        <Button size="sm" onClick={() => void notHere()}>
          Not a name here
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => go(active.at + 1)}>
        Skip
      </Button>
      <Button size="sm" variant="ghost" onClick={stop} aria-label={`Stop reviewing ${entry.name}'s names in the ${w.content.one}`}>
        Done
      </Button>
    </div>
  );
}
