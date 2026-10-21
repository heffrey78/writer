import { useCompiledSchemas } from "@writer/core";
import type { ValidateFunction } from "ajv";
import meta from "../generated/schemas.json" with { type: "json" };
import * as campaign from "../generated/schemas-campaign.js";
import * as journal from "../generated/schemas-journal.js";
import * as novel from "../generated/schemas-novel.js";

/**
 * The shipped kinds' schema validators, compiled ahead of time (scripts/compile-schemas.ts), for where
 * code can't be compiled at run time: the engine in a page (#51). Core uses a kind's only while its
 * schemas are those they were compiled from.
 */
const MODULES: Record<string, Record<string, ValidateFunction>> = { novel, journal, campaign };

export function useCompiledKindSchemas(): void {
  for (const [key, { fingerprint, exports }] of Object.entries(meta)) {
    const module = MODULES[key];
    if (!module) continue;
    useCompiledSchemas(key, fingerprint, Object.fromEntries(Object.entries(exports).map(([name, exported]) => [name, module[exported]!])));
  }
}
