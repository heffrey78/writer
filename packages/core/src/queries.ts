import { entryIds } from "./fields.ts";
import { mentions, pieceById, type Note, type Book, type ModuleRecord, type Relationship, type Piece } from "./model.ts";
import { recordType } from "./modules.ts";

/** How a scene refers to an entity: by a field of its kind, by key ("pov", "characters"), or a mention in its prose. */
export type SceneLink = string;

export interface Backlinks {
  /** Scenes that name the entity, in reading order (scenes outside the order last), with how. */
  scenes: { scene: Piece; via: SceneLink[] }[];
  /** Relationships it takes part in, from either end. */
  relationships: Relationship[];
  /** The modules' records that name it in their fields: off-page events it's part of. */
  records: ModuleRecord[];
}

/** Everywhere an entity is referred to: scene front matter, mentions in prose, relationships, the modules' records. */
export function backlinks(novel: Book, id: string): Backlinks {
  const ordered = [...novel.pieces, ...novel.allPieces.filter((s) => s.position < 0)];
  const scenes: Backlinks["scenes"] = [];
  for (const scene of ordered) {
    const via: SceneLink[] = novel.kind.fields.filter((f) => entryIds(f, scene.fields[f.key]).includes(id)).map((f) => f.key);
    if (mentions(scene.body).some((m) => m.id === id)) via.push("mention");
    if (via.length) scenes.push({ scene, via });
  }
  return {
    scenes,
    relationships: novel.relationships.filter((r) => r.from === id || r.to === id),
    records: novel.moduleRecords.filter((r) => (recordType(novel.kind, r.type)?.fields(novel.kind) ?? []).some((f) => entryIds(f, r.fields[f.key]).includes(id))),
  };
}

/** Prose that mentions a record, by what it is: a piece, an entry, a module's record (by its type's key, "event"), a note. */
export interface MentionedIn {
  kind: string;
  id: string;
  title: string;
  /** A piece's: how it refers to the record ("mention"). */
  via?: string[];
}

/** The prose that mentions a record (pieces, entries, modules' records, notes), for a delete to list. A record's own prose doesn't count. */
export function mentionsOf(novel: Book, id: string): MentionedIn[] {
  const mentioned = (body: string) => mentions(body).some((m) => m.id === id);
  return [
    ...novel.allPieces.filter((s) => mentioned(s.body)).map((s) => ({ kind: "scene", id: s.id, title: s.title, via: ["mention"] })),
    ...novel.entities.filter((e) => e.id !== id && mentioned(e.body)).map((e) => ({ kind: "entity", id: e.id, title: e.name })),
    ...novel.moduleRecords.filter((r) => r.id !== id && mentioned(r.body)).map((r) => ({ kind: r.type, id: r.id, title: r.title })),
    ...novel.notes.filter((n) => mentioned(n.body)).map((n) => ({ kind: "note", id: n.id, title: n.title })),
  ];
}

export interface RelationshipSpan {
  /** The span starts at this scene (null: the book's start)… */
  from: string | null;
  /** …and runs up to, not including, this one (null: the book's end). */
  until: string | null;
  /** The relationships holding throughout it. */
  relationships: Relationship[];
}

/**
 * How an entity's relationships (or, with `other`, those between the two) change through the book:
 * consecutive spans of reading order, split at every scene where one starts or ends. Bounds that
 * don't resolve to an ordered scene are ignored, as in relationshipsAt.
 */
export function relationshipHistory(novel: Book, id: string, other?: string): RelationshipSpan[] {
  const involved = novel.relationships.filter(
    (r) => (r.from === id || r.to === id) && (other === undefined || r.from === other || r.to === other),
  );
  const position = (sceneId: string | undefined) => {
    const p = sceneId === undefined ? undefined : pieceById(novel, sceneId)?.position;
    return p === undefined || p < 0 ? undefined : p;
  };
  const cuts = [...new Set(involved.flatMap((r) => [position(r.since), position(r.until)]).filter((p): p is number => p !== undefined))].sort((a, b) => a - b);
  const starts = [undefined, ...cuts];
  return starts.map((start, i) => {
    const end = cuts[i];
    const holds = involved.filter((r) => {
      const since = position(r.since);
      const until = position(r.until);
      const from = start ?? -1;
      return (since === undefined || since <= from) && (until === undefined || from < until);
    });
    return {
      from: start === undefined ? null : novel.pieces[start]!.id,
      until: end === undefined ? null : novel.pieces[end]!.id,
      relationships: holds,
    };
  });
}

/** The writer's notes that mention an entry or an event (heffrey78/gh-writer#205), newest first. */
export function notesMentioning(novel: Book, id: string): Note[] {
  return novel.notes
    .filter((n) => mentions(n.body).some((m) => m.id === id))
    .sort((a, b) => (b.created ?? "").localeCompare(a.created ?? "") || a.title.localeCompare(b.title));
}

/** A scene's notes (heffrey78/gh-writer#222): the one pinned there first, then newest first. */
export function notesOfScene(novel: Book, sceneId: string): Note[] {
  const pinned = (n: Note) => (n.pinned.includes(sceneId) ? 1 : 0);
  return novel.notes
    .filter((n) => n.scenes.includes(sceneId))
    .sort((a, b) => pinned(b) - pinned(a) || (b.created ?? "").localeCompare(a.created ?? "") || a.title.localeCompare(b.title));
}
