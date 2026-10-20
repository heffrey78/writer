import { readFrontMatter, vocabulary, type Book, type Entity, type Piece } from "@writer/core";
import { joinSceneFile } from "@writer/editor";
import { AddButton, PencilButton, ProfileSection, TextEditor, useInPlace } from "@writer/web/bible/profile.tsx";
import { sceneLink, Tallied } from "@writer/web/bible/type-sections.tsx";
import type { Workspace } from "@writer/web/novel/workspace.ts";
import { cn } from "@writer/web/ui/cn.ts";
import { useMemo } from "react";
import { plotlineProfile, PLOTLINES } from "../core/index.ts";

/** A plotline's beats on its profile (heffrey78/gh-writer#161): in reading order, each written in place, with the scenes it skips, where it goes quiet, and who's in it where. */
export function Beats({ novelId, novel, entity, workspace }: { novelId: string; novel: Book; entity: Entity; workspace: Workspace }) {
  const p = useMemo(() => plotlineProfile(novel, entity.id), [novel, entity.id]);
  const w = vocabulary(novel.kind);
  const place = useInPlace();
  const title = (id: string) => novel.allPieces.find((s) => s.id === id)?.title ?? id;

  /** Write a beat into its scene's front matter: a bare ID becomes a map holding it. */
  const writeBeat = async (scene: Piece, index: number, beat: string) => {
    await workspace.open([scene.file]);
    const file = workspace.store.getState().files[scene.file];
    const item = file ? (readFrontMatter(joinSceneFile({ ...file, body: "" }))?.[PLOTLINES.key] as unknown[] | undefined)?.[index] : undefined;
    const edits =
      typeof item === "string"
        ? [{ path: [PLOTLINES.key, index], value: { id: item, ...(beat ? { beat } : {}) } }]
        : [beat ? { path: [PLOTLINES.key, index, "beat"], value: beat } : { path: [PLOTLINES.key, index, "beat"], remove: true as const }];
    await workspace.editFrontMatter(scene.file, edits);
  };

  return (
    <ProfileSection title="Beats">
      {p.beats.length === 0 ? (
        <p className="text-sm text-muted">
          No {w.piece.one} has a beat of {entity.name} yet.
        </p>
      ) : (
        <ol className="grid gap-1.5 text-sm">
          {p.beats.map((b) => {
            const part = `beat:${b.scene.id}`;
            return (
              <li key={b.scene.id} className="group grid grid-cols-[1.25rem_minmax(0,10rem)_minmax(0,1fr)] items-baseline gap-x-2">
                <span
                  title={b.weight === "major" ? "A major beat" : "A minor beat"}
                  className={cn("size-2.5 translate-y-[-1px] self-center justify-self-center rounded-full border-2 border-accent", b.weight === "major" ? "bg-accent" : "bg-transparent")}
                />
                <span className="truncate">
                  {sceneLink(novelId, b.scene)}
                  <span className="sr-only">, {b.weight === "major" ? "a major beat" : "a minor beat"}</span>
                </span>
                {place.editing === part ? (
                  <TextEditor place={place} label={`Beat in “${b.scene.title}”`} value={b.beat ?? ""} onSave={(v) => writeBeat(b.scene, b.index, v)} />
                ) : b.beat ? (
                  <span className="flex items-baseline gap-1">
                    <span className="flex-1">{b.beat}</span>
                    <PencilButton place={place} part={part} label={`the beat in “${b.scene.title}”`} />
                  </span>
                ) : (
                  <AddButton place={place} part={part}>
                    Write the beat <span className="sr-only">in “{b.scene.title}”</span>
                  </AddButton>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <ul className="grid list-disc gap-1 pl-5 text-sm">
        {p.skips.length > 0 && (
          <li>
            Skips {p.skips.length === 1 ? `one ${w.piece.one}` : w.piece.count(p.skips.length)} between its first beat and its last:{" "}
            {p.skips.map((s, i) => (
              <span key={s.id}>
                {i > 0 && ", "}
                {sceneLink(novelId, s)}
              </span>
            ))}
            .
          </li>
        )}
        {p.quiet.map((q) => (
          <li key={q.from}>
            Quiet for {q.scenes} scenes, “{title(q.from)}” to “{title(q.to)}”{q.open ? ", to the end of the book" : ""}.
          </li>
        ))}
      </ul>
      {p.who.length > 0 && (
        <div className="grid gap-1 text-sm">
          <h3 className="text-[13px] text-muted">Who's in it</h3>
          <Tallied novelId={novelId} tally={p.who} unit={w.piece} />
        </div>
      )}
      {p.where.length > 0 && (
        <div className="grid gap-1 text-sm">
          <h3 className="text-[13px] text-muted">Where it happens</h3>
          <Tallied novelId={novelId} tally={p.where} unit={w.piece} />
        </div>
      )}
    </ProfileSection>
  );
}

