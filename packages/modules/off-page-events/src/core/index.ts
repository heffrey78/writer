import {
  defineModule,
  editYaml,
  EVENT_FILES_FORMAT,
  NOVEL_MANIFEST,
  parseYaml,
  slugify,
  storyTimeField,
  storyTimeValue,
  uniqueFileName,
  type Book,
  type BookKind,
  type BookModule,
  type FieldDef,
  type ModuleRecord,
  type Piece,
  type RecordTypeDef,
  type StoryTime,
  type YamlEdit,
} from "@writer/core";
import { sceneNeighbours, storyTimeline } from "@writer/module-story-time/core";
import eventSchema from "../../schemas/event.schema.json" with { type: "json" };
import eventsSchema from "../../schemas/events.schema.json" with { type: "json" };

/*
 * Off-page events (D14, #33): backstory, and what happens between the pieces, each a file of its own
 * in the codex (bible/events/<slug>.md in a novel), placed in story time among the pieces. Prose may
 * mention one, as it does an entry; one can be written as a piece, and a note made into one. Format v1
 * kept them as a list in bible/events.yaml, which is still read, and moving a novel to format v2
 * gives each its file (D11). It needs story time: an event's time is what places it.
 */

/**
 * What an event names, as the format has it: its people, places and plotlines, under the keys a
 * piece's fields of the same entries have (as plain IDs here). A kind without one of them has no
 * such list on its events.
 */
export const EVENT_LISTS = ["characters", "locations", "plotlines"] as const;

/** An event's fields in the order its file lists them; its note is the prose. */
const EVENT_ORDER = ["id", "title", "when", "duration", ...EVENT_LISTS] as const;

/** An event's fields: its time (the kind's story-time field), then its lists, each as plain IDs. */
export function eventFields(kind: BookKind): FieldDef[] {
  const time = storyTimeField(kind);
  const lists = EVENT_LISTS.flatMap((key): FieldDef[] => {
    const f = kind.fields.find((x) => x.key === key);
    return f && f.type.kind === "entities" ? [{ key, label: f.label, ...(f.group ? { group: f.group } : {}), type: { kind: "entities", entityType: f.type.entityType } }] : [];
  });
  return [...(time ? [time] : []), ...lists];
}

export const EVENT: RecordTypeDef = {
  key: "event",
  prefix: "evt",
  folder: "events",
  noun: { label: "Off-page event", plural: "Off-page events", article: "an", short: "Event" },
  group: "Off the page",
  aside: "off page",
  fields: eventFields,
  pieceLinks: ["scene"],
  mentionable: true,
  schema: eventSchema,
  list: { file: "events.yaml", key: "events", body: "note", schema: eventsSchema },
};

/** An off-page event as the module reads it: a file of its own (format v2), or an item of bible/events.yaml (v1). */
export interface StoryEvent {
  id: string;
  title: string;
  when?: StoryTime;
  duration?: string;
  characters: string[];
  locations: string[];
  plotlines: string[];
  /** The piece that dramatizes it, once it's been written as one and kept. */
  scene?: string;
  /** Its note: Markdown prose with mentions (in bible/events.yaml, the one-line `note`). */
  body: string;
  bodyLine: number;
  file: string;
  /** Index within bible/events.yaml, for diagnostics; undefined for an event file. */
  index?: number;
}

/** An off-page event's fields as the app changes them (null removes one on update). */
export interface EventFields {
  title?: string;
  when?: { at: string } | { day: number; time?: string } | null;
  duration?: string | null;
  characters?: string[] | null;
  locations?: string[] | null;
  plotlines?: string[] | null;
  /** The scene that dramatizes it. */
  scene?: string | null;
  /** Its note: the prose of its file. */
  note?: string | null;
}

const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** A record of the event type, read as an event. */
export function asEvent(r: ModuleRecord): StoryEvent {
  const f = r.fields;
  const when = storyTimeValue(f["when"]);
  const index = r.pointer === undefined ? undefined : Number(r.pointer.split("/").at(-1));
  return {
    id: r.id,
    title: r.title,
    ...(when ? { when } : {}),
    ...(typeof f["duration"] === "string" ? { duration: f["duration"] } : {}),
    characters: ids(f["characters"]),
    locations: ids(f["locations"]),
    plotlines: ids(f["plotlines"]),
    ...(typeof f["scene"] === "string" ? { scene: f["scene"] } : {}),
    body: r.body,
    bodyLine: r.bodyLine,
    file: r.file,
    ...(index === undefined ? {} : { index }),
  };
}

const read = new WeakMap<Book, StoryEvent[]>();

/** The book's off-page events, as their files are found. */
export function eventsOf(book: Book): StoryEvent[] {
  let events = read.get(book);
  if (!events) {
    events = book.moduleRecords.filter((r) => r.type === EVENT.key).map(asEvent);
    read.set(book, events);
  }
  return events;
}

/** The book's off-page events in story-time order, those without a time after them. */
export function eventsInTime(book: Book): StoryEvent[] {
  const t = storyTimeline(book);
  const byId = new Map(eventsOf(book).map((e) => [e.id, e]));
  const at = (r: ModuleRecord) => (r.type === EVENT.key ? [byId.get(r.id)!] : []);
  return [...t.items.flatMap((i) => (i.kind === "record" ? at(i.record) : [])), ...t.undatedRecords.flatMap(at)];
}

/** The pieces either side of an event in story time, on its own scale. */
export const around = (book: Book, id: string): { before?: Piece; after?: Piece } => sceneNeighbours(storyTimeline(book), id);

/** An event file: its fields as front matter, and its note as the prose below. */
export function eventFile(event: Record<string, unknown>, note = event["note"]): string {
  // Its fields in order, then any others it has (never lost), all but the note.
  const keys = [...EVENT_ORDER, ...Object.keys(event).filter((k) => !(EVENT_ORDER as readonly string[]).includes(k))];
  const edits: YamlEdit[] = keys.flatMap((k) => (k === "note" || event[k] === undefined || event[k] === null ? [] : [{ path: [k], value: event[k] }]));
  const front = editYaml("", edits);
  const prose = typeof note === "string" && note.trim() ? `\n${note.trim()}\n` : "";
  return `---\n${front}---\n${prose}`;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const offPageEvents: BookModule = defineModule({
  id: "off-page-events",
  label: "Off-page events",
  needs: ["story-time"],
  records: [EVENT],
  checks: [
    {
      code: "W_EVENTS_YAML",
      severity: "warning",
      find: (book) => {
        if ((book.config?.schema_version ?? 1) < EVENT_FILES_FORMAT) return [];
        const leftover = eventsOf(book).find((e) => e.index !== undefined);
        const where = `${book.kind.folders.codex}/${EVENT.folder}/`;
        return leftover ? [{ file: leftover.file, message: `Events in ${leftover.file} are format v1's: run writer migrate to give each its own file in ${where}` }] : [];
      },
    },
  ],
  // The event a piece was written from, and kept (heffrey78/gh-writer#165).
  facts: (book, piece) => eventsOf(book).flatMap((e) => (e.scene === piece.id ? [`Dramatizes the off-page event “${e.title}”.`] : [])),
  migrations: [
    {
      format: EVENT_FILES_FORMAT,
      step: "off-page events as files",
      // Format 2 gives each event in bible/events.yaml a file of its own (D11), its note the prose; the list goes.
      async run(source, kind, manifest) {
        const { codex } = kind.folders;
        const types = Array.isArray(manifest["entity_types"]) ? manifest["entity_types"].filter(isObject) : [];
        const clash = types.find((t) => t["folder"] === EVENT.folder);
        if (clash) {
          return { refused: `The entry type “${String(clash["label"] ?? clash["key"])}” keeps its entries in ${codex}/${EVENT.folder}/, where format v2 keeps off-page events. Give that type another folder (in ${NOVEL_MANIFEST}, and move its files), then migrate.` };
        }
        const list = `${codex}/${EVENT.list!.file}`;
        const text = await source.read(list);
        if (text === undefined) return { writes: [] };
        const parsed = parseYaml(text, list);
        if (parsed.diagnostics.length) return { refused: `${list} can't be read: fix it first (writer validate).` };
        const items = isObject(parsed.data) && Array.isArray(parsed.data["events"]) ? parsed.data["events"] : [];
        const folder = `${codex}/${EVENT.folder}`;
        const taken = new Set((await source.list(folder)).map((e) => e.name));
        const writes: { path: string; content: string | null }[] = [];
        for (const item of items) {
          if (!isObject(item) || typeof item["id"] !== "string") return { refused: `${list} has an event without an ID: fix it first (writer validate).` };
          const title = typeof item["title"] === "string" ? item["title"] : item["id"];
          const name = uniqueFileName(slugify(title), ".md", taken);
          taken.add(name);
          writes.push({ path: `${folder}/${name}`, content: eventFile(item) });
        }
        writes.push({ path: list, content: null });
        return { writes };
      },
    },
  ],
});
