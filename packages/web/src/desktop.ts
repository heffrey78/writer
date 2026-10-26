import { useCallback } from "react";
import { useNavigate } from "react-router";

/**
 * The page's side of the desktop app (D9). In the app, a page can ask the shell for what a browser
 * page can't do: choose a folder, open a novel in a window of its own, bring the library forward. The
 * shell in turn runs commands in the page (`window.writer.run`: its menu's New novel…, a folder
 * dropped on the library or passed on the command line), and before it quits asks the page to save
 * (`window.writer.flushAll`). In a browser none of this is there, and the app works as a web page.
 */

interface Invoke {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  /** A stream of messages from a command back to the page (Tauri's Channel). */
  Channel: new <T>() => { onmessage: (message: T) => void };
}

/** A command from the shell, by name: "go" (a path in the app), "about", or "command" (a palette command, by its id). */
export interface ShellCommand {
  name: string;
  arg?: string | null;
}

const shell = (window as unknown as { __TAURI__?: { core?: Invoke } }).__TAURI__?.core;

/** Whether this page is in the desktop app. */
export const desktop = shell !== undefined;

declare global {
  interface Window {
    writer?: { flushAll(): Promise<void>; run(command: ShellCommand): void };
  }
}

const flushes = new Set<() => Promise<void>>();
const handlers = new Map<string, (arg: string | undefined) => void>();
// Commands that came before their handler did (the shell's first ones arrive as the page loads).
const waiting: ShellCommand[] = [];

function run(command: ShellCommand): void {
  const handler = handlers.get(command.name);
  if (handler) handler(command.arg ?? undefined);
  else waiting.push(command);
}

const settles = new Set<() => void>();

window.writer = {
  async flushAll() {
    // What's being dictated goes into the text first, so the flushes save it.
    for (const settle of settles) settle();
    await Promise.allSettled([...flushes].map((flush) => flush()));
  },
  run,
};

// Tell the shell the page is ready for commands, and run any it kept for it.
if (shell) void shell.invoke<ShellCommand[]>("page_ready").then((commands) => commands.forEach(run));

/** Save with `flush` when the desktop app quits or the window closes. Returns a function that stops it. */
export function flushOnQuit(flush: () => Promise<void>): () => void {
  flushes.add(flush);
  return () => void flushes.delete(flush);
}

/** Before the saves when the app quits, put what's being dictated in the text. Returns a function that stops it. */
export function settleOnQuit(settle: () => void): () => void {
  settles.add(settle);
  return () => void settles.delete(settle);
}

/** Run `handler` for the shell's command `name`, including one that came earlier. Returns a function that stops it. */
export function onShellCommand(name: string, handler: (arg: string | undefined) => void): () => void {
  handlers.set(name, handler);
  const mine = waiting.filter((c) => c.name === name);
  waiting.splice(0, waiting.length, ...waiting.filter((c) => c.name !== name));
  for (const command of mine) handler(command.arg ?? undefined);
  return () => {
    if (handlers.get(name) === handler) handlers.delete(name);
  };
}

/** The folder the writer chooses in the system's dialog, or null if they cancel. Desktop only. */
export function chooseFolder(title: string): Promise<string | null> {
  return shell ? shell.invoke<string | null>("pick_folder", { title }) : Promise.resolve(null);
}

export type EditAction = "cut" | "copy" | "paste" | "select_all";

/**
 * Have the shell run the webview's own editing command on what has the focus. False where it can't
 * (in a browser, and in the desktop app on macOS and Windows for now): the page does it itself.
 */
export function shellEdit(action: EditAction): Promise<boolean> {
  return shell ? shell.invoke<boolean>("edit", { action }).catch(() => false) : Promise.resolve(false);
}

/** The clipboard's text, which a page can't read on its own: from the shell, or null. */
export function clipboardText(): Promise<string | null> {
  return shell ? shell.invoke<string | null>("clipboard_text").catch(() => null) : Promise.resolve(null);
}

/** Whether the shell can open the inspector on this page (a debug build). */
export function canInspect(): Promise<boolean> {
  return shell ? shell.invoke<boolean>("can_inspect").catch(() => false) : Promise.resolve(false);
}

/** Open the inspector on this page. */
export function inspect(): void {
  void shell?.invoke("inspect");
}

/** Tell the shell the novels most recently opened, for its Open Recent menu. */
export function reportRecent(novels: { id: string; title: string }[]): void {
  void shell?.invoke("set_recent", { novels });
}

/**
 * Open a novel, at `path` within it if given ("today"): in the desktop app, in a window of its own (or
 * bring that window forward, there); in a browser, here.
 */
export function useOpenNovel(): (id: string, path?: string) => void {
  const navigate = useNavigate();
  return useCallback((id: string, path?: string) => (shell ? void shell.invoke("open_novel", path ? { id, path } : { id }) : void navigate(`/novels/${id}${path ? `/${path}` : ""}`)), [navigate]);
}

/**
 * Go to the library, at `path` ("/?add=new", say): in the desktop app, in its own window (unless this
 * is it); in a browser, here.
 */
export function useShowLibrary(): (path?: string) => void {
  const navigate = useNavigate();
  return useCallback(
    (path = "/") => {
      if (!shell) return void navigate(path);
      void shell.invoke<boolean>("show_library", { path }).then((elsewhere) => elsewhere || navigate(path));
    },
    [navigate],
  );
}

/**
 * What the shell tells the page while it dictates (#79, D17): the phrase being heard so far, a phrase
 * settled, that it has stopped (after settling what it heard), or why it couldn't go on.
 */
export type DictationEvent =
  | { kind: "heard"; text: string }
  | { kind: "settled"; text: string }
  | { kind: "stopped" }
  | { kind: "failed"; reason: "microphone" | "no-microphone" | "model" | "other"; message?: string };

/** Whether the shell can hear the writer: false in a browser, and in a shell without dictation. */
export function dictationAvailable(): Promise<boolean> {
  return shell ? shell.invoke<boolean>("dictation_available").catch(() => false) : Promise.resolve(false);
}

/** Start the shell listening, in `language`, with names to spell as the book does; its events go to `onEvent`. */
export function startDictation(language: string, hints: string[], onEvent: (event: DictationEvent) => void): Promise<void> {
  if (!shell) return Promise.reject(new Error("There's nothing here to hear with."));
  const events = new shell.Channel<DictationEvent>();
  events.onmessage = onEvent;
  return shell.invoke("dictate_start", { language, hints, events });
}

/** Ask the shell to stop: it settles the phrase it's hearing, then says it has stopped. */
export function stopDictation(): Promise<void> {
  return shell ? shell.invoke<void>("dictate_stop").catch(() => {}) : Promise.resolve();
}

/** The shell's speech model: ready, or what it takes to download (DEVELOPER.md, *Dictation*). */
export interface DictationModel {
  state: "ready" | "missing" | "damaged";
  /** On this computer, once in. */
  installedBytes: number;
  /** Left to download. */
  downloadBytes: number;
}

/** The speech model's state, where the shell keeps one (null otherwise). */
export function dictationModel(): Promise<DictationModel | null> {
  return shell ? shell.invoke<DictationModel>("dictation_model").catch(() => null) : Promise.resolve(null);
}

/** Download the speech model, `onProgress` hearing how far it is; rejects with why it stopped ("cancelled"). */
export function downloadDictationModel(onProgress: (done: number, total: number) => void): Promise<void> {
  if (!shell) return Promise.reject(new Error("There's nowhere to download to."));
  const progress = new shell.Channel<{ done: number; total: number }>();
  progress.onmessage = ({ done, total }) => onProgress(done, total);
  return shell.invoke("dictation_download", { progress });
}

/** Stop the download under way; what's downloaded is kept for the next time. */
export function cancelDictationDownload(): void {
  void shell?.invoke("dictation_cancel_download");
}

/** Tell the shell whether this page offers Dictate (it has an editor), for its Edit menu. */
export function offerDictationInMenu(offered: boolean): void {
  void shell?.invoke("dictation_offered", { offered }).catch(() => {});
}

/** How dictation hears the writer (#80), kept by the shell on this computer, never in a book. */
export interface DictationSettings {
  /** The recognizer chosen, where the shell has more than one; null for its first. */
  recognizer: string | null;
  /** The microphone chosen, with its name for when it isn't connected; null for the system's default. */
  microphone: { id: string; name: string } | null;
  /** Listening stops after this long without a word heard. */
  silenceSeconds: number;
  /** Each settled phrase is read out to a screen reader. */
  announce: boolean;
}

export const DEFAULT_DICTATION_SETTINGS: DictationSettings = { recognizer: null, microphone: null, silenceSeconds: 60, announce: false };

/** A microphone connected now. Choosing a Bluetooth one switches the headphones into their headset mode while it listens. */
export interface Microphone {
  id: string;
  name: string;
  bluetooth: boolean;
}

/** What dictation's settings show: what's kept, the shell's recognizers (each on the device, in its words), and the microphones. */
export interface DictationSetup {
  settings: DictationSettings;
  recognizers: { id: string; words: string }[];
  microphones: Microphone[];
}

/** Dictation's settings and what they choose from, where the shell keeps them (null otherwise). */
export function dictationSettings(): Promise<DictationSetup | null> {
  return shell ? shell.invoke<DictationSetup>("dictation_settings").catch(() => null) : Promise.resolve(null);
}

/** Keep dictation's settings: the next dictation hears with them. */
export function saveDictationSettings(settings: DictationSettings): Promise<void> {
  return shell ? shell.invoke<void>("dictation_save_settings", { settings }) : Promise.resolve();
}

/** Remove the speech model from this computer; it can be downloaded again. */
export function removeDictationModel(): Promise<void> {
  return shell ? shell.invoke<void>("dictation_remove_model") : Promise.resolve();
}
