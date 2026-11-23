import { Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "./cn.ts";

/**
 * A modal dialog with a title, closed by Escape, the overlay or `onClose`; focus returns to where it
 * was, or, when that's gone (the palette that opened it, an entry merged away), to `focusAfter`'s.
 */
export function Modal({ title, onClose, children, className, focusAfter }: { title: string; onClose: () => void; children: ReactNode; className?: string; focusAfter?: () => HTMLElement | null | undefined }) {
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          // Back to what opened it; or, where that's gone (the palette) and the focus is left on the page, to focusAfter's.
          onCloseAutoFocus={() =>
            setTimeout(() => {
              if (!document.activeElement || document.activeElement === document.body) (focusAfter?.() ?? document.getElementById("main"))?.focus();
            })
          }
          className={cn(
            "fixed top-1/2 left-1/2 z-50 grid max-h-[85vh] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-rule bg-raised p-5 text-ink shadow-xl",
            className,
          )}
        >
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
