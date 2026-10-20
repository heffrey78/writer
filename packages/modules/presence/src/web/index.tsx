import type { WebModule } from "@writer/web/modules.tsx";
import { PresencePage } from "./presence-page.tsx";

/** Presence's web half (#29): the matrix as a tab of the story map. */
export const presenceWeb: WebModule = {
  id: "presence",
  storyMapTabs: [{ key: "presence", label: "Presence", keywords: ["matrix", "who is where", "absences"], render: (view) => <PresencePage novelId={view.novelId} novel={view.novel} workspace={view.workspace} /> }],
};
