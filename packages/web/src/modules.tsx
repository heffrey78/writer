import type { Book, BookKind, Entity } from "@writer/core";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Route, useNavigate } from "react-router";
import { useCommands, type Command } from "./commands.ts";
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
  /** The sidebar's group it's listed in, after the base's views. */
  group: "Plan" | "Revise";
  render(view: BookView): ReactNode;
}

/** A tab of the story map a module adds (the swimlanes): at /story-map/<key>, before the base's tabs, and under "Go to". */
export interface StoryMapTab {
  key: string;
  label: string;
  /** Words the palette also finds it by. */
  keywords?: readonly string[];
  render(view: BookView): ReactNode;
}

/** A section a module adds to the profile of an entry of a type: a plotline's beats. */
export interface ProfileSection {
  entityType: string;
  render(view: BookView & { entity: Entity }): ReactNode;
}

export interface WebModule {
  /** The module's id, as its kind lists it. */
  id: string;
  views?: readonly ModuleView[];
  storyMapTabs?: readonly StoryMapTab[];
  profileSections?: readonly ProfileSection[];
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

/** The views the book's modules add. */
export const moduleViews = (kind: BookKind): ModuleView[] => webModulesOf(kind).flatMap((m) => m.views ?? []);

/** The story map tabs the book's modules add, in the order its kind lists them. */
export const moduleStoryMapTabs = (kind: BookKind): StoryMapTab[] => webModulesOf(kind).flatMap((m) => m.storyMapTabs ?? []);

/** The profile sections the book's modules add for an entry of `type`. */
export const moduleProfileSections = (kind: BookKind, type: string): ProfileSection[] => webModulesOf(kind).flatMap((m) => (m.profileSections ?? []).filter((s) => s.entityType === type));

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
        ...(m.views ?? []).map((v) => ({ id: `${m.id}.view.${v.path}`, title: v.label, group: "Go to", run: () => void navigate(`/novels/${novelId}/${v.path}`) })),
        ...(m.storyMapTabs ?? []).map((t) => ({ id: `${m.id}.story-map.${t.key}`, title: `Story map: ${t.label}`, group: "Go to", keywords: ["diagram", ...(t.keywords ?? [])], run: () => void navigate(`/novels/${novelId}/story-map/${t.key}`) })),
        ...(m.commands?.({ ...view, navigate: (to) => void navigate(to) }) ?? []),
      ]),
    [novelId, novel, workspace, navigate],
  );
  return null;
}
