import { entryPresences, tidyCounts, tidyReport, type Book, type Passage, type TidyCounts } from "@writer/core";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { create } from "zustand";

/*
 * Tidy up's state outside its page (#172): the counts behind the sidebar's quiet dot, kept per book on
 * this device as they were when the page was last opened; and a review of an entry's names not linked,
 * one passage at a time, carried out in the writing view.
 */

const seenKey = (novelId: string) => `ghw:tidy-seen:${novelId}`;

function readSeen(novelId: string): TidyCounts | undefined {
  try {
    const raw = JSON.parse(localStorage.getItem(seenKey(novelId)) ?? "null") as TidyCounts | null;
    return raw && typeof raw === "object" ? raw : undefined;
  } catch {
    return undefined;
  }
}

const useSeen = create<Record<string, TidyCounts | undefined>>(() => ({}));

/** Tidy up was opened with these counts: the dot goes until one rises again. */
export function markTidySeen(novelId: string, counts: TidyCounts) {
  useSeen.setState({ [novelId]: counts });
  try {
    localStorage.setItem(seenKey(novelId), JSON.stringify(counts));
  } catch {
    // Not kept for next time.
  }
}

/** The book's Tidy up counts, worked out after a change settles (not in the way of typing). */
export function useTidyCounts(novel: Book): TidyCounts {
  const later = useDeferredValue(novel);
  return useMemo(() => tidyCounts(tidyReport(later, entryPresences(later))), [later]);
}

/**
 * Whether a count has risen since Tidy up was last opened on this device. The first time the book is
 * seen, what's there then is the starting point: an index never tidied isn't flagged for its history.
 */
export function useTidyRose(novelId: string, novel: Book): boolean {
  const counts = useTidyCounts(novel);
  const seen = useSeen((s) => s[novelId]) ?? readSeen(novelId);
  const [rose, setRose] = useState(false);
  useEffect(() => {
    if (!seen) return markTidySeen(novelId, counts);
    setRose((Object.keys(counts) as (keyof TidyCounts)[]).some((k) => counts[k] > (seen[k] ?? 0)));
  }, [novelId, counts, seen]);
  return rose;
}

/** An entry's names not linked, being stepped through in the writing view. */
export interface NameReview {
  novelId: string;
  entry: string;
  passages: Passage[];
  at: number;
}

export const useNameReview = create<{ review: NameReview | undefined }>(() => ({ review: undefined }));
