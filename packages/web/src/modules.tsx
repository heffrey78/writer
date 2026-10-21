import { recordTypesOf, type Book, type BookKind, type Entity, type ModuleRecord, type Note, type RecordTypeDef } from "@writer/core";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Route, useNavigate } from "react-router";
import { create } from "zustand";
import { useCommands, type Command } from "./commands.ts";
import type { SpellService } from "@writer/editor/react";
import type { Workspace } from "./novel/workspace.ts";

/*
 * Modules' web halves (D14): the views and commands a module adds to the app, for books of the kinds
 * that list it. The web app's entry point (main.tsx) registers the modules it ships; the base reads
 * them only through webModulesOf. A module's core half (fields, checks) comes with the book's kind.
 */

/** The open book, as a module's view and commands see it. */
export interface BookView {
  novelId: string;
  novel: Book;
  workspace: Workspace;
}

/** A page of the book a module adds: its route under the book (and below it), and its place in the sidebar. */
export interface ModuleView {
  path: string;
  label: string;
  icon: LucideIcon;
  /** The sidebar's group it's listed in, after the base's views; none for a page reached another way (today's entry). */
  group?: "Plan" | "Revise";
  render(view: BookView): ReactNode;
}

/** A tab of the story map a module adds (the swimlanes, the timeline): at /story-map/<key>, in the order the kind lists its modules, and under "Go to". */
export interface StoryMapTab {
  key: string;
  label: string;
  /** Words the palette also finds it by. */
  keywords?: readonly string[];
  render(view: BookView): ReactNode;
}

/** An order the outline can show its table and cards in, beside reading order (story time): at ?order=<key>, remembered. */
export interface OutlineOrder {
  key: string;
  label: string;
  table(view: BookView): ReactNode;
  cards(view: BookView): ReactNode;
}

/** A way the outline shows the book, beside its table and cards (the drafting board): at /outline/<key>, remembered. Reading order only. */
export interface OutlineView {
  key: string;
  label: string;
  render(view: BookView): ReactNode;
}

/** What a module offers under a story-time editor once a day of the story has become a date: dating Day 1 from it. */
export type DayToDate = (view: { novelId: string; novel: Book; day: number; date: string; done: () => void }) => ReactNode;

/** A section a module adds to the profile of an entry of a type: a plotline's beats. */
export interface ProfileSection {
  entityType: string;
  render(view: BookView & { entity: Entity }): ReactNode;
}

/** A module's record as its page shows it: on its own, in a modal over the codex's gallery, or in the right sidebar's Entry tab. */
export interface RecordPageView extends BookView {
  record: ModuleRecord;
  spell?: { service: SpellService; onAddWord: (w: string) => void } | undefined;
  /** In a modal or the Entry tab: its title is a level-2 heading with this ID (a modal's own top heading, in one). */
  embedded?: { headingId: string; modal?: boolean };
  /** The whole page, or the Entry tab's, which leaves out deleting it and links to the page. */
  size?: "page" | "tab";
}

/**
 * How the app shows a module's records (an off-page event): its page at /<key>/<id>, over the codex's
 * gallery; its section of the gallery, after the entries; what a mention of one shows; making one
 * from its title, and from a note.
 */
export interface WebRecordType {
  /** Its record type's key, as the module's core half declares it: "event". */
  type: string;
  page(view: RecordPageView): ReactNode;
  /** Its section of the codex's gallery, found by the gallery's search, in its order ("name", or by first appearance). */
  gallery(view: { novelId: string; novel: Book; query: string; sort: string }): ReactNode;
  /** What a mention card says of one, under its title: `open` opens it in the Entry tab. */
  card(view: { novelId: string; novel: Book; record: ModuleRecord; open: () => void }): ReactNode;
  /** Making one from its title, in its modal: what the title field suggests, a line said under it, and the new one's ID. */
  create: { placeholder: string; hint?(view: BookView): ReactNode; make(view: BookView, title: string): Promise<string> };
  /** Making one of a note (heffrey78/gh-writer#205): the choice ("An off-page event, the note as its note"), its button, a line under them, and the new one's ID. */
  fromNote?: { label: string; action: string; hint?(view: BookView): ReactNode; make(view: BookView, note: Note, keep: boolean): Promise<string> };
}

/**
 * Something a module offers on a book's tile on the shelf (Today's entry): it opens the book at
 * `path`. `command` is its palette command's id in the book (daily.today), which the shelf offers too,
 * for the book most recently opened.
 */
export interface ShelfAction {
  label: string;
  path: string;
  command: string;
}

export interface WebModule {
  /** The module's id, as its kind lists it. */
  id: string;
  views?: readonly ModuleView[];
  shelfActions?: readonly ShelfAction[];
  records?: readonly WebRecordType[];
  storyMapTabs?: readonly StoryMapTab[];
  profileSections?: readonly ProfileSection[];
  outlineOrders?: readonly OutlineOrder[];
  outlineViews?: readonly OutlineView[];
  dayToDate?: DayToDate;
  /** Commands in the palette while a book that uses it is open. Its views are offered under "Go to" without asking. */
  commands?(view: BookView & { navigate: (to: string) => void }): Command[];
}

const registry = new Map<string, WebModule>();

/** Make a module's web half known: done by the web app's entry point, for each module it ships. */
export function registerWebModule(module: WebModule): void {
  registry.set(module.id, module);
}

/** The web halves of the modules a kind lists, in its order. A module without one adds nothing here. */
export function webModulesOf(kind: BookKind): WebModule[] {
  return (kind.modules ?? []).flatMap((id) => registry.get(id) ?? []);
}

/** The web halves of the modules named, in their order: a book on the shelf, whose kind's modules its entry lists. */
export const webModulesByIds = (ids: readonly string[]): WebModule[] => ids.flatMap((id) => registry.get(id) ?? []);

/** The views the book's modules add. */
export const moduleViews = (kind: BookKind): ModuleView[] => webModulesOf(kind).flatMap((m) => m.views ?? []);

/** The story map tabs the book's modules add, in the order its kind lists them. */
export const moduleStoryMapTabs = (kind: BookKind): StoryMapTab[] => webModulesOf(kind).flatMap((m) => m.storyMapTabs ?? []);

/** The profile sections the book's modules add for an entry of `type`. */
export const moduleProfileSections = (kind: BookKind, type: string): ProfileSection[] => webModulesOf(kind).flatMap((m) => (m.profileSections ?? []).filter((s) => s.entityType === type));

/** The orders the book's modules add to the outline. */
export const moduleOutlineOrders = (kind: BookKind): OutlineOrder[] => webModulesOf(kind).flatMap((m) => m.outlineOrders ?? []);

/** The views the book's modules add to the outline. */
export const moduleOutlineViews = (kind: BookKind): OutlineView[] => webModulesOf(kind).flatMap((m) => m.outlineViews ?? []);

/** What the book's modules offer once a day of the story has become a date. */
export const moduleDayToDate = (kind: BookKind): DayToDate[] => webModulesOf(kind).flatMap((m) => (m.dayToDate ? [m.dayToDate] : []));

/** The book's modules' records as the app shows them, each with its type's declaration (its words), in the order its kind lists them. */
export const moduleRecordTypes = (kind: BookKind): (WebRecordType & { def: RecordTypeDef })[] =>
  webModulesOf(kind).flatMap((m) => (m.records ?? []).flatMap((r) => {
    const def = recordTypesOf(kind).find((t) => t.key === r.type);
    return def ? [{ ...r, def }] : [];
  }));

/** How the app shows one of the book's modules' records, by its type's key. */
export const moduleRecordType = (kind: BookKind, type: string) => moduleRecordTypes(kind).find((t) => t.type === type);

/**
 * A new record of a module's type asked for (the codex's gallery, the Timeline, the palette): it
 * opens in its modal over the codex, from its title (heffrey78/gh-writer#236).
 */
export const useNewRecord = create<{ type: string | null; ask: (type: string | null) => void }>((set) => ({ type: null, ask: (type) => set({ type }) }));

/** Routes for the book's modules' views, to go among the book's own. */
export function moduleRoutes(view: BookView) {
  return moduleViews(view.novel.kind).map((v) => <Route key={v.path} path={`${v.path}/*`} element={v.render(view)} />);
}

/** Offers the book's modules' commands in the palette while it's open, and a way to each of their views. */
export function ModuleCommands(view: BookView) {
  const navigate = useNavigate();
  const { novelId, novel, workspace } = view;
  useCommands(
    (): Command[] =>
      webModulesOf(novel.kind).flatMap((m) => [
        // A view without a place in the sidebar is reached another way (today's entry, by its own command).
        ...(m.views ?? []).filter((v) => v.group).map((v) => ({ id: `${m.id}.view.${v.path}`, title: v.label, group: "Go to", run: () => void navigate(`/novels/${novelId}/${v.path}`) })),
        ...(m.storyMapTabs ?? []).map((t) => ({ id: `${m.id}.story-map.${t.key}`, title: `Story map: ${t.label}`, group: "Go to", keywords: ["diagram", ...(t.keywords ?? [])], run: () => void navigate(`/novels/${novelId}/story-map/${t.key}`) })),
        ...(m.commands?.({ ...view, navigate: (to) => void navigate(to) }) ?? []),
      ]),
    [novelId, novel, workspace, navigate],
  );
  return null;
}
