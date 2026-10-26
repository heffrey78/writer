import { BookOpenText, CalendarDays, CalendarPlus } from "lucide-react";
import type { WebModule } from "@writer/web/modules.tsx";
import { CalendarPage } from "./calendar-page.tsx";
import { DAY_BY_DAY, ReadPage } from "./read-page.tsx";
import { TodayPage } from "./today.tsx";

/**
 * Daily writing's web half (#38): Today's entry at /today (no place in the sidebar: the palette, the
 * shelf's tile and the desktop menu reach it), the calendar of the entries, and the journal page
 * (#64), at /read: today's entry at the top and every earlier one below it, newest first, written in
 * where they're read; both under Plan.
 */
export const dailyWeb: WebModule = {
  id: "daily",
  views: [
    { path: "today", label: "Today's entry", icon: CalendarPlus, render: ({ novelId }) => <TodayPage novelId={novelId} /> },
    { path: "calendar", label: "Calendar", icon: CalendarDays, group: "Plan", render: ({ novelId, novel }) => <CalendarPage novelId={novelId} novel={novel} /> },
    { path: "read", label: DAY_BY_DAY, icon: BookOpenText, group: "Plan", render: (view) => <ReadPage {...view} /> },
  ],
  shelfActions: [{ label: "Today's entry", path: "today", command: "daily.today" }],
  // Straight to the journal page, not by /today: on the page already, a redirect would make it
  // afresh, and the place's first words, typed as the palette closed, went with the one before.
  commands: ({ novelId, navigate }) => [{ id: "daily.today", title: "Today's entry", group: "Write", keywords: ["today", "daily", "journal", "new entry"], run: () => navigate(`/novels/${novelId}/read`) }],
};
