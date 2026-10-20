import { DEFAULT_GAP, presentIn } from "./diagrams.ts";
import { entryIds } from "./fields.ts";
import type { Book, Piece, Relationship } from "./model.ts";
import { moduleFacts } from "./modules.ts";
import { vocabulary } from "./vocabulary.ts";

/**
 * What the rest of the book says about a scene, worked out from the model (heffrey78/gh-writer#154): where it stands
 * in the book, what its kind's modules say of it (how it sits in story time), who appears for the
 * first time or comes back after a long absence, the plotlines that begin or end in it, and the relationships
 * that start or end there. Only what holds and is worth saying; nothing for a scene that isn't in
 * the reading order.
 */
export function sceneFacts(novel: Book, sceneId: string): string[] {
  const scenes = novel.pieces;
  const at = scenes.findIndex((s) => s.id === sceneId);
  if (at < 0) return [];
  const scene = scenes[at]!;
  const facts: string[] = [];
  const name = (id: string) => novel.entities.find((e) => e.id === id)?.name ?? id;
  const list = (ids: string[]) => (ids.length < 3 ? ids.map(name).join(" and ") : `${ids.slice(0, -1).map(name).join(", ")} and ${name(ids.at(-1)!)}`);

  // Where it stands in the book, in the kind's word for a piece.
  const piece = vocabulary(novel.kind).piece;
  if (scenes.length === 1) facts.push(`The book's only ${piece.one}.`);
  else if (at === 0) facts.push(`The book's first ${piece.one}.`);
  else if (at === scenes.length - 1) facts.push(`The book's last ${piece.one}.`);

  // What the kind's modules say: the off-page event it dramatizes, how it sits in story time.
  facts.push(...moduleFacts(novel, scene));

  // People (the entries of types that are people, a novel's characters): first seen here, or back after a long absence.
  const present = scenes.map((s) => presentIn(novel, s));
  const people = new Set(novel.entityTypes.filter((t) => t.is === "person").map((t) => t.key));
  const characters = [...present[at]!].filter((id) => people.has(novel.entities.find((e) => e.id === id)?.type ?? ""));
  const first = characters.filter((id) => !present.slice(0, at).some((p) => p.has(id)));
  if (first.length) facts.push(`First appearance of ${list(first)}.`);
  for (const id of characters) {
    if (first.includes(id)) continue;
    let last = at - 1;
    while (last >= 0 && !present[last]!.has(id)) last--;
    const away = at - last - 1;
    if ("scenes" in DEFAULT_GAP && away >= DEFAULT_GAP.scenes) facts.push(`${name(id)} is back after ${away} ${piece.many} away.`);
  }

  // Threads (plotlines) beginning or ending here.
  const threads = novel.kind.fields.filter((f) => f.threads);
  const threadsOf = (s: Piece) => threads.flatMap((f) => entryIds(f, s.fields[f.key]));
  for (const id of threadsOf(scene)) {
    const scenesWith = scenes.flatMap((s, i) => (threadsOf(s).includes(id) ? [i] : []));
    const begins = scenesWith[0] === at;
    const ends = scenesWith.at(-1) === at;
    if (begins && ends) facts.push(`${name(id)} begins and ends here.`);
    else if (begins) facts.push(`${name(id)} begins here.`);
    else if (ends) facts.push(`${name(id)} ends here.`);
  }

  // Relationships that start or end here.
  const said = (r: Relationship) => {
    const type = novel.relationshipTypes.find((t) => t.key === r.type);
    return `${name(r.from)}: ${(type?.label ?? r.type).toLowerCase()} ${name(r.to)}`;
  };
  for (const r of novel.relationships) {
    if (r.since === sceneId) facts.push(`Starts here: ${said(r)}.`);
    if (r.until === sceneId) facts.push(`Ends here: ${said(r)}.`);
  }
  return facts;
}
