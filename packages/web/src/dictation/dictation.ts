import type { Editor } from "@tiptap/core";
import { heardText, offerDictation, settleHeard, showHeard, type DictationOffer } from "@writer/editor";
import { create } from "zustand";
import {
  allowMicrophone,
  cancelDictationDownload,
  DEFAULT_DICTATION_SETTINGS,
  dictationAvailable,
  dictationModel,
  dictationSettings,
  downloadDictationModel,
  removeDictationModel,
  saveDictationSettings,
  settleOnQuit,
  startDictation,
  stopDictation,
  type DictationEvent,
  type DictationModel,
  type DictationSettings,
} from "../desktop.ts";
import { useNotice } from "../novel/notice.tsx";
import { onAndroid } from "../platform.ts";

/*
 * Dictation (#71, #79, D17): the page's side. The host hears (the desktop shell; Android's plugin
 * later) and sends the phrase being heard and each phrase it settles; this puts them in the editor
 * the caret is in, through the editor's own change path, so they're saved as typing is. It never
 * sees audio, and offers nothing where the host can't hear.
 */

export type DictationState = "off" | "starting" | "listening" | "stopping";

interface Dictation {
  /** The host can hear the writer. */
  available: boolean;
  state: DictationState;
  /** The editor it's dictating into. */
  editor: Editor | undefined;
  /** The editor that last had the caret: where Dictate from the palette or a button goes. */
  last: Editor | undefined;
  /** For screen readers: listening, stopped, and each settled phrase if the writer wants it read. */
  announcement: string;
  /** As the shell keeps them (#80). */
  settings: DictationSettings;
  /** The speech model's download under way, in bytes. */
  downloading: { done: number; total: number } | undefined;
  /** Why the last download stopped, for the settings to say. */
  downloadStopped: string | undefined;
  /** The first Dictate found no model: the dialog offering it, and the editor to dictate into once it's in. */
  offer: { editor: Editor | undefined; model: DictationModel } | undefined;
}

export const useDictation = create<Dictation>(() => ({
  available: false,
  state: "off",
  editor: undefined,
  last: undefined,
  announcement: "",
  settings: DEFAULT_DICTATION_SETTINGS,
  downloading: undefined,
  downloadStopped: undefined,
  offer: undefined,
}));

/** English first (D17); other languages come with #92. */
const LANGUAGE = "en";
/** Where it hears, in the writer's words. */
export const DEVICE = onAndroid ? "phone" : "computer";
/** How long the host has to settle its last phrase once asked to stop: a slow phone's decoding of a long one. */
const STOP_MS = 10_000;

// Each start is a session; events from an earlier one are dropped.
let session = 0;
let silence: ReturnType<typeof setTimeout> | undefined;
let stopping: ReturnType<typeof setTimeout> | undefined;

const set = useDictation.setState;
const get = useDictation.getState;

/** The editor to dictate into, if it's still there. */
const live = (editor: Editor | undefined) => (editor && !editor.isDestroyed ? editor : undefined);

function quiet(): void {
  clearTimeout(silence);
  // Listening stops after the settings' while without a word heard.
  silence = setTimeout(() => void stop(), get().settings.silenceSeconds * 1000);
}

function end(announcement = "Dictation stopped"): void {
  clearTimeout(silence);
  clearTimeout(stopping);
  session++;
  set({ state: "off", editor: undefined, announcement });
}

/** The words heard so far into the text, then stopped at once: when the page is going, or the host failed. */
function settleNow(): void {
  if (get().state === "off") return;
  const editor = live(get().editor);
  if (editor) settleHeard(editor, heardText(editor.state));
  end();
  void stopDictation();
}

const FAILED: Record<Extract<DictationEvent, { kind: "failed" }>["reason"], string> = {
  microphone: "Writer couldn't use the microphone. Allow it in the system's settings, then dictate again.",
  "no-microphone": "There's no microphone. Plug one in, then dictate again.",
  permission: "Writer isn't allowed to use the microphone.",
  model: "The speech model isn't ready on this device yet.",
  other: "Something went wrong while listening. Dictate again to go on.",
};

function failed(event: Extract<DictationEvent, { kind: "failed" }>): void {
  const into = live(get().editor) ?? live(get().last);
  const heard = into ? heardText(into.state) : "";
  settleNow();
  // No model yet: the first Dictate offers to download it, where the shell keeps one.
  if (event.reason === "model") return void offerModel(into, event.message);
  // Android's to allow (#86): Writer says why first, then Android asks.
  if (event.reason === "permission") return askForMicrophone(into, event.message === "denied");
  useNotice.getState().show({ message: `Dictation stopped. ${event.message ?? FAILED[event.reason]}${heard ? " What was heard so far is in the text." : ""}` });
}

const mb = (bytes: number) => Math.round(bytes / 1e6);

const REFUSED = "Writer can't use the microphone: Android won't ask again. Allow it in Android's Settings, under Apps › Writer › Permissions, then dictate again.";

/** Why the microphone's wanted, then Android's prompt; allowed, it dictates into `editor`. */
function askForMicrophone(editor: Editor | undefined, refused: boolean): void {
  const show = useNotice.getState().show;
  if (refused) return show({ message: REFUSED });
  show({
    message: `Writer hears you through the ${DEVICE}'s microphone. What you say is heard on this ${DEVICE} and never leaves it, and nothing is recorded.`,
    action: {
      label: "Allow the microphone",
      run: () =>
        void allowMicrophone().then((state) => {
          if (state === "granted") return dictateFrom(editor);
          show({ message: state === "denied" ? REFUSED : "Writer can't dictate without the microphone. Dictate again to be asked again." });
        }),
    },
    secondary: { label: "Not now", run: () => {} },
  });
}

/** Say what dictation needs, and offer to download it: a dialog of its own (dictation-settings.tsx), as it's hundreds of megabytes. */
async function offerModel(editor: Editor | undefined, why?: string): Promise<void> {
  const model = await dictationModel();
  if (!model) return useNotice.getState().show({ message: `Couldn't start dictating: ${why ?? FAILED.model}` });
  set({ offer: { editor, model }, downloadStopped: undefined });
}

/** Dictate into `editor`, from somewhere that took the focus (a notice, a dialog): back to the text first. */
export function dictateFrom(editor: Editor | undefined): void {
  if (!live(editor)) return;
  editor!.commands.focus(null, { scrollIntoView: false });
  void start(editor!);
}

/**
 * Download the model, saying how far it is, and offer Dictate into `editor` once it's in. From the
 * settings (`notify` false) only they say how it goes, from `downloading` and `downloadStopped`.
 */
export async function download(editor: Editor | undefined, notify = true): Promise<void> {
  if (get().downloading) return;
  const show = notify ? useNotice.getState().show : () => {};
  const cancel = { label: "Cancel", run: cancelDictationDownload };
  let shown = -1;
  set({ downloading: { done: 0, total: 0 }, downloadStopped: undefined });
  show({ message: "Downloading the speech model…", action: cancel });
  try {
    await downloadDictationModel((done, total) => {
      set({ downloading: { done, total } });
      const percent = Math.floor((100 * done) / Math.max(total, 1));
      if (percent === shown) return;
      shown = percent;
      show({ message: `Downloading the speech model: ${percent}% of ${mb(total)} MB…`, action: cancel });
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const cancelled = message === "cancelled";
    set({ downloading: undefined, downloadStopped: cancelled ? "Download stopped. What's downloaded so far is kept: download again to go on from there." : `The speech model didn't download: ${message}` });
    if (cancelled) return show({ message: get().downloadStopped!, action: { label: "Download", run: () => void download(editor) } });
    return show({ message: get().downloadStopped!, action: { label: "Try again", run: () => void download(editor) } });
  }
  set({ downloading: undefined });
  show({
    message: `The speech model is in: dictation hears on this ${DEVICE} now.`,
    // From the notice back to the text, where the words will go.
    ...(live(editor) ? { action: { label: "Dictate", run: () => dictateFrom(editor) } } : {}),
  });
}

function onEvent(event: DictationEvent): void {
  const editor = live(get().editor);
  if (event.kind === "failed") return failed(event);
  if (event.kind === "stopped") {
    if (editor) settleHeard(editor, heardText(editor.state));
    return end();
  }
  // The editor's gone without saying so: there's nowhere for the words to go.
  if (!editor) return settleNow();
  quiet();
  if (event.kind === "heard") return showHeard(editor, event.text);
  settleHeard(editor, event.text);
  if (get().settings.announce) set({ announcement: event.text });
}

/** Start dictating into `editor`. */
export async function start(editor: Editor): Promise<void> {
  if (!get().available || get().state !== "off" || editor.isDestroyed) return;
  const mine = ++session;
  set({ state: "starting", editor, last: editor, announcement: "" });
  try {
    await startDictation(LANGUAGE, [], (event) => mine === session && onEvent(event));
  } catch (e) {
    if (mine !== session) return;
    end("");
    useNotice.getState().show({ message: `Couldn't start dictating: ${e instanceof Error ? e.message : String(e)}` });
    return;
  }
  if (mine !== session || get().state !== "starting") return;
  set({ state: "listening", announcement: "Listening" });
  quiet();
}

/** Stop: the host settles what it's hearing, and that goes in the text before the microphone's let go. */
export async function stop(): Promise<void> {
  const { state } = get();
  if (state === "off" || state === "stopping") return;
  const mine = session;
  set({ state: "stopping" });
  clearTimeout(silence);
  // A host that never says it has stopped: what it heard goes in anyway.
  stopping = setTimeout(() => mine === session && settleNow(), STOP_MS);
  await stopDictation();
}

/** Dictate into `editor`, or stop if it's dictating. */
export function toggle(editor: Editor): void {
  if (get().state === "off") void start(editor);
  else void stop();
}

const offer: DictationOffer = {
  listening: (editor) => get().state !== "off" && get().editor === editor,
  toggle,
  focused(editor) {
    const { state, editor: into } = get();
    set({ last: editor });
    if (state === "off" || into === editor) return;
    // The caret went to another editor (the next entry): the phrase being heard goes with it.
    const heard = live(into) ? heardText(into!.state) : "";
    if (live(into)) showHeard(into!, "");
    set({ editor });
    showHeard(editor, heard);
  },
  left(editor) {
    if (get().editor === editor) settleNow();
  },
};

/** Keep `changes` to dictation's settings: the next dictation hears with them. */
export async function saveSettings(changes: Partial<DictationSettings>): Promise<void> {
  const settings = { ...get().settings, ...changes };
  set({ settings });
  await saveDictationSettings(settings);
}

/** Remove the speech model from this device, stopping dictation first if it's listening. */
export async function removeModel(): Promise<void> {
  if (get().state !== "off") settleNow();
  await removeDictationModel();
}

let started: Promise<void> | undefined;

/** Ask the host whether it can hear, once, and offer Dictate in every editor if it can. */
export function initDictation(): Promise<void> {
  started ??= dictationAvailable().then((available) => {
    set({ available });
    if (!available) return;
    void dictationSettings().then((setup) => setup && set({ settings: { ...DEFAULT_DICTATION_SETTINGS, ...setup.settings } }));
    offerDictation(offer);
    settleOnQuit(settleNow);
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && settleNow());
    // Android's app goes to the background without hiding its page: its plugin says so instead.
    window.addEventListener("writer-background", settleNow);
  });
  return started;
}
