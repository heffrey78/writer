import { createApi } from "@writer/client";
import { focusManager, QueryClient } from "@tanstack/react-query";

/** The local server's API, on the page's own origin and session cookie. */
export const api = createApi();

export const queryClient = new QueryClient({
  defaultOptions: {
    // The server is local: failures are real, not flaky networks.
    queries: { retry: false, refetchOnWindowFocus: true, staleTime: 5_000 },
  },
});

// Refetch when the window comes forward, not only when the page is shown again: in the desktop app
// the library stays visible behind a novel's window, and opening the novel changes what it shows.
focusManager.setEventListener((handleFocus) => {
  const listener = () => handleFocus();
  window.addEventListener("visibilitychange", listener, false);
  window.addEventListener("focus", listener, false);
  return () => {
    window.removeEventListener("visibilitychange", listener);
    window.removeEventListener("focus", listener);
  };
});

export const keys = {
  app: ["app"] as const,
  identity: ["identity"] as const,
  licenses: ["licenses"] as const,
  library: ["library"] as const,
  novel: (id: string) => ["novel", id] as const,
  sync: (id: string) => ["sync", id] as const,
  /** Everything about a novel's GitHub issues: refetched together when they change. */
  issues: (id: string) => ["issues", id] as const,
  /** What a module's routes answer for the book (the drafting board's status): refreshed when the module says so. */
  module: (id: string, module: string, ...rest: string[]) => ["module", id, module, ...rest] as const,
  checkpoints: (id: string) => ["checkpoints", id] as const,
  versions: (id: string) => ["versions", id] as const,
  stats: (id: string) => ["stats", id] as const,
};
