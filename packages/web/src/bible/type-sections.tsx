import { entryPresence, locationProfile, themeProfile, vocabulary, type Entity, type Book, type Piece, type Tally, type Word } from "@writer/core";
import { Fragment, useMemo } from "react";
import { Link } from "react-router";
import { moduleProfileSections } from "../modules.tsx";
import type { Workspace } from "../novel/workspace.ts";
import { cn } from "../ui/cn.ts";
import { ProfileSection } from "./profile.tsx";
import { StripHeader, StripRow } from "./strip.tsx";

/*
 * The parts of a profile shaped by its type (heffrey78/gh-writer#161): who comes to a location and when, a theme's
 * strength scene by scene, and a module's type's sections (a plotline's beats). A character's are its
 * strip and arcs, shared with every type.
 */

export const LINK = "text-accent underline decoration-accent/35 underline-offset-[3px] hover:decoration-accent";

export function TypeSections({ novelId, novel, entity, workspace }: { novelId: string; novel: Book; entity: Entity; workspace: Workspace }) {
  if (entity.type === "location") return <LocationSection novelId={novelId} novel={novel} entity={entity} />;
  if (entity.type === "theme") return <ThemeSection novel={novel} entity={entity} />;
  // A type a module brings has its sections from the module (a plotline's beats).
  const sections = moduleProfileSections(novel.kind, entity.type);
  return sections.length ? <>{sections.map((s, i) => <Fragment key={i}>{s.render({ novelId, novel, workspace, entity })}</Fragment>)}</> : null;
}

/** "Ada Varn (4), Ben Varn (4)", each a link to the entry. */
export function Tallied({ novelId, tally, unit }: { novelId: string; tally: Tally[]; unit: Word }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {tally.map((t) => (
        <li key={t.id}>
          <Link to={`/novels/${novelId}/bible/${t.id}`} className={LINK}>
            {t.name}
          </Link>{" "}
          <span className="text-muted">
            ({unit.count(t.scenes)})
          </span>
        </li>
      ))}
    </ul>
  );
}

export const sceneLink = (novelId: string, scene: Piece) => (
  <Link to={`/novels/${novelId}/scene/${scene.id}`} className={LINK}>
    {scene.title}
  </Link>
);

function LocationSection({ novelId, novel, entity }: { novelId: string; novel: Book; entity: Entity }) {
  const p = useMemo(() => locationProfile(novel, entity.id), [novel, entity.id]);
  const w = vocabulary(novel.kind);
  return (
    <ProfileSection title="Who comes here">
      {p.visitors.length ? <Tallied novelId={novelId} tally={p.visitors} unit={w.piece} /> : <p className="text-sm text-muted">No one yet: no {w.piece.one} set here has characters.</p>}
      {p.span && <p className="text-sm">Story time: {p.span.from === p.span.to ? p.span.from : `${p.span.from} to ${p.span.to}`}.</p>}
    </ProfileSection>
  );
}

const STRENGTH = ["not there", "faint", "present", "strong"] as const;

function ThemeSection({ novel, entity }: { novel: Book; entity: Entity }) {
  const p = useMemo(() => themeProfile(novel, entity.id), [novel, entity.id]);
  const presence = useMemo(() => entryPresence(novel, entity.id), [novel, entity.id]);
  const n = p.strengths.length;
  const w = vocabulary(novel.kind);
  if (!presence || n === 0) return null;
  return (
    <ProfileSection title={`Strength, ${w.piece.one} by ${w.piece.one}`}>
      <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-end gap-x-3 gap-y-1.5">
        <StripHeader presence={presence} />
        <StripRow label="Strength" columns={n} className="h-12 items-end">
          <ol aria-label={`Strength in each ${w.piece.one}, in reading order`} className="contents">
            {p.strengths.map(({ scene, strength, note }) => {
              const said = `${scene.title}: ${STRENGTH[strength]}${strength ? ` (${strength})` : ""}${note ? `, ${note}` : ""}`;
              return (
                <li key={scene.id} title={said} className="contents">
                  <span className={cn("block rounded-t-[4px]", strength ? "bg-accent" : "bg-rule/60")} style={{ height: strength ? `${(strength / 3) * 100}%` : "2px" }}>
                    <span className="sr-only">{said}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </StripRow>
      </div>
    </ProfileSection>
  );
}
