import { defineConfig } from "vitest/config";

// The D16 spike's contract suite (#45): run by hand, after `cargo build --release` in git2-port, with
// `npx vitest run --config spike/d16/vitest.config.ts`. Not part of `npm run check`, which needs no Rust.
export default defineConfig({
  test: {
    include: ["spike/d16/**/*.test.ts"],
    testTimeout: 30_000,
    // One file, run in order: the ports share the temp folder and its global git config.
    fileParallelism: false,
  },
});
