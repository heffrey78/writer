import { X } from "lucide-react";
import { create } from "zustand";
import { useCommands } from "../commands.ts";
import { Button } from "../ui/button.tsx";

export interface Notice {
  message: string;
  action?: { label: string; run: () => void };
  /** A second, lesser choice beside the action. */
  secondary?: { label: string; run: () => void };
}

/** One notice at a time, at the bottom of the workspace, until dismissed or replaced. */
export const useNotice = create<{ notice: Notice | undefined; show: (n: Notice | undefined) => void }>((set) => ({
  notice: undefined,
  show: (notice) => set({ notice }),
}));

export function NoticeBar() {
  const { notice, show } = useNotice();
  // The notice's action (Undo) is also a command, so it's a keystroke away wherever focus is.
  useCommands(
    () =>
      notice?.action
        ? [
            {
              id: "notice.action",
              title: `${notice.action.label}: ${notice.message}`,
              group: "Checkpoints",
              run: () => {
                const run = notice.action!.run;
                show(undefined);
                run();
              },
            },
            ...(notice.secondary
              ? [
                  {
                    id: "notice.secondary",
                    title: `${notice.secondary.label}: ${notice.message}`,
                    group: "Checkpoints",
                    run: () => {
                      const run = notice.secondary!.run;
                      show(undefined);
                      run();
                    },
                  },
                ]
              : []),
          ]
        : [],
    [notice],
  );
  return (
    // On a phone, above the bottom bar and the writing bar: it stays until dismissed, and mustn't cover them.
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex justify-center px-4 max-md:bottom-36">
      {notice && (
        // A long message takes the width, its buttons under it, rather than squeezed into a column beside them (a phone's).
        <div className="pointer-events-auto flex max-w-2xl flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-rule bg-raised py-2 pr-2 pl-4 text-sm shadow-lg">
          <p className="min-w-0 flex-[1_1_16rem] py-1">{notice.message}</p>
          <div className="ml-auto flex items-center gap-1">
          {notice.action && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                const run = notice.action!.run;
                show(undefined);
                run();
              }}
            >
              {notice.action.label}
            </Button>
          )}
          {notice.secondary && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const run = notice.secondary!.run;
                show(undefined);
                run();
              }}
            >
              {notice.secondary.label}
            </Button>
          )}
          <Button size="sm" variant="ghost" aria-label="Dismiss" onClick={() => show(undefined)}>
            <X className="size-4" aria-hidden />
          </Button>
          </div>
        </div>
      )}
    </div>
  );
}
