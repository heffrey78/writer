import { useQueryClient } from "@tanstack/react-query";
import type { Book } from "@writer/core";
import { keys } from "@writer/web/api.ts";
import type { BookView, WebModule } from "@writer/web/modules.tsx";
import { Button } from "@writer/web/ui/button.tsx";
import { PAGE } from "@writer/web/ui/page.ts";
import { LayoutDashboard } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { create } from "zustand";
import { boardsOf } from "../core/index.ts";
import { BoardNameDialog } from "./board-name.tsx";
import { BoardPage } from "./board-page.tsx";
import { boards } from "./client.ts";

/*
 * Mood boards' web half (#207): the Boards page, listing the book's boards with New board, each board
 * under it in the sidebar, and a board's own page at /boards/<id>. The palette makes, renames and
 * deletes them, and goes to each.
 */

/** Whether New board is being asked for: the palette asks from anywhere in the book. */
const useNewBoard = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

function NewBoard({ novelId }: { novelId: string }) {
  const { open, set } = useNewBoard();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  if (!open) return null;
  return (
    <BoardNameDialog
      title="New board"
      action="Make the board"
      onClose={() => set(false)}
      onName={async (title) => {
        const { id } = await boards.create(novelId, title);
        await queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
        navigate(`/novels/${novelId}/boards/${id}`);
      }}
    />
  );
}

function BoardsList({ novelId, novel }: { novelId: string; novel: Book }) {
  const list = boardsOf(novel);
  return (
    <div className={PAGE}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">Boards</h1>
        <Button size="sm" onClick={() => useNewBoard.getState().set(true)}>
          New board
        </Button>
      </div>
      {list.length ? (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((b) => (
            <li key={b.id}>
              <Link to={b.id} className="grid gap-0.5 rounded-xl border border-rule bg-raised px-4 py-3 hover:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
                <span className="font-semibold">{b.title}</span>
                <span className="text-sm text-muted">{b.cards.length === 1 ? "1 card" : `${b.cards.length} cards`}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">No boards yet. A board holds pictures, notes and entries, placed where you want them: one for a place, a faction or an arc.</p>
      )}
    </div>
  );
}

function BoardsRoute({ novelId, novel }: BookView) {
  const id = useParams()["*"];
  const board = id ? boardsOf(novel).find((b) => b.id === id) : undefined;
  return (
    <>
      {id ? board ? <BoardPage novelId={novelId} book={novel} board={board} /> : <p className={PAGE}>There's no such board in this book.</p> : <BoardsList novelId={novelId} novel={novel} />}
      <NewBoard novelId={novelId} />
    </>
  );
}

export const moodBoardWeb: WebModule = {
  id: "mood-board",
  views: [
    {
      path: "boards",
      label: "Boards",
      icon: LayoutDashboard,
      group: "Plan",
      items: (novel) => boardsOf(novel).map((b) => ({ path: b.id, label: b.title })),
      render: (view) => <BoardsRoute {...view} />,
    },
  ],
  commands: ({ novelId, novel, navigate }) => [
    {
      id: "board.new",
      title: "New board…",
      group: "Board",
      keywords: ["mood board", "pictures"],
      run: () => {
        navigate(`/novels/${novelId}/boards`);
        useNewBoard.getState().set(true);
      },
    },
    ...boardsOf(novel).map((b) => ({ id: `board.go.${b.id}`, title: `Board: ${b.title}`, group: "Go to", keywords: ["board", "mood board"], run: () => navigate(`/novels/${novelId}/boards/${b.id}`) })),
  ],
};
