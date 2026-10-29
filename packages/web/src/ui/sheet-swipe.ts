import { useEffect, useRef, type PointerEvent, type RefObject } from "react";

/** Moved this far, a touch has said which way it's going. */
const DECIDES_AT = 8;
/** A flick this fast (px/ms) closes the sheet however short it went. */
const FLICK = 0.5;
/** A finger held still this long before it's lifted isn't a flick. */
const HELD = 100;
const SLIDE_MS = 150;
/** Where a drag edits or selects, not moves the sheet. */
const FIELDS = 'input, textarea, select, [contenteditable="true"], [role="separator"]';

interface Drag {
  id: number;
  x: number;
  y: number;
  by: number;
  width: number;
  claimed: boolean;
  at: number;
  speed: number;
}

/**
 * A sheet from the right edge that a finger draws back toward it closes (#109): it follows the finger,
 * the dimmed page behind lightening as it goes, and let go past a third of its width or flicked, it
 * slides off and closes; short of that, it slides back. Touch and pen only, so a mouse still selects.
 * The sheet wants `touch-action: pan-y`, so the browser keeps scrolling it and the sideways drag is
 * ours; one that starts mostly vertical is the browser's. It moves by transform alone, with no React
 * state while the finger is down, to keep up with it.
 */
export function useSwipeClose({ sheet, backdrop, onClose }: { sheet: RefObject<HTMLElement | null>; backdrop?: RefObject<HTMLElement | null>; onClose: () => void }) {
  const drag = useRef<Drag | null>(null);
  // Once the drag is the sheet's, the browser gets none of it: left to it, the flick ran on as its own
  // fling, and Chrome took the next tap to stop that, so the first tap after a flick did nothing. Not
  // passive, so it can say so; React's touch listeners are. On every render: the sheet comes and goes.
  useEffect(() => {
    const el = sheet.current;
    if (!el) return;
    const ours = (e: TouchEvent) => void (drag.current?.claimed && e.cancelable && e.preventDefault());
    el.addEventListener("touchmove", ours, { passive: false });
    return () => el.removeEventListener("touchmove", ours);
  });
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const place = (by: number, width: number, slide: boolean) => {
    const el = sheet.current;
    if (!el) return;
    const ease = slide && !still() ? `${SLIDE_MS}ms ease-out` : "";
    el.style.transition = ease ? `transform ${ease}` : "none";
    el.style.transform = by ? `translateX(${by}px)` : "";
    const behind = backdrop?.current;
    if (behind) {
      behind.style.transition = ease ? `opacity ${ease}` : "none";
      behind.style.opacity = by && width ? String(Math.max(0, 1 - by / width)) : "";
    }
  };
  const end = (e: PointerEvent<HTMLElement>, lifted: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.claimed) return;
    const flicked = lifted && e.timeStamp - d.at < HELD && d.speed > FLICK;
    if (!lifted || (d.by <= d.width / 3 && !flicked)) return place(0, d.width, true);
    place(d.width, d.width, true);
    if (still()) onClose();
    else setTimeout(onClose, SLIDE_MS);
  };
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      if ((e.target as Element).closest(FIELDS)) return;
      const sel = getSelection();
      if (sel && !sel.isCollapsed && sheet.current?.contains(sel.anchorNode)) return;
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, by: 0, width: 0, claimed: false, at: e.timeStamp, speed: 0 };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x;
      if (!d.claimed) {
        const dy = e.clientY - d.y;
        if (Math.hypot(dx, dy) < DECIDES_AT) return;
        // Leftward or mostly vertical: not a close, and not ours however it goes on.
        if (dx <= Math.abs(dy)) return void (drag.current = null);
        d.claimed = true;
        d.width = sheet.current?.offsetWidth ?? 0;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // A pointer that's already gone: the drag ends with its pointerup or pointercancel anyway.
        }
      }
      const by = Math.max(0, dx);
      const dt = e.timeStamp - d.at;
      if (dt > 0) d.speed = (by - d.by) / dt;
      d.by = by;
      d.at = e.timeStamp;
      place(by, d.width, false);
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => end(e, true),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => end(e, false),
  };
}
