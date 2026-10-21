import { CalendarDays, CalendarPlus } from "lucide-react";
import type { WebModule } from "@writer/web/modules.tsx";
import { CalendarPage } from "./calendar-page.tsx";
import { TodayPage } from "./today.tsx";

/**
 * Daily writing's web half (#38): Today's entry at /today (no place in the sidebar: the palette, the
 * shelf's tile and the desktop menu reach it), and the calendar of the entries, under Plan.
 */
export const dailyWeb: WebModule = {
  id: "daily",
  views: [
    { path: "today", label: "Today's entry", icon: CalendarPlus, render: ({ novelId }) => <TodayPage novelId={novelId} /> },
    { path: "calendar", label: "Calendar", icon: CalendarDays, group: "Plan", render: ({ novelId, novel }) => <CalendarPage novelId={novelId} novel={novel} /> },
  ],
  shelfActions: [{ label: "Today's entry", path: "today", command: "daily.today" }],
  commands: ({ novelId, navigate }) => [{ id: "daily.today", title: "Today's entry", group: "Write", keywords: ["today", "daily", "journal", "new entry"], run: () => navigate(`/novels/${novelId}/today`) }],
};
