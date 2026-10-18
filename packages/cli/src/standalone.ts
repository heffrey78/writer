// Entry point for the single-file validator vendored into novel repositories
// as .github/gh-writer/validate.mjs. Usage: node validate.mjs [dir] [--json]
import { parseArgs } from "node:util";
import { registerKinds } from "@writer/kinds";
import { runValidate } from "./validate-command.ts";

registerKinds(); // The kinds of book the app ships (D14).

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: { json: { type: "boolean" } },
});

runValidate(positionals[0] ?? ".", { json: values.json }).then(
  (code) => (process.exitCode = code),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 2;
  },
);
