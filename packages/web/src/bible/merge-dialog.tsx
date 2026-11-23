import { entityLabel, entityOfLabel, mergeReach, vocabulary, type Book, type Entity } from "@writer/core";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { create } from "zustand";
import { api, keys } from "../api.ts";
import { useGitHubRepo } from "../github/repo.ts";
import { useIssueList } from "../issues/use-issues.ts";
import { useNotice } from "../novel/notice.tsx";
import { Button } from "../ui/button.tsx";
import { Modal } from "../ui/dialog.tsx";

/*
 * Merge (#137, #173): two entries of a type that are one, made one. Asked from Tidy up's Might be the
 * same (either of the two kept) or from an entry's profile (Merge into…, another of its type). It says
 * first what it will change; then every reference moves to the one kept, in one commit undone as one.
 * On GitHub, the open issues with the merged entry's label get the kept one's instead.
 */

export const useMergeDialog = create<{ asked: { other: string; keep?: string } | undefined; open: (other: string, keep?: string) => void; close: () => void }>((set) => ({
  asked: undefined,
  open: (other, keep) => set({ asked: { other, ...(keep ? { keep } : {}) } }),
  close: () => set({ asked: undefined }),
}));

export function MergeDialog({ novelId, novel }: { novelId: string; novel: Book }) {
  const asked = useMergeDialog((s) => s.asked);
  if (!asked) return null;
  const first = novel.entities.find((e) => e.id === asked.other);
  if (!first) return null;
  return <Merging key={`${asked.other}|${asked.keep ?? ""}`} novelId={novelId} novel={novel} first={first} second={asked.keep ? novel.entities.find((e) => e.id === asked.keep) : undefined} />;
}

function Merging({ novelId, novel, first, second }: { novelId: string; novel: Book; first: Entity; second: Entity | undefined }) {
  const w = vocabulary(novel.kind);
  const close = useMergeDialog((s) => s.close);
  const queryClient = useQueryClient();
  const show = useNotice((n) => n.show);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const repo = useGitHubRepo(novelId);
  const issues = useIssueList(novelId, { state: "open" }, { enabled: !!repo }).data;
  const ids = { keep: useId(), into: useId() };
  const type = novel.entityTypes.find((t) => t.key === first.type);
  const others = novel.entities.filter((e) => e.type === first.type && e.id !== first.id).sort((a, b) => a.name.localeCompare(b.name));
  // A pair from Tidy up: either kept (the first, as listed). From a profile: the entry goes into one chosen.
  const [keepId, setKeepId] = useState(second ? second.id : (others[0]?.id ?? ""));
  const [pairKeep, setPairKeep] = useState<"first" | "second">("second");
  const keep = second ? (pairKeep === "second" ? second : first) : novel.entities.find((e) => e.id === keepId);
  const other = second ? (pairKeep === "second" ? first : second) : first;
  const [problem, setProblem] = useState<string>();
  const [saving, setSaving] = useState(false);
  const reach = keep && mergeReach(novel, keep, other);
  const label = issues?.labels.find((l) => entityOfLabel(novel, l)?.id === other.id);
  const labelled = label ? (issues?.issues ?? []).filter((i) => i.labels.includes(label.name)) : [];

  const merge = async () => {
    if (!keep) return;
    setSaving(true);
    setProblem(undefined);
    try {
      const [k, o] = await Promise.all([api.readFile(novelId, keep.file), api.readFile(novelId, other.file)]);
      const done = await api.bible.mergeEntries(novelId, other.id, keep.id, { keep: k.hash, other: o.hash });
      // Its issues keep their place: the kept entry's label on each, in place of the merged one's.
      if (label && labelled.length) {
        const kept = entityLabel(novel, keep).name;
        await Promise.all(labelled.map((i) => api.issues.update(novelId, i.number, { labels: [...new Set(i.labels.map((l) => (l === label.name ? kept : l)))] }))).catch(() => undefined);
      }
      await queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
      close();
      if (pathname.includes(`/bible/${other.id}`)) void navigate(`/novels/${novelId}/bible/${keep.id}`, { replace: true });
      if (done.commit) {
        const commit = done.commit;
        show({
          message: `Merged ${other.name} into ${keep.name}.`,
          action: {
            label: "Undo",
            run: () => void api.bible.undo(novelId, commit, done.files).then(() => queryClient.invalidateQueries({ queryKey: keys.novel(novelId) }), () => show({ message: "Something has changed since, so it wasn't undone." })),
          },
        });
      }
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const lines = reach
    ? [
        reach.pieces && `Mentions and lists in ${w.piece.count(reach.pieces)}`,
        reach.entries && `Fields of ${count(reach.entries, w.entity.one, w.entity.many)}`,
        reach.records && count(reach.records, "record"),
        reach.relationships && count(reach.relationships, "relationship"),
        reach.notes && count(reach.notes, "note"),
        labelled.length && `The label on ${count(labelled.length, "open issue")} on GitHub`,
      ].filter(Boolean)
    : [];

  return (
    <Modal title={second ? `Merge ${first.name} and ${second.name}` : `Merge ${first.name} into…`} onClose={close} className="w-[min(32rem,calc(100vw-2rem))]">
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void merge();
        }}
      >
        {second ? (
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-sm font-medium">Keep</legend>
            {(["second", "first"] as const).map((which) => {
              const e = which === "second" ? second : first;
              return (
                <label key={which} className="flex items-center gap-2 text-sm">
                  <input type="radio" name={ids.keep} checked={pairKeep === which} onChange={() => setPairKeep(which)} />
                  {e.name}
                </label>
              );
            })}
          </fieldset>
        ) : others.length ? (
          <label htmlFor={ids.into} className="grid gap-1 text-sm font-medium">
            Into
            <select
              id={ids.into}
              value={keepId}
              onChange={(e) => setKeepId(e.target.value)}
              // Enter merges, as in a field: a list doesn't submit its form by itself.
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                void merge();
              }}
              autoFocus className="h-9 rounded-md border border-rule bg-raised px-2 font-normal">
              {others.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-sm text-muted">There's no other {type?.label.toLowerCase() ?? w.entity.one} to merge it into.</p>
        )}
        {keep && (
          <div className="grid gap-2 text-sm">
            <p>
              <b>{other.name}</b> goes. Everything that names it names <b>{keep.name}</b> instead, and {keep.name} takes its names as other names, its tags, the fields it lacks and its notes, under “From {other.name}”.
            </p>
            {lines.length > 0 ? (
              <>
                <p className="text-muted">It changes:</p>
                <ul className="list-disc pl-5">
                  {lines.map((l) => (
                    <li key={String(l)}>{l}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-muted">Nothing else names {other.name}.</p>
            )}
            <p className="text-muted">One change, undone as one.</p>
          </div>
        )}
        {problem && (
          <p role="alert" className="text-sm text-danger">
            {problem}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!keep || saving}>
            {keep ? `Merge into ${keep.name}` : "Merge"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
