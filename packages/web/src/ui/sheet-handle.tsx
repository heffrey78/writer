import { useRef, type PointerEvent } from "react";

/** Past this far, a sheet let go closes; short of it, it goes back. */
const CLOSES_AT = 64;

/**
 * The grip on a sheet's edge (#100): dragged away from the screen's edge the sheet came from, the
 * sheet follows the finger and closes once it's let go far enough; tapped, it closes. A button, so
 * it's in the tab order and named for a screen reader; Escape and Android's back close the sheet too.
 */
export function SheetHandle({ edge, onClose }: { edge: "bottom" | "top"; onClose: () => void }) {
  // A bottom sheet closes going down, a top one going up.
  const sign = edge === "bottom" ? 1 : -1;
  const drag = useRef<{ from: number; by: number; sheet: HTMLElement } | null>(null);
  const moved = useRef(false);
  const place = (sheet: HTMLElement, by: number, settle: boolean) => {
    sheet.style.transition = settle ? "transform 150ms ease-out" : "none";
    sheet.style.transform = by ? `translateY(${sign * by}px)` : "";
  };
  const end = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (d.by > CLOSES_AT) return onClose();
    place(d.sheet, 0, true);
  };
  return (
    <button
      type="button"
      aria-label="Close"
      className="flex h-7 w-full shrink-0 touch-none items-center justify-center"
      onPointerDown={(e) => {
        const sheet = e.currentTarget.closest<HTMLElement>("[role=dialog]");
        if (!sheet) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { from: e.clientY, by: 0, sheet };
        moved.current = false;
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.by = Math.max(0, sign * (e.clientY - d.from));
        if (d.by > 8) moved.current = true;
        place(d.sheet, d.by, false);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      // A tap closes it; the end of a drag that went back doesn't.
      onClick={() => !moved.current && onClose()}
    >
      <span aria-hidden className="h-1 w-9 rounded-full bg-rule" />
    </button>
  );
}
