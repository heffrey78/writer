import { carryingField, entryPresence, roleOf, vocabulary, type BookKind, type Entity, type EntryPresence, type Book, type PresenceMark, type Vocabulary } from "@writer/core";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "../ui/cn.ts";
import { ProfileSection } from "./profile.tsx";

/*
 * In the story (heffrey78/gh-writer#159): every scene in reading order, under its part and chapter names, marking where
 * an entry carries the scene, is in it, or is only mentioned. The relationships' arcs (heffrey78/gh-writer#160) draw
 * over the same columns, so both are laid out by StripRow.
 */

/**
 * What each mark means for an entry of a type, as read aloud and in the legend: as its field's marks
 * say ("a major beat", "set here"), or the carrier's role where it carries the piece ("point of view").
 */
export function markWords(kind: BookKind, type: string, w: Vocabulary): Record<Exclude<PresenceMark, "absent">, string | undefined> {
  const field = kind.fields.find((f) => "entityType" in f.type && f.type.entityType === type && f.marks);
  const carrying = carryingField(kind);
  const carrier = carrying && "entityType" in carrying.type && carrying.type.entityType === type ? roleOf(carrying) : undefined;
  return { carries: field?.marks?.carries ?? carrier, present: field?.marks?.present ?? `in the ${w.piece.one}`, mentioned: "mentioned" };
}

const CELL: Record<PresenceMark, string> = {
  carries: "bg-accent",
  present: "bg-accent/40",
  // Only named in the prose: an outline, so it isn't told apart by colour alone.
  mentioned: "border-2 border-accent/60 bg-transparent",
  absent: "bg-rule/60",
};

/** A row laid out on the strip's columns: a label on the left, then one column per scene. */
export function StripRow({
  label,
  columns,
  children,
  className,
  style,
  decorative,
}: {
  label?: ReactNode;
  columns: number;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Hidden from screen readers (what it shows is said elsewhere). */
  decorative?: boolean;
}) {
  return (
    <>
      <div className="min-w-0 truncate text-[13px] text-muted">{label}</div>
      <div aria-hidden={decorative || undefined} className={cn("grid gap-[3px]", className)} style={{ gridTemplateColumns: `repeat(${Math.max(columns, 1)}, minmax(0, 1fr))`, ...style }}>
        {children}
      </div>
    </>
  );
}

/** The part and chapter names over the strip's columns. */
export function StripHeader({ presence }: { presence: EntryPresence }) {
  const n = presence.scenes.length;
  /** Each group's first column (1-based), from the spans before it. */
  const placed = <T extends { span: number }>(groups: T[]) => groups.map((g, i) => ({ ...g, start: 1 + groups.slice(0, i).reduce((a, x) => a + x.span, 0) }));
  const parts = placed(presence.parts.map((p) => ({ title: p.part.title, span: p.span })));
  const chapters = placed(presence.chapters.map((c) => ({ title: c.title, span: c.span })));
  return (
    <StripRow columns={n} className="text-[11px] text-muted" decorative>
      {parts.map((p) => (
        <span key={`p${p.start}`} title={p.title} style={{ gridColumn: `${p.start} / span ${p.span}` }} className="truncate border-b border-rule pb-0.5 font-semibold tracking-wide uppercase">
          {p.title}
        </span>
      ))}
      {chapters.map((c) => (
        <span key={`c${c.start}`} title={c.title} style={{ gridColumn: `${c.start} / span ${c.span}`, gridRow: parts.length ? 2 : 1 }} className="truncate">
          {c.title}
        </span>
      ))}
    </StripRow>
  );
}

/** Where an entry is across the book, and the facts that follow from it. */
export function InTheStory({ novelId, novel, entity, compact }: { novelId: string; novel: Book; entity: Entity; compact?: boolean }) {
  const presence = useMemo(() => entryPresence(novel, entity.id), [novel, entity.id]);
  if (!presence) return null;
  const w = vocabulary(novel.kind);
  const words = markWords(novel.kind, entity.type, w);
  const said = (mark: PresenceMark) => (mark === "absent" ? "not there" : words[mark] ?? words.present);
  const n = presence.scenes.length;

  return (
    <ProfileSection title="In the story">
      {n === 0 ? (
        <p className="text-sm text-muted">The book has no {w.piece.many} yet.</p>
      ) : (
        <div className={cn("grid items-center gap-x-3 gap-y-1.5", compact ? "grid-cols-[3.5rem_minmax(0,1fr)]" : "grid-cols-[6.5rem_minmax(0,1fr)]")}>
          <StripHeader presence={presence} />
          <StripRow label={w.piece.Many} columns={n}>
            <ol aria-label={`${w.piece.Many}, in reading order`} className="contents">
              {presence.scenes.map(({ scene, mark }) => {
                const name = `${scene.title}: ${said(mark)}`;
                const cell = cn("block h-4 rounded-sm", CELL[mark]);
                return (
                  <li key={scene.id} className="contents">
                    {mark === "absent" ? (
                      <span title={name} className={cell}>
                        <span className="sr-only">{name}</span>
                      </span>
                    ) : (
                      <Link to={`/novels/${novelId}/scene/${scene.id}`} title={name} aria-label={name} className={cn(cell, "hover:ring-2 hover:ring-ink/40 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none")} />
                    )}
                  </li>
                );
              })}
            </ol>
          </StripRow>
          <span />
          <ul aria-label="Key" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {(["carries", "present", "mentioned", "absent"] as const)
              .filter((m) => m === "absent" || words[m])
              .map((m) => (
                <li key={m} className="inline-flex items-center gap-1.5">
                  <span className={cn("size-2.5 rounded-[2px]", CELL[m])} aria-hidden />
                  {m === "absent" ? "Not there" : words[m]![0]!.toUpperCase() + words[m]!.slice(1)}
                </li>
              ))}
          </ul>
        </div>
      )}
      <ul className="grid list-disc gap-1 pl-5 text-sm">
        {presence.count === 0 ? (
          <li>
            Not in the story yet: no {w.piece.one} lists or mentions {entity.name}.
          </li>
        ) : (
          <li>
            In {presence.count === n ? `all ${n}` : `${presence.count} of ${n}`} {n === 1 ? w.piece.one : w.piece.many}
            {presence.first && presence.last && presence.first !== presence.last ? `, from “${presence.first.title}” to “${presence.last.title}”` : presence.first ? `: “${presence.first.title}”` : ""}
            {words.carries && presence.carries > 0 ? `; ${words.carries} in ${presence.carries}` : ""}.
          </li>
        )}
        {presence.longestAbsence && (
          <li>
            Longest absence: {w.piece.count(presence.longestAbsence.scenes)}
            {presence.longestAbsence.scenes === 1 ? ` (“${presence.longestAbsence.from.title}”)` : `, “${presence.longestAbsence.from.title}” to “${presence.longestAbsence.to.title}”`}.
          </li>
        )}
        {presence.events.length > 0 && (
          <li>
            Off the page:{" "}
            {presence.events.map((e, i) => (
              <span key={e.id}>
                {i > 0 && ", "}
                <Link to={`/novels/${novelId}/event/${e.id}`} className="text-accent underline decoration-accent/35 underline-offset-[3px] hover:decoration-accent">
                  {e.title}
                </Link>
              </span>
            ))}
            .
          </li>
        )}
      </ul>
    </ProfileSection>
  );
}
