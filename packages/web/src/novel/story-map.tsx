import type { Book, BookKind } from "@writer/core";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router";
import { moduleStoryMapTabs } from "../modules.tsx";
import { cn } from "../ui/cn.ts";
import type { Workspace } from "./workspace.ts";
import { PAGE_WIDTH } from "../ui/page.ts";

/*
 * The story map (heffrey78/gh-writer#136): the views that set the story's elements against its scenes, as tabs of one
 * page. Each tab has its own address (/story-map/presence…); each view keeps its controls and export.
 * The kind's modules add every tab (the swimlanes, presence, the timeline): a kind without any has no
 * story map.
 */

/** The story map's tabs for a kind, in the order its modules come. The first is where /story-map goes. */
export const storyMapTabs = (kind: BookKind): { key: string; label: string }[] => moduleStoryMapTabs(kind).map(({ key, label }) => ({ key, label }));

export function StoryMapPage({ novelId, novel, workspace }: { novelId: string; novel: Book; workspace: Workspace }) {
  const { tab } = useParams();
  const navigate = useNavigate();
  const { state } = useLocation() as { state: { focusTab?: boolean } | null };
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const TABS = storyMapTabs(novel.kind);
  const current = TABS.findIndex((t) => t.key === tab);
  // A tab chosen by keyboard keeps the focus: the view may have been drawn afresh for its address.
  useEffect(() => {
    if (state?.focusTab) tabs.current[current]?.focus();
  }, [state, current]);
  if (!TABS.length) return <Navigate to={`/novels/${novelId}`} replace />;
  if (current < 0) return <Navigate to={`/novels/${novelId}/story-map/${TABS[0]!.key}`} replace />;
  const go = (i: number, focus = false) => {
    const t = TABS[(i + TABS.length) % TABS.length]!;
    void navigate(`/novels/${novelId}/story-map/${t.key}`, focus ? { state: { focusTab: true } } : undefined);
  };
  // The tab pattern: arrows (and Home, End) move between tabs and open them.
  const onKey = (e: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: TABS.length - 1 };
    const to = moves[e.key];
    if (to === undefined) return;
    e.preventDefault();
    go(to, true);
  };
  const panels: Record<string, ReactNode> = Object.fromEntries(moduleStoryMapTabs(novel.kind).map((t) => [t.key, t.render({ novelId, novel, workspace })]));
  const active = TABS[current]!;
  return (
    <div className={cn(PAGE_WIDTH, "grid content-start")}>
      <div className="grid gap-3 px-6 pt-6">
        <h1 className="text-xl font-semibold">Story map</h1>
        <div role="tablist" aria-label="Story map" className="flex gap-1 border-b border-rule" onKeyDown={onKey}>
          {TABS.map((t, i) => (
            <button
              key={t.key}
              ref={(el) => void (tabs.current[i] = el)}
              type="button"
              role="tab"
              id={`story-map-tab-${t.key}`}
              aria-selected={i === current}
              aria-controls="story-map-panel"
              tabIndex={i === current ? 0 : -1}
              onClick={() => go(i)}
              className={cn("-mb-px border-b-2 px-3 py-1.5 text-sm", i === current ? "border-accent font-medium" : "border-transparent text-muted hover:text-ink")}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" id="story-map-panel" aria-labelledby={`story-map-tab-${active.key}`}>
        {panels[active.key]}
      </div>
    </div>
  );
}
