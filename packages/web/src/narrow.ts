import { useEffect, useState } from "react";

/** A window too narrow for the sidebar beside the text (a phone, a narrow window): below Tailwind's md. */
const NARROW = "(max-width: 47.99rem)";

export function useNarrow(): boolean {
  // A window that can't say (a test's) is wide.
  const [narrow, setNarrow] = useState(() => typeof matchMedia === "function" && matchMedia(NARROW).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia(NARROW);
    const on = () => setNarrow(query.matches);
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
  }, []);
  return narrow;
}

/**
 * Whether the on-screen keyboard is up, on a phone: the window is shorter than it's been at its
 * width (Android's app gives the keyboard room by shrinking the page, #96).
 */
export function useKeyboardUp(): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    let width = innerWidth;
    let tallest = innerHeight;
    const on = () => {
      // Turned, or the window made another size: its height then is the new whole.
      if (innerWidth !== width) [width, tallest] = [innerWidth, innerHeight];
      tallest = Math.max(tallest, innerHeight);
      setUp(innerHeight < tallest * 0.8);
    };
    addEventListener("resize", on);
    return () => removeEventListener("resize", on);
  }, []);
  return up;
}
