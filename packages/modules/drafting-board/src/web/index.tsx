import type { WebModule } from "@writer/web/modules.tsx";
import { OutlineBoard } from "./board.tsx";

/** The drafting board's web half (#31): the outline as a board by status, mirrored to GitHub where the book is there. */
export const draftingBoardWeb: WebModule = {
  id: "drafting-board",
  outlineViews: [{ key: "board", label: "Board", render: ({ novelId, novel, workspace }) => <OutlineBoard novelId={novelId} novel={novel} workspace={workspace} /> }],
  commands: ({ novelId, navigate }) => [
    { id: "novel.outlineBoard", title: "Outline: drafting board", group: "Go to", keywords: ["board", "kanban", "status", "progress", "projects"], run: () => navigate(`/novels/${novelId}/outline/board`) },
  ],
};
