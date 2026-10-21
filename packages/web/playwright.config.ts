import { defineConfig, devices } from "@playwright/test";

// The browsers to test in (E2E_BROWSERS=chromium,webkit): both in CI; Chromium alone elsewhere unless
// asked, since Playwright's WebKit needs Ubuntu's libraries (or its Docker image).
const browsers = (process.env.E2E_BROWSERS ?? (process.env.CI ? "chromium,webkit" : "chromium")).split(",");

// The writing view's specs again with the engine in the page, as Android runs it (#51): `writer serve
// --engine-in-page` serves the app and a bridge to git and the disk, and a service worker hands the
// page's requests to the engine there.
const WRITING_VIEW = /\/(workspace|writing-chrome|tree|structure|scene-details|scene-notes|mentions|mention-sync|resilience|empty-chapter)\.spec\.ts$/;
const engineInPage = { serveArgs: ["--engine-in-page"] };

// Each test starts its own writer server (e2e/fixtures.ts) on the built app: `npm run test:e2e` builds first.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /performance/ },
    // WebKit: the engine of the desktop app's window on macOS and Linux (heffrey78/gh-writer#187). Its own Linux user
    // agent, like the Linux webview's (a Safari one would make the app use the Mac's shortcuts).
    ...(browsers.includes("webkit") ? [{ name: "webkit", use: { browserName: "webkit" as const, viewport: { width: 1280, height: 720 } }, testIgnore: /performance/, timeout: 60_000, expect: { timeout: 10_000 } }] : []),
    { name: "engine-in-page-chromium", use: { ...devices["Desktop Chrome"], ...engineInPage }, testMatch: WRITING_VIEW },
    ...(browsers.includes("webkit") ? [{ name: "engine-in-page-webkit", use: { browserName: "webkit" as const, viewport: { width: 1280, height: 720 }, ...engineInPage }, testMatch: WRITING_VIEW, timeout: 60_000, expect: { timeout: 10_000 } }] : []),
    // The benchmarks run alone, after the rest and one at a time, so nothing competes with them for the CPU.
    { name: "performance", use: { ...devices["Desktop Chrome"] }, testMatch: /performance/, dependencies: ["chromium"], fullyParallel: false, workers: 1 },
  ],
});
