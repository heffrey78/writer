#!/usr/bin/env node
import { parseArgs } from "node:util";
import { newId, SCHEMA_VERSION } from "@writer/core";
import { registerKinds } from "@writer/kinds";
import { useNodePorts } from "@writer/server/node";
import { dailyServer } from "@writer/module-daily/server";
import { draftingBoardServer } from "@writer/module-drafting-board/server";
import { offPageEventsServer } from "@writer/module-off-page-events/server";
import { storyTimeServer } from "@writer/module-story-time/server";
import { registerServerModule } from "@writer/server";
import { runCompile } from "./compile-command.ts";
import { runConvert } from "./convert-command.ts";
import { runMigrate } from "./migrate-command.ts";
import { runServe } from "./serve-command.ts";
import { runSnapshots } from "./snapshots-command.ts";
import { runValidate } from "./validate-command.ts";

registerKinds(); // The kinds of book the app ships (D14).
useNodePorts(); // The server's git, on Node (D16).
// The server halves of the modules they use: their routes under a book.
for (const module of [storyTimeServer, offPageEventsServer, draftingBoardServer, dailyServer]) registerServerModule(module);

const USAGE = `Usage: writer <command> [options]

Commands:
  serve [dir]               Start the app on this machine and open the novel in dir
                            (default: the current directory, if it holds one)
      --port <n>            Listen on this port (default: a free one)
      --no-open             Print the URL without opening a browser
      --sync-every <min>    Sync with GitHub every <min> minutes (default 5; 0: only on demand)
      --sidecar             For the desktop app: print {url, token, launchUrl} as one JSON line,
                            with messages on stderr, and stop when stdin closes
  validate [dir] [--json]   Check a novel repository (default: current directory)
  snapshots [dir] [--check] Write the diagram snapshots (diagrams/*.svg, diagrams/README.md);
                            with --check, only report whether they're current (exit 1 if not)
  compile [dir]             Compile the manuscript to files, as the app does
      --format <list>       docx, epub, pdf, comma-separated (default: all three)
      --preset <name>       A preset in compile.yaml (default: its first)
      --from <chapter>      The first chapter to compile, by ID (default: the first)
      --to <chapter>        The last, by ID (default: the last)
      --out <dir>           Where the files go (default: compiled/ in the novel)
  migrate [dir]             Move a novel to the newest format, as one commit (and update its
                            tools in .github/gh-writer/)
  convert [dir] --to <kind> Make a book another kind, as one commit: a novel kept as a journal
                            a journal ("--to journal"), every ID kept
  new-id <prefix>           Print a new random ID, e.g. "writer new-id char"

Options:
  -h, --help                Show this help
  -v, --version             Show version
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    allowNegative: true,
    options: {
      json: { type: "boolean" },
      check: { type: "boolean" },
      port: { type: "string" },
      format: { type: "string" },
      preset: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      out: { type: "string" },
      "sync-every": { type: "string" },
      open: { type: "boolean", default: true },
      sidecar: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  const [command, ...rest] = positionals;

  if (values.version) {
    console.log(`writer 0.1.0 (format v${SCHEMA_VERSION})`);
    return 0;
  }
  if (values.help || !command) {
    console.log(USAGE);
    return command || values.help ? 0 : 1;
  }

  switch (command) {
    case "serve": {
      const port = values.port === undefined ? 0 : Number(values.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        console.error(`--port needs a port number from 0 to 65535, not "${values.port}"`);
        return 1;
      }
      const syncEvery = values["sync-every"] === undefined ? undefined : Number(values["sync-every"]);
      if (syncEvery !== undefined && !(syncEvery >= 0 && syncEvery <= 1440)) {
        console.error(`--sync-every needs a number of minutes from 0 to 1440, not "${values["sync-every"]}"`);
        return 1;
      }
      return runServe(rest[0], { port, open: values.open && !values.sidecar, sidecar: values.sidecar ?? false, ...(syncEvery !== undefined ? { syncEvery } : {}) });
    }
    case "validate":
      return runValidate(rest[0] ?? ".", { json: values.json });
    case "snapshots":
      return runSnapshots(rest[0] ?? ".", { check: values.check ?? false });
    case "compile": {
      const { format, preset, from, to, out } = values;
      return runCompile(rest[0] ?? ".", { format, preset, from, to, out });
    }
    case "migrate":
      return runMigrate(rest[0] ?? ".");
    case "convert":
      if (!values.to) {
        console.error("convert needs the kind of book to make it: --to journal");
        return 1;
      }
      return runConvert(rest[0] ?? ".", values.to);
    case "new-id": {
      const prefix = rest[0];
      if (!prefix || !/^[a-z]{2,8}$/.test(prefix)) {
        console.error("new-id needs a prefix of 2-8 lowercase letters, e.g. char, loc, sc");
        return 1;
      }
      console.log(newId(prefix));
      return 0;
    }
    default:
      console.error(`Unknown command "${command}"\n\n${USAGE}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => (process.exitCode = code),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 2;
  },
);
