import { editFrontMatter, EVENT_FILES_FORMAT, indexById, mentionsOf, proseText, storyTimeField, uniqueId, vocabulary, type Book } from "@writer/core";
import {
  body,
  clean,
  hashText,
  operation,
  OperationError,
  required,
  withProse,
  type BibleOperations,
  type Env,
  type FileWrite,
  type ManuscriptOperations,
  type OperationResult,
  type ServerModule,
} from "@writer/server/engine";
import { EVENT, eventFields, eventFile, eventsOf, type EventFields } from "../core/index.ts";

/** A commit message's prefix: the kind's short name for its codex, "Bible". */
const codex = (novel: Book) => vocabulary(novel.kind).codex.Short;

/** An event change needs events as files (format 2, D11): a novel in format v1 moves first, or is asked. */
const moving = (migrate: boolean) => ({ format: EVENT_FILES_FORMAT, migrate, needs: `Off-page events are kept differently in format v${EVENT_FILES_FORMAT}: the novel must move to it first.` });

/**
 * Off-page events' changes (#33), each one commit: an event file of its own in the codex's events
 * folder, its note as the prose (D11). In a novel in format v1 each change is refused with
 * NEEDS_MIGRATION, unless `migrate`, which moves the novel to v2 in the same commit.
 */
export class EventOperations {
  readonly #bible: BibleOperations;

  constructor(bible: BibleOperations) {
    this.#bible = bible;
  }

  /** Add an off-page event: a file of its own, bible/events/<slug>.md. */
  create(fields: EventFields, migrate = false): Promise<OperationResult & { id: string; file: string }> {
    return this.#bible.change(async (novel) => {
      const title = required(fields.title, "title");
      checkFields(novel, fields);
      const id = uniqueId(EVENT.prefix, new Set(indexById(novel).keys()));
      const { note, ...front } = clean({ ...fields, title });
      const file = this.#bible.recordFileName(novel, EVENT, title);
      return { writes: [{ path: file, content: eventFile({ id, ...front }, note), base: null }], message: `${codex(novel)}: add event “${title}”`, extra: { id, file } };
    }, moving(migrate));
  }

  /**
   * Change an event's fields (null removes one; `note` replaces its prose). A new title moves its file to
   * match. `base`, when given, is the hash of the file the change was made from.
   */
  update(id: string, changes: EventFields, { base, migrate = false }: { base?: string; migrate?: boolean } = {}): Promise<OperationResult & { file: string }> {
    return this.#bible.change(async (novel, read, migrated) => {
      const event = find(novel, id);
      if (changes.title !== undefined) required(changes.title, "title");
      checkFields(novel, changes);
      const { note, ...fields } = changes;
      const tidy = Object.entries(fields).map(([key, v]) => (v === null || v === "" || (Array.isArray(v) && !v.length) ? { path: [key], remove: true as const } : { path: [key], value: v }));
      const text = (await read(event.file)) ?? "";
      if (base !== undefined && !migrated.has(event.file) && hashText(text) !== base) throw new OperationError("STALE", `“${event.title}” changed since it was read.`, { path: event.file });
      let content = editFrontMatter(text, tidy);
      if (note !== undefined) content = withProse(content, note ?? "");
      const check = migrated.has(event.file) ? {} : { base: hashText(text) };
      const title = changes.title?.trim() || event.title;
      const renamed = changes.title && changes.title.trim() !== event.title ? this.#bible.recordFileName(novel, EVENT, title, event.file) : event.file;
      const writes: FileWrite[] = renamed === event.file ? [{ path: event.file, content, ...check }] : [{ path: event.file, content: null, ...check }, { path: renamed, content, base: null }];
      const message = renamed === event.file ? `${codex(novel)}: edit event “${title}”` : `${codex(novel)}: rename event “${event.title}” to “${title}”`;
      return { writes, message, extra: { file: renamed } };
    }, moving(migrate));
  }

  /**
   * Remove an event's file. If prose mentions it (scenes, entries, other events), it's refused with every
   * mention unless `confirm`; they're then left for the validator to report.
   */
  delete(id: string, { base, confirm = false, migrate = false }: { base?: string; confirm?: boolean; migrate?: boolean } = {}): Promise<OperationResult> {
    return this.#bible.change(async (novel, read, migrated) => {
      const event = find(novel, id);
      const references = mentionsOf(novel, id);
      if (references.length && !confirm) {
        throw new OperationError("REFERENCED", `“${event.title}” is mentioned in ${references.length} place${references.length === 1 ? "" : "s"}.`, { references });
      }
      const text = (await read(event.file)) ?? "";
      if (base !== undefined && !migrated.has(event.file) && hashText(text) !== base) throw new OperationError("STALE", `“${event.title}” changed since it was read.`, { path: event.file });
      return { writes: [{ path: event.file, content: null, ...(migrated.has(event.file) ? {} : { base: hashText(text) }) }], message: `${codex(novel)}: remove event “${event.title}”`, extra: {} };
    }, moving(migrate));
  }

  /**
   * Write an off-page event as a scene (heffrey78/gh-writer#165): a new scene at the end of `chapter` with the event's
   * title, time, duration, characters, locations and plotlines, and its note as the synopsis. The event
   * is kept, its `scene` naming the new one, or removed: refused (REFERENCED) while prose mentions it.
   */
  writeAsScene(id: string, { chapter, keep, migrate = false }: { chapter: string; keep: boolean; migrate?: boolean }, manuscript: ManuscriptOperations): Promise<OperationResult & { scene: string; file: string }> {
    return this.#bible.change(async (novel, read) => {
      const event = find(novel, id);
      if (!keep) {
        const references = mentionsOf(novel, id);
        if (references.length) throw new OperationError("REFERENCED", `“${event.title}” is mentioned in ${references.length} place${references.length === 1 ? "" : "s"}, so it's kept.`, { references });
      }
      const synopsis = proseText(event.body).replace(/\s+/g, " ").trim();
      // Its time goes to the kind's story-time field.
      const time = storyTimeField(novel.kind);
      const front = clean({ synopsis, characters: event.characters, locations: event.locations, plotlines: event.plotlines, ...(time ? { [time.key]: event.when, [time.type.durationKey]: event.duration } : {}) });
      const scene = await manuscript.sceneWrites(novel, chapter, { title: event.title, front });
      const text = (await read(event.file)) ?? "";
      const writes: FileWrite[] = [...scene.writes, keep ? { path: event.file, content: editFrontMatter(text, [{ path: ["scene"], value: scene.id }]) } : { path: event.file, content: null }];
      return { writes, message: `${vocabulary(novel.kind).content.One}: write “${event.title}” as ${vocabulary(novel.kind).piece.a}${keep ? "" : ", removing the event"}`, extra: { scene: scene.id, file: scene.file } };
    }, moving(migrate));
  }

  /** Make a note an off-page event (heffrey78/gh-writer#205): its title, and its prose as the event's note. The note is kept, naming it, or removed. */
  fromNote(noteId: string, { keep, migrate = false }: { keep: boolean; migrate?: boolean }): Promise<OperationResult & { id: string; file: string }> {
    return this.#bible.change(async (novel, read) => {
      const note = this.#bible.findNote(novel, noteId);
      const made = uniqueId(EVENT.prefix, new Set(indexById(novel).keys()));
      const file = this.#bible.recordFileName(novel, EVENT, note.title);
      const writes = [{ path: file, content: eventFile({ id: made, title: note.title }, note.body), base: null }, await this.#bible.noteBecame(novel, read, noteId, made, keep)];
      return { writes, message: `Notes: promote “${note.title}” to an off-page event${keep ? "" : ", removing the note"}`, extra: { id: made, file } };
    }, moving(migrate));
  }
}

function find(novel: Book, id: string) {
  const event = eventsOf(novel).find((e) => e.id === id);
  if (!event) throw new OperationError("NOT_FOUND", `No event “${id}”.`);
  return event;
}

/** A time, a duration and entries of the right types, where given. */
function checkFields(novel: Book, f: EventFields): void {
  const w = f.when;
  if (w) {
    const ok = "at" in w ? /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(w.at) : Number.isInteger(w.day) && (w.time === undefined || /^([01]\d|2[0-3]):[0-5]\d$/.test(w.time));
    if (!ok) throw new OperationError("BAD_REQUEST", "A time is a date (YYYY-MM-DD, optionally THH:MM) or a day of the story with an optional HH:MM.");
  }
  if (f.duration && !/^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/.test(f.duration)) {
    throw new OperationError("BAD_REQUEST", "A duration is ISO 8601, like PT45M or P2D.");
  }
  if (f.scene && !novel.allPieces.some((sc) => sc.id === f.scene)) throw new OperationError("BAD_REQUEST", `No ${vocabulary(novel.kind).piece.one} “${f.scene}”.`);
  // Its lists' entries, of each list's type.
  const lists = f as Partial<Record<string, string[] | null>>;
  for (const field of eventFields(novel.kind)) {
    if (!("entityType" in field.type)) continue;
    const type = field.type.entityType;
    for (const id of lists[field.key] ?? []) {
      if (!novel.entities.some((e) => e.id === id && e.type === type)) throw new OperationError("BAD_REQUEST", `No ${type} “${id}”.`);
    }
  }
}

/**
 * Off-page events' server half (#33), under /api/novels/:id/off-page-events:
 *
 * POST  /events                { title, when?, duration?, characters?, locations?, plotlines?, scene?, note?, migrate? } → 201 { id, file, commit }
 * PATCH /events/:event         { changes, base?, migrate? } (null removes a field; note replaces the prose) → { file, commit }
 * POST  /events/:event/delete  { base?, confirm?, migrate? } → { commit }, or 409 REFERENCED { references }
 * POST  /events/:event/scene   { chapter, keep, migrate? } → 201 { scene, file }: written as a scene at the chapter's end; kept (naming it) or removed
 * POST  /notes/:note           { keep, migrate? } → 201 { id, file }: the note made into an event, kept (naming it) or removed
 *       (each: a novel in format v1 is 409 NEEDS_MIGRATION { from, to } unless migrate, which moves it to v2 in the same commit)
 */
export const offPageEventsServer: ServerModule = {
  id: "off-page-events",
  routes(routes) {
    const events = (c: { var: Env["Variables"] }) => new EventOperations(c.var.ws.bible);
    routes.post("/events", async (c) => {
      const { migrate, ...fields } = await body(c);
      return operation(c, () => events(c).create(fields as never, migrate === true), 201);
    });
    routes.patch("/events/:event", async (c) => {
      const { changes, base, migrate } = await body(c);
      return operation(c, () => events(c).update(c.req.param("event"), (changes ?? {}) as never, { ...(typeof base === "string" ? { base } : {}), migrate: migrate === true }));
    });
    routes.post("/events/:event/delete", async (c) => {
      const { base, confirm, migrate } = await body(c);
      return operation(c, () => events(c).delete(c.req.param("event"), { ...(typeof base === "string" ? { base } : {}), confirm: confirm === true, migrate: migrate === true }));
    });
    routes.post("/events/:event/scene", async (c) => {
      const { chapter, keep, migrate } = await body(c);
      return operation(c, () => events(c).writeAsScene(c.req.param("event"), { chapter: String(chapter ?? ""), keep: keep === true, migrate: migrate === true }, c.var.ws.manuscript), 201);
    });
    routes.post("/notes/:note", async (c) => {
      const { keep, migrate } = await body(c);
      return operation(c, () => events(c).fromNote(c.req.param("note"), { keep: keep === true, migrate: migrate === true }), 201);
    });
  },
};
