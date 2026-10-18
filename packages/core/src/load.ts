import { reservedPrefixes, type EntityTypeDef } from "./ids.ts";
import { kindByKey, knownKind, startLevels, V2_KIND, type BookKind, type LevelDef } from "./kinds.ts";
import { EVENT_FILES_FORMAT, MANIFEST, NOVEL_MANIFEST, readManifest, SCHEMA_VERSION } from "./manifest.ts";
import type { Section, Entity, Book, PlotlineRef, Relationship, Piece, StoryEvent, ThemeRef } from "./model.ts";
import { parseMarkdown, parseYaml } from "./parse.ts";
import { checkSchema, type SchemaKind } from "./schemas.ts";
import { joinPath, type FileSource } from "./source.ts";
import type { CompileFile, Diagnostic, NovelFile, RelationshipTypeFile, PieceStatus, StoryTime } from "./types.ts";

/**
 * Load a book's repository into a story model, as the kind of book its manifest names (D15): book.yaml's
 * `kind`, or a novel for a book in format 1 or 2 (novel.yaml). `kind` reads it as another kind (tests).
 *
 * Loading never throws on bad content: parse, schema and structure problems are
 * collected in `novel.diagnostics`, and the model holds whatever could be read.
 * Cross-reference checks are done separately by `validateBook`.
 */
export async function loadBook(source: FileSource, kind?: BookKind): Promise<Book> {
  const diagnostics: Diagnostic[] = [];
  const manifest = await readManifest(source);
  const file = manifest?.file ?? NOVEL_MANIFEST;
  const named = manifest?.kind === undefined ? undefined : knownKind(manifest.kind);
  const bookKind = kind ?? named ?? kindByKey(V2_KIND);
  const { content, codex, notes: notesFolder, events: eventsFolder } = bookKind.folders;
  const order = `${content}/_order.yaml`;
  const novel: Book = {
    kind: bookKind,
    manifest: file,
    config: undefined,
    entityTypes: [...bookKind.entityTypes],
    relationshipTypes: [],
    levels: [],
    sections: [],
    pieces: [],
    allSections: [],
    allPieces: [],
    entities: [],
    relationships: [],
    events: [],
    notes: [],
    layouts: {},
    diagnostics,
  };

  /** Read, parse and schema-check a YAML file. Returns undefined if missing or unparseable. */
  async function yamlFile(path: string, kind: SchemaKind | string): Promise<Record<string, unknown> | undefined> {
    const text = await source.read(path);
    if (text === undefined) return undefined;
    const parsed = parseYaml(text, path);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.diagnostics.length) return undefined;
    diagnostics.push(...checkSchema(kind, parsed.data, path, bookKind));
    return isObject(parsed.data) ? parsed.data : {};
  }

  async function markdownFile(path: string, kind: SchemaKind) {
    const parsed = parseMarkdown((await source.read(path)) ?? "", path);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.diagnostics.length) return undefined;
    diagnostics.push(...checkSchema(kind, parsed.data, path, bookKind));
    return { data: isObject(parsed.data) ? parsed.data : {}, body: parsed.body, bodyLine: parsed.bodyLine };
  }

  // The manifest: don't guess at a newer format, or at a kind this build doesn't ship. Report only that.
  if (manifest && manifest.version > (file === MANIFEST ? SCHEMA_VERSION : EVENT_FILES_FORMAT)) {
    novel.diagnostics = [error("E_SCHEMA_VERSION", file, manifest.version > SCHEMA_VERSION
      ? `schema_version ${manifest.version} is newer than this validator supports (${SCHEMA_VERSION}); update Writer`
      : `schema_version ${manifest.version} doesn't belong in ${NOVEL_MANIFEST}: format ${manifest.version} keeps a book's settings in ${MANIFEST}`)];
    return novel;
  }
  if (manifest?.file === MANIFEST && !kind && !named) {
    novel.diagnostics = [error("E_UNKNOWN_KIND", file, manifest.kind === undefined
      ? `${MANIFEST} doesn't say what kind of book this is (kind)`
      : `This is a book of a kind this Writer doesn't know (“${manifest.kind}”); update Writer`)];
    return novel;
  }
  const config = await yamlFile(file, file === MANIFEST ? "book" : "novel");
  if (config === undefined) {
    if (!manifest) diagnostics.push(error("E_MISSING_FILE", NOVEL_MANIFEST, `${NOVEL_MANIFEST} is missing`));
  } else {
    novel.config = config as unknown as NovelFile;
    novel.entityTypes = entityTypes(config["entity_types"], diagnostics, bookKind, file);
    novel.relationshipTypes = objList(config["relationship_types"]).filter((t) => str(t["key"])) as unknown as RelationshipTypeFile[];
  }

  await loadManuscript();
  await loadBible();
  await loadNotes();

  const layouts = await yamlFile("diagrams/layouts.yaml", "layouts");
  if (layouts && isObject(layouts["layouts"])) novel.layouts = layouts["layouts"] as Book["layouts"];

  // How it's compiled (heffrey78/gh-writer#19): the front and back matter a preset names must be there.
  const compile = await yamlFile("compile.yaml", "compile");
  if (compile && isObject(compile["presets"])) {
    novel.compile = compile as unknown as CompileFile;
    for (const [name, preset] of Object.entries(novel.compile.presets)) {
      for (const path of [...(preset.front ?? []), ...(preset.back ?? [])]) {
        if ((await source.read(path)) === undefined) diagnostics.push(error("E_MISSING_FILE", "compile.yaml", `Preset “${name}” names ${path}, which is missing`));
      }
    }
  }

  return novel;

  async function loadManuscript() {
    const { levels, piece } = bookKind;
    const label = (key: string) => levels.find((l) => l.key === key)!.label;
    const innermost = levels.at(-1)!;
    const orderData = await yamlFile(order, "manuscript-order");
    if (orderData === undefined && (await source.read(order)) === undefined) {
      diagnostics.push(error("E_MISSING_FILE", order, `${order} is missing`));
    }
    // The level the book starts at is the one its _order.yaml lists; it has every level after it.
    const start = startLevels(bookKind).find((l) => orderData && l.list in orderData);
    novel.levels = start ? levels.slice(levels.indexOf(start)).map((l) => l.key) : [];
    const misplacedPiece = `${piece.label} files must be inside a ${innermost.label.toLowerCase()} folder`;

    const top: Section[] = [];
    for (const entry of await source.list(content)) {
      const path = joinPath(content, entry.name);
      if (!entry.dir) {
        if (entry.name.endsWith(".md")) diagnostics.push(error("E_MISPLACED", path, misplacedPiece));
        continue;
      }
      const names = new Set((await source.list(path)).map((c) => c.name));
      const level = levels.find((l) => names.has(`_${l.key}.yaml`));
      if (!level) {
        diagnostics.push(error("E_MISPLACED", path, `Folder has ${noneOf(levels.map((l) => `_${l.key}.yaml`))}`));
        continue;
      }
      const section = await loadSection(path, level, undefined);
      if (section) top.push(section);
    }

    if (start) {
      for (const s of top.filter((s) => s.level !== start.key)) {
        const deeper = levels.findIndex((l) => l.key === s.level) > levels.indexOf(start);
        diagnostics.push(error("E_MISPLACED", s.file, deeper
          ? `${label(s.level)} folder at the top level of a book organised in ${start.list}`
          : `${label(s.level)} folder in a book organised directly in ${start.list}`));
      }
    }

    // Reading order: each listed section, then what it lists, all the way down.
    const listed = new Set<Section>();
    const visit = (s: Section) => {
      listed.add(s);
      novel.sections.push(s);
      const pieces = childrenOf(s);
      if (pieces.kind === "pieces") novel.pieces.push(...pieces.ordered);
      else pieces.ordered.forEach(visit);
    };
    if (start) {
      const ordered = resolveOrder(strList(orderData?.[start.list]), top.filter((s) => s.level === start.key), order, `/${start.list}`, start.label.toLowerCase());
      ordered.forEach(visit);
    }
    // Sections that aren't listed still need what they hold checked.
    for (const s of novel.allSections) if (!listed.has(s)) childrenOf(s);
    novel.pieces.forEach((p, i) => (p.position = i));

    /** What a section holds, in the order its file lists (reporting what's amiss there). */
    function childrenOf(s: Section): { kind: "pieces"; ordered: Piece[] } | { kind: "sections"; ordered: Section[] } {
      const at = levels.findIndex((l) => l.key === s.level);
      if (s.level === innermost.key) {
        const present = novel.allPieces.filter((p) => p.sectionId === s.id && p.file.startsWith(`${s.dir}/`));
        return { kind: "pieces", ordered: resolveOrder(s.childIds, present, s.file, `/${piece.list}`, piece.label.toLowerCase()) };
      }
      const next = levels[at + 1]!;
      const present = novel.allSections.filter((c) => c.parentId === s.id);
      return { kind: "sections", ordered: resolveOrder(s.childIds, present, s.file, `/${next.list}`, next.label.toLowerCase()) };
    }

    /** A section's folder: its _<level>.yaml, then what's in it. Undefined when its file can't be read. */
    async function loadSection(dir: string, level: LevelDef, parentId: string | undefined): Promise<Section | undefined> {
      const file = joinPath(dir, `_${level.key}.yaml`);
      const data = await yamlFile(file, level.key);
      if (!data || !str(data["id"])) return undefined;
      const inner = level === innermost;
      const next = levels[levels.indexOf(level) + 1];
      const section: Section = {
        id: str(data["id"])!,
        level: level.key,
        title: level.titled ? (str(data["title"]) ?? "") : str(data["title"]),
        synopsis: str(data["synopsis"]),
        childIds: strList(data[inner ? piece.list : next!.list]),
        parentId,
        dir,
        file,
      };
      novel.allSections.push(section);
      for (const entry of await source.list(dir)) {
        const path = joinPath(dir, entry.name);
        if (inner) {
          if (entry.dir) diagnostics.push(error("E_MISPLACED", path, `${capitalize(level.list)} cannot contain folders`));
          else if (entry.name.endsWith(".md")) await loadScene(path, section.id);
        } else if (entry.dir) {
          if ((await source.list(path)).some((c) => c.name === `_${next!.key}.yaml`)) await loadSection(path, next!, section.id);
          else diagnostics.push(error("E_MISPLACED", path, `Folder inside a ${level.label.toLowerCase()} has no _${next!.key}.yaml`));
        } else if (entry.name.endsWith(".md")) {
          diagnostics.push(error("E_MISPLACED", path, misplacedPiece));
        }
      }
      return section;
    }
  }

  async function loadScene(file: string, chapterId: string) {
    const md = await markdownFile(file, "scene");
    if (!md || !str(md.data["id"])) return;
    const d = md.data;
    const status = str(d["status"]);
    const scene: Piece = {
      id: str(d["id"])!,
      title: str(d["title"]) ?? "",
      synopsis: str(d["synopsis"]),
      status: bookKind.statuses.some((s) => s.key === status) ? (status as PieceStatus) : bookKind.statuses[0]!.key,
      pov: str(d["pov"]),
      characters: strList(d["characters"]),
      locations: strList(d["locations"]),
      entities: strList(d["entities"]),
      plotlines: refList(d["plotlines"]).map((r): PlotlineRef => ({
        id: r.id,
        weight: r.obj?.["weight"] === "minor" ? "minor" : "major",
        beat: str(r.obj?.["beat"]),
      })),
      themes: refList(d["themes"]).map((r): ThemeRef => ({
        id: r.id,
        strength: typeof r.obj?.["strength"] === "number" ? r.obj["strength"] : undefined,
        note: str(r.obj?.["note"]),
      })),
      when: storyTime(d["when"]),
      duration: str(d["duration"]),
      tags: strList(d["tags"]),
      sectionId: chapterId,
      position: -1,
      body: md.body,
      bodyLine: md.bodyLine,
      file,
    };
    novel.allPieces.push(scene);
  }

  async function loadBible() {
    for (const entry of await source.list(codex)) {
      const path = joinPath(codex, entry.name);
      if (!entry.dir) continue;
      if (entry.name === eventsFolder) {
        for (const f of await source.list(path)) if (!f.dir && f.name.endsWith(".md")) await loadEvent(joinPath(path, f.name));
        continue;
      }
      const type = novel.entityTypes.find((t) => t.folder === entry.name);
      const files = (await source.list(path)).filter((f) => !f.dir && f.name.endsWith(".md"));
      if (!type) {
        if (files.length) diagnostics.push(error("E_UNKNOWN_FOLDER", path, `${codex}/${entry.name} is not the folder of any entity type`));
        continue;
      }
      for (const f of files) await loadEntity(joinPath(path, f.name), type.key);
    }

    const relationshipsFile = `${codex}/relationships.yaml`;
    const rels = await yamlFile(relationshipsFile, "relationships");
    objList(rels?.["relationships"]).forEach((r, index) => {
      const id = str(r["id"]), from = str(r["from"]), to = str(r["to"]), type = str(r["type"]);
      if (!id || !from || !to || !type) return;
      const rel: Relationship = { id, from, to, type, file: relationshipsFile, index };
      const since = str(r["since"]), until = str(r["until"]), note = str(r["note"]);
      if (since) rel.since = since;
      if (until) rel.until = until;
      if (note) rel.note = note;
      novel.relationships.push(rel);
    });

    const eventsYaml = `${codex}/events.yaml`;
    const events = await yamlFile(eventsYaml, "events");
    objList(events?.["events"]).forEach((e, index) => {
      const id = str(e["id"]);
      if (!id) return;
      const ev: StoryEvent = {
        id,
        title: str(e["title"]) ?? "",
        when: storyTime(e["when"]),
        duration: str(e["duration"]),
        characters: strList(e["characters"]),
        locations: strList(e["locations"]),
        plotlines: strList(e["plotlines"]),
        body: str(e["note"]) ?? "",
        bodyLine: 0,
        file: eventsYaml,
        index,
      };
      novel.events.push(ev);
    });
  }

  /** An event file (format v2): front matter, and its note as prose. */
  async function loadEvent(file: string) {
    const md = await markdownFile(file, "event");
    if (!md || !str(md.data["id"])) return;
    const d = md.data;
    const ev: StoryEvent = {
      id: str(d["id"])!,
      title: str(d["title"]) ?? "",
      when: storyTime(d["when"]),
      duration: str(d["duration"]),
      characters: strList(d["characters"]),
      locations: strList(d["locations"]),
      plotlines: strList(d["plotlines"]),
      body: md.body,
      bodyLine: md.bodyLine,
      file,
    };
    const scene = str(d["scene"]);
    if (scene) ev.scene = scene;
    novel.events.push(ev);
  }

  /** The writer's notes (D12): notes/*.md. */
  async function loadNotes() {
    for (const f of await source.list(notesFolder)) {
      if (f.dir || !f.name.endsWith(".md")) continue;
      const file = joinPath(notesFolder, f.name);
      const md = await markdownFile(file, "note");
      if (!md || !str(md.data["id"])) continue;
      const d = md.data;
      const created = str(d["created"]), became = str(d["became"]);
      novel.notes.push({
        id: str(d["id"])!,
        title: str(d["title"]) ?? "",
        tags: strList(d["tags"]),
        scenes: strList(d["scenes"]),
        pinned: strList(d["pinned"]),
        ...(created ? { created } : {}),
        ...(became ? { became } : {}),
        body: md.body,
        bodyLine: md.bodyLine,
        file,
      });
    }
  }

  async function loadEntity(file: string, type: string) {
    const md = await markdownFile(file, "entity");
    if (!md || !str(md.data["id"])) return;
    const d = md.data;
    const fields: Entity["fields"] = {};
    if (isObject(d["fields"])) {
      for (const [k, v] of Object.entries(d["fields"])) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") fields[k] = v;
      }
    }
    novel.entities.push({
      id: str(d["id"])!,
      type,
      name: str(d["name"]) ?? "",
      aliases: strList(d["aliases"]),
      summary: str(d["summary"]),
      image: str(d["image"]),
      imageFocus: focus(d["image_focus"]),
      fields,
      tags: strList(d["tags"]),
      body: md.body,
      bodyLine: md.bodyLine,
      file,
    });
  }

  /**
   * Resolve an order list against the children found on disk: report unknown,
   * duplicate and missing entries, and return the listed children in order.
   */
  function resolveOrder<T extends { id: string; file: string }>(
    listed: string[], present: T[], orderFile: string, pointer: string, what: string,
  ): T[] {
    const byId = new Map<string, T>();
    for (const c of present) if (!byId.has(c.id)) byId.set(c.id, c);
    const seen = new Set<string>();
    const out: T[] = [];
    listed.forEach((id, i) => {
      if (seen.has(id)) {
        diagnostics.push({ ...error("E_ORDER_DUPLICATE", orderFile, `${id} is listed more than once`), pointer: `${pointer}/${i}` });
        return;
      }
      seen.add(id);
      const child = byId.get(id);
      if (!child) {
        diagnostics.push({ ...error("E_ORDER_UNKNOWN", orderFile, `Lists ${what} ${id}, which is not in this folder`), pointer: `${pointer}/${i}` });
        return;
      }
      out.push(child);
    });
    for (const c of present) {
      if (!seen.has(c.id)) diagnostics.push(error("E_ORDER_MISSING", c.file, `${capitalize(what)} ${c.id} is not listed in ${orderFile}`));
    }
    return out;
  }
}

function entityTypes(raw: unknown, diagnostics: Diagnostic[], kind: BookKind, file: string): EntityTypeDef[] {
  const types = [...kind.entityTypes];
  const reserved = reservedPrefixes(kind);
  objList(raw).forEach((t, i) => {
    const key = str(t["key"]), prefix = str(t["prefix"]), folder = str(t["folder"]);
    if (!key || !prefix || !folder) return;
    const clash =
      types.find((x) => x.key === key) ? `key "${key}"` :
      reserved.has(prefix) || types.find((x) => x.prefix === prefix) ? `prefix "${prefix}"` :
      folder === kind.folders.events || types.find((x) => x.folder === folder) ? `folder "${folder}"` : undefined;
    if (clash) {
      diagnostics.push({ ...error("E_ENTITY_TYPE", file, `Entity type ${clash} is reserved or already used`), pointer: `/entity_types/${i}` });
      return;
    }
    types.push({ key, prefix, folder, label: str(t["label"]) ?? key, color: str(t["color"]), builtin: false });
  });
  return types;
}

function error(code: string, file: string, message: string): Diagnostic {
  return { severity: "error", code, file, message };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** A focal point: two fractions, x and y; anything else (the schema reports it) is none. */
function focus(v: unknown): [number, number] | undefined {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === "number" && n >= 0 && n <= 1)) return undefined;
  return [v[0], v[1]];
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function objList(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter(isObject) : [];
}

/** A list of IDs given either as plain strings or as objects with an id. */
function refList(v: unknown): { id: string; obj?: Record<string, unknown> }[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    if (typeof x === "string") return [{ id: x }];
    if (isObject(x) && typeof x["id"] === "string") return [{ id: x["id"], obj: x }];
    return [];
  });
}

function storyTime(v: unknown): StoryTime | undefined {
  if (!isObject(v)) return undefined;
  if (typeof v["at"] === "string") return { at: v["at"] };
  if (typeof v["day"] === "number") return typeof v["time"] === "string" ? { day: v["day"], time: v["time"] } : { day: v["day"] };
  return undefined;
}

/** "neither _part.yaml nor _chapter.yaml", "no _chapter.yaml", "none of _a.yaml, _b.yaml or _c.yaml". */
function noneOf(names: string[]): string {
  if (names.length === 1) return `no ${names[0]}`;
  if (names.length === 2) return `neither ${names[0]} nor ${names[1]}`;
  return `none of ${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
