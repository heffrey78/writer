import { plural, vocabulary, word, type Book } from "@writer/core";
import type { OperationResult } from "@writer/client";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { api, keys } from "@writer/web/api.ts";
import { AddButton, EditorButtons, EditorFrame, PencilButton, useInPlace, type InPlace } from "@writer/web/bible/profile.tsx";
import { storyDate } from "@writer/web/format.ts";
import { useNotice } from "@writer/web/novel/notice.tsx";
import { Button } from "@writer/web/ui/button.tsx";
import { Picker } from "@writer/web/ui/picker.tsx";
import { apartInTime, dayOneFor, storyTimeline, timedTypes, timeOf } from "../core/index.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What's placed in story time, as "scene or event" (one) and "scenes and events" (many): the pieces, and other modules' records. */
function things(novel: Book): { one: string; many: string } {
  const piece = vocabulary(novel.kind).piece;
  const shorts = timedTypes(novel.kind).map((t) => t.noun.short ?? t.noun.label);
  return { one: [piece.one, ...shorts.map((s) => word({ label: s, plural: plural(s) }).one)].join(" or "), many: [piece.many, ...shorts.map((s) => word({ label: s, plural: plural(s) }).many)].join(" and ") };
}

/** 2026-10-10 as "10 Oct 2026", as story time shows dates. */
export const readDate = storyDate;

/** Say when Day 1 is (null: it has no date): one commit, then the book reloaded. */
export function useSetDayOne(novelId: string) {
  const queryClient = useQueryClient();
  return async (start: string | null) => {
    await api.module<OperationResult>(novelId, "story-time", "PUT", "calendar", { start });
    await queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
  };
}

/**
 * When Day 1 is (heffrey78/gh-writer#239): a date, so days of the story sit among dates (Day 0 the day before), edited in
 * place from a date or the day of a dated scene (its date copied, once). While it has none and the
 * book has both, the days that can't be placed among the dates are counted here.
 */
export function DayOne({ novelId, novel }: { novelId: string; novel: Book }) {
  const start = novel.config?.calendar?.start;
  const place = useInPlace();
  const apart = useMemo(() => apartInTime(storyTimeline(novel)), [novel]);
  return (
    <section aria-label="When Day 1 is" className="grid gap-1.5 text-sm">
      {place.editing === "day1" ? (
        <DayOneEditor novelId={novelId} novel={novel} place={place} />
      ) : start ? (
        <div className="group flex items-center gap-1">
          <span>
            Day 1 is <span className="font-medium">{readDate(start)}</span>
          </span>
          <PencilButton place={place} part="day1" label="when Day 1 is" />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted">Day 1 has no date.</span>
          <AddButton place={place} part="day1">
            Say when Day 1 is
          </AddButton>
        </div>
      )}
      {!start && apart.length > 0 && (
        <p className="rounded-md border border-warn/40 bg-warn-soft px-3 py-2">
          {apart.length === 1 ? `1 ${things(novel).one} is on a numbered day` : `${apart.length} ${things(novel).many} are on numbered days`}, not a date: until Day 1 has one, {apart.length === 1 ? "it can't" : "they can't"} be placed among the dated ones, and {apart.length === 1 ? "comes" : "come"} after them.
        </p>
      )}
    </section>
  );
}

/** Day 1's date typed, or a dated scene's taken, or none; saved on leaving it too. */
function DayOneEditor({ novelId, novel, place }: { novelId: string; novel: Book; place: InPlace }) {
  const start = novel.config?.calendar?.start;
  const setDayOne = useSetDayOne(novelId);
  const dated = novel.pieces.flatMap((s) => {
    const { when } = timeOf(s);
    return when && "at" in when ? [{ scene: s, at: when.at }] : [];
  });
  const id = useId();
  const [draft, setDraft] = useState(start ?? "");
  const [problem, setProblem] = useState<string>();
  const run = async (to: string | null) => {
    try {
      if (to !== (start ?? null)) await setDayOne(to);
      place.done();
      return true;
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      return false;
    }
  };
  const save = async () => {
    const v = draft.trim();
    if (!v) return run(null);
    if (!DATE.test(v)) return (setProblem("A date, like 2026-10-10."), false);
    return run(v);
  };

  return (
    <EditorFrame place={place} save={save} className="max-w-xl">
      <label htmlFor={id} className="text-xs font-medium">
        Day 1 is
      </label>
      <input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          }
        }}
        placeholder="YYYY-MM-DD"
        aria-invalid={problem ? true : undefined}
        aria-describedby={`${id}-note`}
        className="h-8 w-48 rounded-md border border-rule bg-raised px-2 text-sm aria-invalid:border-danger"
      />
      <p id={`${id}-note`} className={problem ? "text-xs text-danger" : "text-xs text-muted"}>
        {problem ?? "Day 0 is the day before, Day -1 the day before that."}
      </p>
      {dated.length > 0 && (
        <Picker
          label={`Or the day of ${vocabulary(novel.kind).piece.a}`}
          items={dated.map(({ scene, at }) => ({ value: scene.id, label: `${scene.title} (${readDate(at.slice(0, 10))})` }))}
          value={undefined}
          onChange={(v) => {
            const chosen = dated.find((d) => d.scene.id === v);
            if (chosen) void run(chosen.at.slice(0, 10));
          }}
          placeholder={`Choose a dated ${vocabulary(novel.kind).piece.one}…`}
          className="max-w-sm"
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <EditorButtons onSave={() => void save()} onCancel={() => place.done()} hint="Enter saves · Esc cancels" />
        {start && (
          <Button size="sm" variant="ghost" onClick={() => void run(null)}>
            No date
          </Button>
        )}
      </div>
    </EditorFrame>
  );
}

/**
 * Under a story-time editor, once a day of the story has become a date while Day 1 has none: "This was
 * Day 3: make 12 Oct 2026 Day 3, so Day 1 is 10 Oct 2026?" Once, in place (heffrey78/gh-writer#239).
 */
export function DateDayOne({ novelId, novel, day, date, done }: { novelId: string; novel: Book; day: number; date: string; done: () => void }) {
  const setDayOne = useSetDayOne(novelId);
  const show = useNotice((s) => s.show);
  if (novel.config?.calendar?.start) return null;
  const start = dayOneFor(date, day);
  return (
    <div role="group" aria-label="Date Day 1 from this" className="grid gap-1.5 rounded-md border border-rule bg-raised p-2 text-sm">
      <p>
        This was Day {day}. Make {readDate(date)} Day {day}, so Day 1 is {readDate(start)}? Every day of the story then has its date.
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={() =>
            void setDayOne(start)
              .then(() => show({ message: `Day 1 is ${readDate(start)}.` }))
              .catch((e: unknown) => show({ message: `Couldn't date Day 1: ${e instanceof Error ? e.message : String(e)}` }))
              .finally(done)
          }
        >
          Make it Day {day}
        </Button>
        <Button size="sm" variant="ghost" onClick={done}>
          No
        </Button>
      </div>
    </div>
  );
}
