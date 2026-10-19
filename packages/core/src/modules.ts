import type { BookKind, FieldDef } from "./kinds.ts";
import type { Book } from "./model.ts";
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
  checks?: readonly ModuleCheck[];
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
    full = { ...kind, fields };
    withModulesOf.set(kind, full);
    complete.add(full);
  }
  return full;
}

/** Every check of the book's modules, run on it. */
export function moduleDiagnostics(book: Book): Diagnostic[] {
  return modulesOf(book.kind).flatMap((m) => (m.checks ?? []).flatMap((c) => c.find(book).map((f): Diagnostic => ({ severity: c.severity, code: c.code, ...f }))));
}
