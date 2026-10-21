import { defineModule, editFrontMatter, editYaml, MANIFEST, parseYaml, readFrontMatter, storyTimeValue, type Book, type BookModule, type Conversion, type FileSource, type YamlEdit } from "@writer/core";

/*
 * A novel kept as a journal, made a Journal (#39): what gh-writer's journal keepers have, a chapter for
 * each month and a scene for each day. Every ID stays (the Journal's former prefixes are the Novel's),
 * so mentions, relationships and notes still point where they did. The folders take the Journal's
 * names, the scenes' lists their fields', and each entry is dated: from its `when` where it has one,
 * else from its title where that reads as a date ("Tuesday, 10/20/2026"). What a journal has no place
 * for (a point of view, plotlines, off-page events) is refused, never dropped.
 */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const two = (n: number) => String(n).padStart(2, "0");

/** The date a title reads as, as YYYY-MM-DD: "Tuesday, 10/20/2026" (month first), "2026-10-20", "20 October 2026", "October 20, 2026". */
export function titleDate(title: string): string | undefined {
  const t = title.trim().replace(/^[a-z]+day,?\s*/i, "");
  const ymd = (y: number, m: number, d: number) => {
    const s = `${y}-${two(m)}-${two(d)}`;
    return new Date(`${s}T00:00:00Z`).toISOString().startsWith(s) ? s : undefined;
  };
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return ymd(Number(m[3]), Number(m[1]), Number(m[2]));
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i.exec(t);
  if (m && MONTHS.includes(m[2]!.toLowerCase())) return ymd(Number(m[3]), MONTHS.indexOf(m[2]!.toLowerCase()) + 1, Number(m[1]));
  m = /^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i.exec(t);
  if (m && MONTHS.includes(m[1]!.toLowerCase())) return ymd(Number(m[3]), MONTHS.indexOf(m[1]!.toLowerCase()) + 1, Number(m[2]));
  return undefined;
}

/** The Novel's entry types, and the Journal's they become. */
const TYPES: Record<string, string> = { character: "person", location: "place", theme: "value" };
/** Their folders under the index. */
const FOLDERS: Record<string, string> = { characters: "people", locations: "places", themes: "values" };
/** A scene's lists, and an entry's fields they become. */
const FIELDS: Record<string, string> = { characters: "people", locations: "places", themes: "values" };
/** The Novel's statuses, and the Journal's: done drafting is kept. */
const STATUS: Record<string, string> = { idea: "draft", outlined: "draft", drafted: "draft", revised: "kept", final: "kept" };

/** Every file under `dir`, recursively, as paths from the book's root. */
async function filesUnder(source: FileSource, dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await source.list(dir)) {
    const path = `${dir}/${e.name}`;
    if (e.dir) out.push(...(await filesUnder(source, path)));
    else out.push(path);
  }
  return out;
}

/** A front matter's top-level keys renamed (`from: to`), its layout and every other byte kept. */
function renameKeys(text: string, names: Record<string, string>): string {
  const m = /^(﻿?---[ \t]*\r?\n)([\s\S]*?)(^---[ \t]*(?:\r?\n|$))/m.exec(text);
  if (!m || m.index !== 0) return text;
  const front = m[2]!.replace(/^([a-z_]+):/gm, (all, key: string) => (names[key] ? `${names[key]}:` : all));
  return m[1] + front + m[3] + text.slice(m[0].length);
}

/** A YAML file's top-level keys renamed, every other byte kept. */
const renameTop = (text: string, names: Record<string, string>) => text.replace(/^([a-z_]+):/gm, (all, key: string) => (names[key] ? `${names[key]}:` : all));

export const toJournal: Conversion = {
  to: "journal",
  label: "Make this book a journal…",
  says:
    "It becomes a Journal: its chapters months and its scenes entries, its story bible the index of people, places and values, each entry dated (from its title where it has no date). Every ID, mention, relationship and note stays. One commit; the novel's history keeps the book as it was.",
  async run(source: FileSource, book: Book) {
    const { content, codex } = book.kind.folders;
    // What a journal has no place for: refused, never dropped.
    const pov = book.allPieces.filter((p) => p.fields["pov"]);
    if (pov.length) return { refused: `${pov.length} scene${pov.length === 1 ? " has" : "s have"} a point of view (“${pov[0]!.title}”), which a journal has no place for. Take it out (the person can stay among the characters), then convert.` };
    const threads = book.allPieces.filter((p) => Array.isArray(p.fields["plotlines"]) && (p.fields["plotlines"] as unknown[]).length);
    const plotlines = book.entities.filter((e) => e.type === "plotline");
    if (threads.length || plotlines.length) return { refused: "The novel has plotlines, which a journal has no place for. Remove them, then convert." };
    if (book.moduleRecords.length) return { refused: "The novel has off-page events, which a journal has no place for. Remove them (or write them as scenes), then convert." };
    const untitled = book.allSections.filter((s) => !s.title);
    if (untitled.length) return { refused: `A journal's months and years have titles: give ${untitled.length === 1 ? "this chapter one" : "these chapters ones"} (${untitled.map((s) => s.id).join(", ")}), then convert.` };

    const manifest = (await source.read(MANIFEST)) ?? "";
    const config = (parseYaml(manifest, MANIFEST).data ?? {}) as { relationship_types?: { key?: string; from_types?: string[]; to_types?: string[] }[] };
    const used = new Set(book.relationships.map((r) => r.type));
    const edits: YamlEdit[] = [{ path: ["kind"], value: "journal" }];
    const types = config.relationship_types ?? [];
    // A kind of relationship that names a type a journal hasn't: dropped if nothing uses it, else refused.
    const gone = (list: string[] | undefined) => (list ?? []).some((t) => !(t in TYPES) && book.kind.entityTypes.some((k) => k.key === t));
    const drop: number[] = [];
    for (const [i, t] of types.entries()) {
      if (gone(t.from_types) || gone(t.to_types)) {
        if (used.has(t.key ?? "")) return { refused: `Relationships of the kind “${t.key}” join plotlines, which a journal has no place for. Remove them, then convert.` };
        drop.push(i);
        continue;
      }
      for (const end of ["from_types", "to_types"] as const) if (t[end]?.some((k) => k in TYPES)) edits.push({ path: ["relationship_types", i, end], value: t[end]!.map((k) => TYPES[k] ?? k) });
    }
    for (const i of drop.reverse()) edits.push({ path: ["relationship_types", i], remove: true });

    const writes: { path: string; content: string | null }[] = [{ path: MANIFEST, content: editYaml(manifest, edits) }];
    const notes: string[] = [];
    const move = (from: string, to: string, text: string) => {
      writes.push({ path: from, content: null });
      writes.push({ path: to, content: text });
    };

    // The manuscript: its order, parts as years, chapters as months, scenes as dated entries.
    for (const path of await filesUnder(source, content)) {
      const text = (await source.read(path)) ?? "";
      const to = `entries/${path.slice(content.length + 1)}`.replace(/\/_part\.yaml$/, "/_year.yaml").replace(/\/_chapter\.yaml$/, "/_month.yaml");
      if (path === `${content}/_order.yaml`) move(path, to, renameTop(text, { parts: "years", chapters: "months" }));
      else if (path.endsWith("/_part.yaml")) move(path, to, renameTop(text, { chapters: "months" }));
      else if (path.endsWith("/_chapter.yaml")) move(path, to, renameTop(text, { scenes: "entries" }));
      else if (path.endsWith(".md")) {
        const front = readFrontMatter(text) ?? {};
        const fix: YamlEdit[] = [];
        const status = typeof front["status"] === "string" ? STATUS[front["status"]] : undefined;
        if (status) fix.push({ path: ["status"], value: status });
        if (!storyTimeValue(front["when"])) {
          const day = titleDate(String(front["title"] ?? ""));
          if (day) {
            fix.push({ path: ["when"], value: { at: day } });
            notes.push(`“${String(front["title"])}” dated ${day} from its title.`);
          } else notes.push(`“${String(front["title"] ?? path)}” has no date: its title doesn't read as one. Give it one in its card.`);
        }
        move(path, to, editFrontMatter(renameKeys(text, FIELDS), fix));
      } else move(path, to, text);
    }

    // The story bible, as the index: its types' folders renamed, the plotlines' and off-page events' (empty) left behind.
    for (const path of await filesUnder(source, codex)) {
      const [folder, ...rest] = path.slice(codex.length + 1).split("/");
      if (!rest.length) {
        move(path, `index/${folder}`, (await source.read(path)) ?? "");
        continue;
      }
      if (folder === "plotlines" || (folder === "events" && !book.entityTypes.some((t) => t.folder === "events"))) {
        // Only a .gitkeep is left here: off-page events and plotlines were refused above.
        writes.push({ path, content: null });
        continue;
      }
      move(path, `index/${FOLDERS[folder!] ?? folder}/${rest.join("/")}`, (await source.read(path)) ?? "");
    }
    return { writes, notes };
  },
};

export const toJournalModule: BookModule = defineModule({ id: "to-journal", label: "Make a journal", conversions: [toJournal] });
