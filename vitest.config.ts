import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.{ts,tsx}"],
    // Most server, CLI and client tests drive real git and a real server: a second or so alone, but
    // several times that while the whole suite runs in parallel, which the default 5 s didn't allow
    // (#18). Tests that do more still say so themselves.
    testTimeout: 20_000,
  },
});
