import { editYaml, slugify, uniqueFileName, type YamlEdit } from "./edit.ts";
import { kindByKey, V2_KIND } from "./kinds.ts";
import { EVENT_FILES_FORMAT, MANIFEST, NOVEL_MANIFEST, readManifest, SCHEMA_VERSION } from "./manifest.ts";
import { parseYaml } from "./parse.ts";
import type { FileSource } from "./source.ts";

/*
 * Moving a book to a newer format. Format 2 gives each off-page event a file of its own (D11),
 * bible/events/<slug>.md, with its note as prose; bible/events.yaml goes. Format 3 moves a novel's
 * novel.yaml to book.yaml, which names the kind of book it is (D15). The result is the files to
 * write, for the caller to commit as one change.
 */

/** A file to write, or to remove (content null). */
export interface MigrationWrite {
  path: string;
  content: string | null;
}

export type Migration =
  | { status: "current" }
  | { status: "refused"; reason: string }
  | { status: "migrate"; from: number; to: number; writes: MigrationWrite[]; message: string };

const EVENTS_YAML = "bible/events.yaml";
/** An event's fields in the order an event file lists them; `note` becomes the prose. */
const EVENT_FIELDS = ["id", "title", "when", "duration", "characters", "locations", "plotlines"] as const;

/**
 * What moving the book in `source` to format `to` (the newest by default) would write, or why it
 * can't be. Format 2 gives each off-page event a file of its own (D11); format 3 moves novel.yaml to
 * book.yaml, naming the kind of book it is (D15). An event change needs only format 2.
 */
export async function migration(source: FileSource, to = SCHEMA_VERSION): Promise<Migration> {
  if ((await source.read(MANIFEST)) !== undefined) {
    const manifest = await readManifest(source);
    if (manifest!.version > SCHEMA_VERSION) return { status: "refused", reason: `This book is in format v${manifest!.version}, newer than this Writer (v${SCHEMA_VERSION}).` };
    return { status: "current" };
  }
  // Only novels were ever in formats 1 and 2.
  const { codex, events: eventsFolder } = kindByKey(V2_KIND).folders;
  const novelText = await source.read(NOVEL_MANIFEST);
  if (novelText === undefined) return { status: "refused", reason: `There's no ${MANIFEST} or ${NOVEL_MANIFEST} here.` };
  const novel = parseYaml(novelText, NOVEL_MANIFEST);
  if (novel.diagnostics.length || !isObject(novel.data)) return { status: "refused", reason: `${NOVEL_MANIFEST} can't be read: fix it first (writer validate).` };
  const from = typeof novel.data["schema_version"] === "number" ? novel.data["schema_version"] : 1;
  if (from > EVENT_FILES_FORMAT) return { status: "refused", reason: `${NOVEL_MANIFEST} says format v${from}, which keeps a book's settings in ${MANIFEST}: fix it first (writer validate).` };
  if (from >= to) return { status: "current" };

  const writes: MigrationWrite[] = [];
  const steps: string[] = [];
  let manifest = novelText;
  if (from < EVENT_FILES_FORMAT) {
    const types = Array.isArray(novel.data["entity_types"]) ? novel.data["entity_types"].filter(isObject) : [];
    const clash = types.find((t) => t["folder"] === eventsFolder);
    if (clash) {
      return {
        status: "refused",
        reason: `The entry type “${String(clash["label"] ?? clash["key"])}” keeps its entries in ${codex}/${eventsFolder}/, where format v2 keeps off-page events. Give that type another folder (in ${NOVEL_MANIFEST}, and move its files), then migrate.`,
      };
    }
    const eventsText = await source.read(EVENTS_YAML);
    if (eventsText !== undefined) {
      const parsed = parseYaml(eventsText, EVENTS_YAML);
      if (parsed.diagnostics.length) return { status: "refused", reason: `${EVENTS_YAML} can't be read: fix it first (writer validate).` };
      const list = isObject(parsed.data) && Array.isArray(parsed.data["events"]) ? parsed.data["events"] : [];
      const folder = `${codex}/${eventsFolder}`;
      const taken = new Set((await source.list(folder)).map((e) => e.name));
      for (const item of list) {
        if (!isObject(item) || typeof item["id"] !== "string") return { status: "refused", reason: `${EVENTS_YAML} has an event without an ID: fix it first (writer validate).` };
        const title = typeof item["title"] === "string" ? item["title"] : item["id"];
        const name = uniqueFileName(slugify(title), ".md", taken);
        taken.add(name);
        writes.push({ path: `${folder}/${name}`, content: eventFile(item) });
      }
      writes.push({ path: EVENTS_YAML, content: null });
    }
    steps.push("off-page events as files");
  }
  manifest = editYaml(manifest, [{ path: ["schema_version"], value: to }]);
  if (to >= SCHEMA_VERSION) {
    // The settings as they were, every byte, in book.yaml, which says what kind of book this is.
    const at = /^schema_version:.*(?:\r?\n|$)/m.exec(manifest);
    manifest = at ? manifest.slice(0, at.index + at[0].length) + `kind: ${V2_KIND}\n` + manifest.slice(at.index + at[0].length) : `kind: ${V2_KIND}\n${manifest}`;
    writes.push({ path: NOVEL_MANIFEST, content: null }, { path: MANIFEST, content: manifest });
    steps.push(`the book's settings in ${MANIFEST}, naming its kind`);
  } else {
    writes.push({ path: NOVEL_MANIFEST, content: manifest });
  }
  return { status: "migrate", from, to, writes, message: `Format v${to}: ${steps.join(", and ")}` };
}

/** An event file: its fields as front matter, and its note as the prose below. */
export function eventFile(event: Record<string, unknown>, note = event["note"]): string {
  // Its fields in order, then any others it has (never lost), all but the note.
  const keys = [...EVENT_FIELDS, ...Object.keys(event).filter((k) => !(EVENT_FIELDS as readonly string[]).includes(k))];
  const edits: YamlEdit[] = keys.flatMap((k) => (k === "note" || event[k] === undefined || event[k] === null ? [] : [{ path: [k], value: event[k] }]));
  const front = editYaml("", edits);
  const prose = typeof note === "string" && note.trim() ? `\n${note.trim()}\n` : "";
  return `---\n${front}---\n${prose}`;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
