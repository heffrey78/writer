import type { WebModule } from "@writer/web/modules.tsx";
import { DateDayOne } from "./day-one.tsx";
import { OutlineTimeCards, OutlineTimeTable } from "./outline-time.tsx";
import { TimelinePage } from "./timeline-page.tsx";

/** Story time's web half (#30): the timeline as a tab of the story map, the outline in story time, and dating Day 1 from a scene's new date. */
export const storyTimeWeb: WebModule = {
  id: "story-time",
  storyMapTabs: [{ key: "timeline", label: "Timeline", keywords: ["chronology", "story time", "flashback"], render: (view) => <TimelinePage novelId={view.novelId} novel={view.novel} /> }],
  outlineOrders: [
    {
      key: "time",
      label: "Story time",
      table: (view) => <OutlineTimeTable novelId={view.novelId} novel={view.novel} workspace={view.workspace} />,
      cards: (view) => <OutlineTimeCards novelId={view.novelId} novel={view.novel} />,
    },
  ],
  dayToDate: (view) => <DateDayOne {...view} />,
};
