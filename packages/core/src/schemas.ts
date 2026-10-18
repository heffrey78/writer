import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import common from "../schemas/common.schema.json" with { type: "json" };
import novel from "../schemas/novel.schema.json" with { type: "json" };
import manuscriptOrder from "../schemas/manuscript-order.schema.json" with { type: "json" };
import part from "../schemas/part.schema.json" with { type: "json" };
import chapter from "../schemas/chapter.schema.json" with { type: "json" };
import scene from "../schemas/scene.schema.json" with { type: "json" };
import entity from "../schemas/entity.schema.json" with { type: "json" };
import relationships from "../schemas/relationships.schema.json" with { type: "json" };
import events from "../schemas/events.schema.json" with { type: "json" };
import event from "../schemas/event.schema.json" with { type: "json" };
import note from "../schemas/note.schema.json" with { type: "json" };
import layouts from "../schemas/layouts.schema.json" with { type: "json" };
import compile from "../schemas/compile.schema.json" with { type: "json" };
import { kindByKey, V2_KIND, type BookKind } from "./kinds.ts";
import type { Diagnostic } from "./types.ts";

export const SCHEMAS = {
  novel,
  "manuscript-order": manuscriptOrder,
  part,
  chapter,
  scene,
  entity,
  relationships,
  events,
  event,
  note,
  layouts,
  compile,
} as const;

export type SchemaKind = keyof typeof SCHEMAS;

/**
 * A schema as books of `bookKind` have it. The committed schemas are a novel's; a scene's statuses
 * are its kind's.
 */
export function schemaFor(name: SchemaKind, bookKind: BookKind): object {
  if (name !== "scene") return SCHEMAS[name];
  return { ...scene, properties: { ...scene.properties, status: { enum: bookKind.statuses.map((s) => s.key) } } };
}

/** The compiled schemas, for each kind of book: one Ajv each, since the schemas share their $ids. */
const compiled = new Map<string, Map<SchemaKind, ValidateFunction>>();

function validators(bookKind: BookKind): Map<SchemaKind, ValidateFunction> {
  const done = compiled.get(bookKind.key);
  if (done) return done;
  const ajv = new Ajv2020.default({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
  ajv.addSchema(common);
  const map = new Map<SchemaKind, ValidateFunction>();
  for (const kind of Object.keys(SCHEMAS) as SchemaKind[]) {
    map.set(kind, ajv.compile(schemaFor(kind, bookKind)));
  }
  compiled.set(bookKind.key, map);
  return map;
}

/**
 * Check parsed file data against its schema, as a book of `bookKind` has it (by default format v2's,
 * a novel). Unknown fields are reported as W_UNKNOWN_KEY warnings; every other violation is an
 * E_SCHEMA error.
 */
export function checkSchema(kind: SchemaKind, data: unknown, file?: string, bookKind: BookKind = kindByKey(V2_KIND)): Diagnostic[] {
  const validate = validators(bookKind).get(kind)!;
  if (validate(data)) return [];
  return (validate.errors ?? []).flatMap((e) => toDiagnostic(kind, e, file));
}

function toDiagnostic(kind: SchemaKind, e: ErrorObject, file?: string): Diagnostic[] {
  // An if/then/else failure is always accompanied by the specific errors from the taken branch.
  if (e.keyword === "if") return [];
  const at = (pointer: string) => (pointer ? ` at ${pointer}` : "");
  const base = { file, pointer: e.instancePath || undefined };

  if (e.keyword === "additionalProperties") {
    const key = String(e.params["additionalProperty"]);
    return [{
      ...base,
      severity: "warning",
      code: "W_UNKNOWN_KEY",
      pointer: `${e.instancePath}/${key}`,
      message: `Unknown field "${key}"${at(e.instancePath)}`,
    }];
  }
  if (kind === "manuscript-order" && (e.keyword === "minProperties" || e.keyword === "maxProperties")) {
    return [{ ...base, severity: "error", code: "E_SCHEMA", message: "Must list exactly one of `parts` or `chapters`" }];
  }
  if (e.keyword === "required") {
    const key = String(e.params["missingProperty"]);
    return [{ ...base, severity: "error", code: "E_SCHEMA", message: `Missing required field "${key}"${at(e.instancePath)}` }];
  }
  if (e.keyword === "pattern" && isIdSchema(e.schemaPath)) {
    return [{ ...base, severity: "error", code: "E_SCHEMA", message: `Not a valid ID${at(e.instancePath)}: ${JSON.stringify(e.data)}` }];
  }
  const detail = e.keyword === "enum" ? ` (${(e.params["allowedValues"] as unknown[]).join(", ")})` : "";
  return [{ ...base, severity: "error", code: "E_SCHEMA", message: `Value${at(e.instancePath)} ${e.message}${detail}` }];
}

function isIdSchema(schemaPath: string): boolean {
  return schemaPath.includes("#/$defs/id/");
}
