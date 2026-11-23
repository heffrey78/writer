import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { useNavigate, type NavigateFunction, type NavigateOptions, type To } from "react-router";

/*
 * Going somewhere without being drawn again at every change of address. Under a BrowserRouter,
 * useNavigate re-renders its component whenever the address changes: a long book's manuscript tree,
 * drawn again at every step through the index, cost 25 ms a step (#177). This navigate is the same
 * function for the app's life, and always the latest underneath.
 */

const Stable = createContext<NavigateFunction | null>(null);

/** Under the router, around everything that uses useStableNavigate. */
export function StableNavigate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const latest = useRef(navigate);
  latest.current = navigate;
  const stable = useMemo(() => ((to: To | number, options?: NavigateOptions) => (typeof to === "number" ? latest.current(to) : latest.current(to, options))) as NavigateFunction, []);
  return <Stable.Provider value={stable}>{children}</Stable.Provider>;
}

export function useStableNavigate(): NavigateFunction {
  // Without StableNavigate around it (a test's router alone), the router's own: whether it's there doesn't change while mounted.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useContext(Stable) ?? useNavigate();
}
