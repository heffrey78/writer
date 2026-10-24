import type { Editor } from "@tiptap/core";
import { heardText, offerDictation, settleHeard, showHeard, type DictationOffer } from "@writer/editor";
import { create } from "zustand";
import { dictationAvailable, settleOnQuit, startDictation, stopDictation, type DictationEvent } from "../desktop.ts";
import { useNotice } from "../novel/notice.tsx";

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
  /** For screen readers: listening, stopped. */
  announcement: string;
}

export const useDictation = create<Dictation>(() => ({ available: false, state: "off", editor: undefined, last: undefined, announcement: "" }));

/** English first (D17); other languages come with #92. */
const LANGUAGE = "en";
/** Listening stops after this long without a word heard. */
const SILENCE_MS = 60_000;
/** How long the host has to settle its last phrase once asked to stop. */
const STOP_MS = 2_000;

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
  silence = setTimeout(() => void stop(), SILENCE_MS);
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
  model: "The speech model isn't ready on this device yet.",
  other: "Something went wrong while listening. Dictate again to go on.",
};

function failed(event: Extract<DictationEvent, { kind: "failed" }>): void {
  settleNow();
  useNotice.getState().show({ message: `Dictation stopped. ${event.message ?? FAILED[event.reason]} What was heard so far is in the text.` });
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
  if (event.kind === "heard") showHeard(editor, event.text);
  else settleHeard(editor, event.text);
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

let started: Promise<void> | undefined;

/** Ask the host whether it can hear, once, and offer Dictate in every editor if it can. */
export function initDictation(): Promise<void> {
  started ??= dictationAvailable().then((available) => {
    set({ available });
    if (!available) return;
    offerDictation(offer);
    settleOnQuit(settleNow);
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && settleNow());
  });
  return started;
}
