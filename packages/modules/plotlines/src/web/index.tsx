import type { WebModule } from "@writer/web/modules.tsx";
import { PLOTLINE } from "../core/index.ts";
import { Beats } from "./beats.tsx";
import { SwimlanesPage } from "./swimlanes-page.tsx";

/** Plotlines' web half (#28): the swimlanes as the story map's first tab, and the beats on a plotline's profile. */
export const plotlinesWeb: WebModule = {
  id: "plotlines",
  storyMapTabs: [{ key: "plotlines", label: "Plotlines", keywords: ["plotlines", "swimlanes"], render: (view) => <SwimlanesPage novelId={view.novelId} novel={view.novel} workspace={view.workspace} /> }],
  profileSections: [{ entityType: PLOTLINE.key, render: (view) => <Beats novelId={view.novelId} novel={view.novel} entity={view.entity} workspace={view.workspace} /> }],
};
