import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { HistoryKeeper } from "./history.tsx";
import { AboutDialog } from "./about.tsx";
import { queryClient } from "./api.ts";
import { AppContextMenu } from "./context-menu.tsx";
import { DesktopBridge } from "./desktop-bridge.tsx";
import { FirstRunIdentity, IdentityDialog } from "./identity.tsx";
import { ConnectDialog } from "./github/connect.tsx";
import { PublishDialog } from "./github/publish.tsx";
import { GlobalCommands } from "./global-commands.tsx";
import { CommandPalette } from "./palette.tsx";
import { LibraryPage } from "./library/library-page.tsx";
import { registerModule } from "@writer/core";
import { MODULES } from "@writer/kinds";
import { registerWebModule, type WebModule } from "./modules.tsx";
import { plotlinesWeb } from "@writer/module-plotlines/web";
import { presenceWeb } from "@writer/module-presence/web";
import { storyTimeWeb } from "@writer/module-story-time/web";
import { NovelPage } from "./novel/novel-page.tsx";
import { NotFound } from "./not-found.tsx";
import { apply } from "./theme.ts";
import { ErrorBoundary } from "./ui/error-boundary.tsx";
import "./styles.css";

apply();

// The modules the app ships (D14), from packages/modules. Their core halves' declarations come with the
// book's kind, from the server; they're registered here too, for what the base reads through them in
// the browser (a piece's facts, the story clock). Then their web halves.
for (const module of MODULES) registerModule(module);
const WEB_MODULES: readonly WebModule[] = [plotlinesWeb, presenceWeb, storyTimeWeb];
for (const module of WEB_MODULES) registerWebModule(module);

// The graph benchmark (heffrey78/gh-writer#68), loaded only when visited.
const GraphBench = lazy(() => import("./graph/graph-bench.tsx").then((m) => ({ default: m.GraphBench })));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppContextMenu>
          <HistoryKeeper />
          <GlobalCommands />
          <CommandPalette />
          <ConnectDialog />
          <PublishDialog />
          <AboutDialog />
          <IdentityDialog />
          <FirstRunIdentity />
          <DesktopBridge />
          <ErrorBoundary what="this page">
            <Routes>
              <Route path="/" element={<LibraryPage />} />
              <Route
                path="/bench/graph"
                element={
                  <Suspense>
                    <GraphBench />
                  </Suspense>
                }
              />
              <Route path="/novels/:novelId/*" element={<NovelPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </ErrorBoundary>
        </AppContextMenu>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
