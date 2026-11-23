import { mentions, readFrontMatter, type Book, type YamlEdit } from "@writer/core";

/**
 * The front-matter edits that list, in the piece's fields that keep up with its mentions (`mentionAdds`:
 * a novel's characters, locations and entries of the book's own types), the entries just mentioned in
 * it (in `after` but not `before`) and not listed yet. Only new mentions count: someone the author took
 * off the list stays off while the old mentions stay, and nothing is ever removed. Plotlines and
 * themes are the author's to list.
 */
export function mentionEdits(novel: Book, file: string, before: string, after: string): YamlEdit[] {
  const had = new Set(mentions(before).map((m) => m.id));
  const added = [...new Set(mentions(after).map((m) => m.id))].filter((id) => !had.has(id));
  if (!added.length) return [];
  const fm = readFrontMatter(file) ?? {};
  const fields = novel.kind.fields.filter((f) => f.mentionAdds);
  const lists = new Map(fields.map((f) => [f.key, [...asList(fm[f.key])]]));
  const kindTypes = new Set(novel.kind.entityTypes.map((t) => t.key));
  /** The field an entry of `type` is listed in: a list of its type, else (one of the book's own types) the own-entities field. */
  const fieldFor = (type: string) =>
    fields.find((f) => f.type.kind === "entities" && f.type.entityType === type) ?? (kindTypes.has(type) ? undefined : fields.find((f) => f.type.kind === "own-entities"));
  const edits: YamlEdit[] = [];
  for (const id of added) {
    // By its ID's prefix when it isn't in the model yet (just made from the @ menu).
    const type = novel.entities.find((e) => e.id === id)?.type ?? novel.entityTypes.find((t) => id.startsWith(`${t.prefix}_`))?.key;
    const key = type && fieldFor(type)?.key;
    const list = key ? lists.get(key)! : undefined;
    if (!key || !list || list.includes(id)) continue;
    edits.push(list.length ? { path: [key, list.length], value: id } : { path: [key], value: [id] });
    list.push(id);
  }
  return edits;
}

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
