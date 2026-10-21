import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, keys } from "@writer/web/api.ts";
import { ErrorAlert } from "@writer/web/ui/alert.tsx";
import { today } from "../core/index.ts";

/**
 * Today's entry (#38): the writer's today's, opened at once, made first (in its month and year) if
 * there's none. The address /today does it, so the palette, the shelf and the desktop menu all can.
 */
export function TodayPage({ novelId }: { novelId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string>();
  // Once, however often the page draws: a second ask would find the entry, but needn't.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void (async () => {
      try {
        const { id, made } = await api.module<{ id: string; made: boolean }>(novelId, "daily", "POST", "today", { day: today() });
        if (made) await queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
        void navigate(`/novels/${novelId}/scene/${id}`, { replace: true });
      } catch (e) {
        setProblem(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [novelId, navigate, queryClient]);
  return (
    <div className="px-6 py-6">
      {problem ? (
        <ErrorAlert title="Couldn't open today's entry">{problem}</ErrorAlert>
      ) : (
        <p className="text-muted" aria-busy="true">
          Opening today's entry…
        </p>
      )}
    </div>
  );
}
