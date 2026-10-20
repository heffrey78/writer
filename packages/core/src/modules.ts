import type { EntityTypeDef } from "./ids.ts";
import type { BookKind, FieldDef } from "./kinds.ts";
import type { Book, Piece, StoryEvent } from "./model.ts";
import type { Diagnostic, Severity } from "./types.ts";

/*
 * Modules (D14): first-party features some kinds want and others don't, such as story time or
 * plotlines. A module contributes only through these extension points, and a kind lists the modules
 * its books use. The app's entry points register the modules they ship (registerModule) before the
 * kinds that list them; the base never imports one. This is a module's core half: its web half
 * (views, commands) is registered in the web app the same way.
 */

/** What a check found: a diagnostic without its code and severity, which are the check's. */
export type Finding = Omit<Diagnostic, "code" | "severity">;

/** A check a module adds to the validator: one code, its severity, and what it finds in a loaded book. */
export interface ModuleCheck {
  code: string;
  severity: Severity;
  find(book: Book): Finding[];
}

export interface BookModule {
  /** Its name in a kind's `modules`: "story-time". */
  id: string;
  label: string;
  /** Fields it adds to a piece, after the kind's own (declared as a kind declares them). */
  fields?: readonly FieldDef[];
  /** Entry types it adds to the codex, after the kind's own: the plotline. */
  entityTypes?: readonly EntityTypeDef[];
  checks?: readonly ModuleCheck[];
  /** Its diagrams for the book's diagrams/ folder, and its section of their README. */
  snapshots?: (book: Book) => ModuleSnapshots;
  /** What it says about a piece among the piece's facts, after where it stands in the book: "A flashback: 3 days before “The Betrayal”." */
  facts?: (book: Book, piece: Piece) => string[];
  /** Where things are in story time, for what the base shows of off-page events and places (the story-time module's). */
  clock?: StoryClock;
}

/**
 * Story time as the base reads it (#30): the order of the off-page events, the pieces either side of
 * one, and the time some pieces span. The base's off-page events and a place's profile show times only
 * through it, so a kind whose modules keep no clock shows none. Until events are a module (#33).
 */
export interface StoryClock {
  /** The off-page events in story-time order, those without a time after them. */
  events(book: Book): StoryEvent[];
  /** The pieces either side of an off-page event in story time, on its own scale. */
  around(book: Book, id: string): { before?: Piece; after?: Piece };
  /** The story time some pieces span, as read: from "Day 1, 09:10" to "Day 3". */
  span(book: Book, pieces: Piece[]): { from: string; to: string } | undefined;
}

/** A module's diagram snapshots: files by path from the book's root, and the lines of its README section. */
export interface ModuleSnapshots {
  files: readonly (readonly [string, string])[];
  readme: readonly string[];
}

/** A module's core half, typed. */
export const defineModule = (module: BookModule): BookModule => module;

const registry = new Map<string, BookModule>();

/** Make a module known: done by the app's entry points, for each module they ship, before the kinds. */
export function registerModule(module: BookModule): void {
  registry.set(module.id, module);
}

/** The modules a kind's books use, in the order it lists them. Throws for one no entry point registered. */
export function modulesOf(kind: BookKind): BookModule[] {
  return (kind.modules ?? []).map((id) => {
    const module = registry.get(id);
    if (!module) throw new Error(`The ${kind.label} kind uses the module “${id}”, which isn't registered: the app's entry point registers the modules it ships`);
    return module;
  });
}

const withModulesOf = new WeakMap<BookKind, BookKind>();
const complete = new WeakSet<BookKind>();

/**
 * A kind with what its modules add: their fields after its own. A kind with no modules is itself, and
 * a complete kind stays as it is, so this can be called on any kind, as often as needed.
 */
export function withModules(kind: BookKind): BookKind {
  if (!kind.modules?.length || complete.has(kind)) return kind;
  let full = withModulesOf.get(kind);
  if (!full) {
    const fields = [...kind.fields];
    for (const module of modulesOf(kind)) {
      for (const f of module.fields ?? []) {
        const clash = fields.find((g) => g.key === f.key);
        if (clash) throw new Error(`The module “${module.id}” declares the field “${f.key}”, which the ${kind.label} kind or another of its modules already has`);
        fields.push(f);
      }
    }
    const entityTypes = [...kind.entityTypes];
    for (const module of modulesOf(kind)) {
      for (const t of module.entityTypes ?? []) {
        if (entityTypes.some((u) => u.key === t.key || u.prefix === t.prefix)) throw new Error(`The module “${module.id}” declares the entry type “${t.key}”, whose key or prefix the ${kind.label} kind or another of its modules already has`);
        entityTypes.push(t);
      }
    }
    full = { ...kind, fields: ordered(fields, kind.fieldOrder), entityTypes: ordered(entityTypes, kind.entityTypeOrder) };
    withModulesOf.set(kind, full);
    complete.add(full);
  }
  return full;
}

/** Things with keys in the order a kind names (`order`), those it doesn't name after, each kept where it was. */
function ordered<T extends { key: string }>(items: T[], order: readonly string[] = []): T[] {
  const at = (x: T) => (order.includes(x.key) ? order.indexOf(x.key) : order.length);
  return items.map((x, i) => ({ x, i })).sort((a, b) => at(a.x) - at(b.x) || a.i - b.i).map(({ x }) => x);
}

/** The diagram snapshots of the book's modules, in the order its kind lists them. */
export function moduleSnapshots(book: Book): ModuleSnapshots[] {
  return modulesOf(book.kind).flatMap((m) => (m.snapshots ? [m.snapshots(book)] : []));
}

/** Every check of the book's modules, run on it. */
export function moduleDiagnostics(book: Book): Diagnostic[] {
  return modulesOf(book.kind).flatMap((m) => (m.checks ?? []).flatMap((c) => c.find(book).map((f): Diagnostic => ({ severity: c.severity, code: c.code, ...f }))));
}

/** What the book's modules say about a piece, in the order its kind lists them. */
export function moduleFacts(book: Book, piece: Piece): string[] {
  return modulesOf(book.kind).flatMap((m) => m.facts?.(book, piece) ?? []);
}

/** The book's story clock: the first of its modules that keeps one, if any does. */
export const storyClock = (book: Book): StoryClock | undefined => modulesOf(book.kind).find((m) => m.clock)?.clock;
