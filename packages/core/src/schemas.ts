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
import note from "../schemas/note.schema.json" with { type: "json" };
import layouts from "../schemas/layouts.schema.json" with { type: "json" };
import compile from "../schemas/compile.schema.json" with { type: "json" };
import { kindByKey, startLevels, V2_KIND, type BookKind, type LevelDef } from "./kinds.ts";
import { recordTypesOf } from "./modules.ts";
import type { Diagnostic } from "./types.ts";

export const SCHEMAS = {
  novel,
  "manuscript-order": manuscriptOrder,
  part,
  chapter,
  scene,
  entity,
  relationships,
  note,
  layouts,
  compile,
} as const;

export type SchemaKind = keyof typeof SCHEMAS;

/**
 * A schema as books of `bookKind` have it. The committed schemas are a novel's; a scene's statuses
 * are its kind's. A module's record type has its own (`<key>`, and `<key>-list` for a v1 list of them).
 */
export function schemaFor(name: SchemaKind | string, bookKind: BookKind): object {
  const level = bookKind.levels.find((l) => l.key === name);
  if (level) return sectionSchema(bookKind, level);
  for (const t of recordTypesOf(bookKind)) {
    if (name === t.key) return t.schema;
    if (t.list && name === `${t.key}-list`) return t.list.schema;
  }
  if (name === "manuscript-order") return orderSchema(bookKind);
  if (name === "book") return bookSchema();
  if (name === "scene") return pieceSchema(bookKind);
  return SCHEMAS[name as SchemaKind];
}

const ref = (def: string) => ({ $ref: `common.schema.json#/$defs/${def}` });
/** Where the schemas' $ids are: common.schema.json's folder, so their $refs to it resolve. */
const BASE = common.$id.slice(0, common.$id.lastIndexOf("/") + 1);

/** _<level>.yaml: its ID, title, synopsis, and its children under the next level's (or the pieces') list. */
function sectionSchema(kind: BookKind, level: LevelDef): object {
  const next = kind.levels[kind.levels.indexOf(level) + 1];
  const list = next ? next.list : kind.piece.list;
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `${BASE}${level.key}.schema.json`,
    title: `_${level.key}.yaml`,
    type: "object",
    properties: { id: ref("id"), title: ref(level.titled ? "nonEmptyText" : "text"), synopsis: ref("text"), [list]: ref("orderList") },
    required: ["id", ...(level.titled ? ["title"] : []), list],
    additionalProperties: false,
  };
}

/** A piece's front matter: what every kind's has (id, title, synopsis, status, tags), then the kind's fields. */
function pieceSchema(kind: BookKind): object {
  const properties: Record<string, object> = {
    id: ref("id"),
    title: ref("nonEmptyText"),
    synopsis: ref("text"),
    status: { enum: kind.statuses.map((s) => s.key) },
  };
  for (const f of kind.fields) {
    const t = f.type;
    if (t.kind === "entity") properties[f.key] = ref("id");
    else if (t.kind === "own-entities") properties[f.key] = ref("idList");
    else if (t.kind === "story-time") {
      properties[f.key] = ref("storyTime");
      properties[t.durationKey] = ref("duration");
    } else if (!t.item?.length) properties[f.key] = ref("idList");
    else {
      // Each item a plain ID, or an object with its ID and what it carries.
      const item = Object.fromEntries(
        t.item.map((p) => [p.key, p.kind === "choice" ? { enum: [...p.values] } : p.kind === "scale" ? { type: "integer", minimum: p.min, maximum: p.max } : ref("text")]),
      );
      properties[f.key] = {
        type: "array",
        items: { if: { type: "string" }, then: ref("id"), else: { type: "object", properties: { id: ref("id"), ...item }, required: ["id"], additionalProperties: false } },
      };
    }
  }
  properties["tags"] = ref("tags");
  return { $schema: scene.$schema, $id: scene.$id, title: scene.title, type: "object", properties, required: ["id", "title"], additionalProperties: false };
}

/** book.yaml (format 3): novel.yaml's settings, and the kind of book it is. */
function bookSchema(): object {
  return {
    ...novel,
    $id: `${BASE}book.schema.json`,
    title: "book.yaml",
    properties: { ...novel.properties, schema_version: { type: "integer", minimum: 3 }, kind: ref("nonEmptyText") },
    required: [...novel.required, "kind"],
  };
}

/** _order.yaml: exactly one list, of the level the book starts at. */
function orderSchema(kind: BookKind): object {
  const lists = startLevels(kind).map((l) => l.list);
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `${BASE}manuscript-order.schema.json`,
    title: `${kind.folders.content}/_order.yaml`,
    description: `Top-level reading order: ${lists.length > 1 ? `exactly one of ${lists.join(" or ")}` : lists[0]}.`,
    type: "object",
    properties: Object.fromEntries(lists.map((l) => [l, ref("orderList")])),
    minProperties: 1,
    maxProperties: 1,
    additionalProperties: false,
  };
}

/** The schemas a book of `bookKind` has: one for each of its kind's levels in place of a novel's part and chapter, and its modules' records'. */
const schemaNames = (bookKind: BookKind) => [
  ...(Object.keys(SCHEMAS) as string[]).filter((n) => n !== "part" && n !== "chapter"),
  "book",
  ...bookKind.levels.map((l) => l.key),
  ...recordTypesOf(bookKind).flatMap((t) => (t.list ? [t.key, `${t.key}-list`] : [t.key])),
];

/** The compiled schemas, for each kind of book: one Ajv each, since the schemas share their $ids. */
const compiled = new Map<string, Map<string, ValidateFunction>>();

function validators(bookKind: BookKind): Map<string, ValidateFunction> {
  const done = compiled.get(bookKind.key);
  if (done) return done;
  const ajv = new Ajv2020.default({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
  ajv.addSchema(common);
  const map = new Map<string, ValidateFunction>();
  for (const name of schemaNames(bookKind)) map.set(name, ajv.compile(schemaFor(name, bookKind)));
  compiled.set(bookKind.key, map);
  return map;
}

/**
 * Check parsed file data against its schema, as a book of `bookKind` has it (by default format v2's,
 * a novel). Unknown fields are reported as W_UNKNOWN_KEY warnings; every other violation is an
 * E_SCHEMA error.
 */
export function checkSchema(kind: SchemaKind | string, data: unknown, file?: string, bookKind: BookKind = kindByKey(V2_KIND)): Diagnostic[] {
  const validate = validators(bookKind).get(kind);
  if (!validate) throw new Error(`A ${bookKind.label.toLowerCase()} has no schema “${kind}”`);
  if (validate(data)) return [];
  return (validate.errors ?? []).flatMap((e) => toDiagnostic(kind, e, file, bookKind));
}

function toDiagnostic(kind: string, e: ErrorObject, file: string | undefined, bookKind: BookKind): Diagnostic[] {
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
    const lists = startLevels(bookKind).map((l) => `\`${l.list}\``);
    return [{ ...base, severity: "error", code: "E_SCHEMA", message: lists.length > 1 ? `Must list exactly one of ${lists.join(" or ")}` : `Must list ${lists[0]}` }];
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
