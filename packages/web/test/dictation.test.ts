// @vitest-environment jsdom
import "../../editor/test/dom.ts";
import type { Editor } from "@tiptap/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DictationEvent } from "../src/desktop.ts";

/** Dictation's page side (#79): what the shell hears goes into the editor the caret is in, saved as typing is, and nothing is lost on stopping. */

// A stand-in for the shell, there before the page's modules look for it.
const shell = {
  available: true,
  /** What dictate_stop does: settle `last` and say it stopped, unless it's a shell that never answers. */
  last: "" as string | undefined,
  events: undefined as ((e: DictationEvent) => void) | undefined,
  calls: [] as string[],
  /** The speech model, and how its download goes: whole, or cancelled partway. */
  model: "ready" as "ready" | "missing",
  download: "whole" as "whole" | "cancelled",
  /** The microphone, as Android's permission has it (#86); "granted" on a desktop, which never asks. */
  microphone: "granted" as "granted" | "prompt" | "denied",
  /** What Android's prompt answers. */
  answer: "granted" as "granted" | "prompt" | "denied",
  /** Dictation's settings as the shell keeps them (#80). */
  settings: { recognizer: null, microphone: null, silenceSeconds: 60, announce: false } as import("../src/desktop.ts").DictationSettings,
};
class Channel<T> {
  onmessage: (message: T) => void = () => {};
}
(window as unknown as { __TAURI__: unknown }).__TAURI__ = {
  core: {
    Channel,
    invoke: async (command: string, args?: { events?: Channel<DictationEvent>; progress?: Channel<{ done: number; total: number }>; settings?: typeof shell.settings }) => {
      shell.calls.push(command);
      if (command === "page_ready") return [];
      if (command === "dictation_available") return shell.available;
      if (command === "dictation_model") return { state: shell.model, installedBytes: 208_048_243, downloadBytes: shell.model === "ready" ? 0 : 419_093_000 };
      if (command === "dictation_settings") return { settings: shell.settings, recognizers: [{ id: "writer", words: "On this computer, with Writer's speech model" }], microphones: [] };
      if (command === "dictation_save_settings") return void (shell.settings = args!.settings!);
      if (command === "dictation_download") {
        for (const done of [0, 104_773_250, 209_546_500]) args!.progress!.onmessage({ done, total: 419_093_000 });
        if (shell.download === "cancelled") throw "cancelled";
        args!.progress!.onmessage({ done: 419_093_000, total: 419_093_000 });
        shell.model = "ready";
        return null;
      }
      if (command === "dictation_allow_microphone") return (shell.microphone = shell.answer);
      if (command === "dictate_start") {
        shell.events = (e) => args!.events!.onmessage(e);
        if (shell.microphone !== "granted") return void shell.events({ kind: "failed", reason: "permission", message: shell.microphone });
        // The shell says why it can't start on the channel, as it says anything else.
        if (shell.model === "missing") shell.events({ kind: "failed", reason: "model", message: "the speech model isn't all there" });
      }
      if (command === "dictate_stop" && shell.last !== undefined) {
        if (shell.last) shell.events?.({ kind: "settled", text: shell.last });
        shell.events?.({ kind: "stopped" });
      }
      return null;
    },
  },
};

let ed: typeof import("@writer/editor");
let tiptap: typeof import("@tiptap/core");
let dictation: typeof import("../src/dictation/dictation.ts");
let desktop: typeof import("../src/desktop.ts");
let notice: typeof import("../src/novel/notice.tsx");
beforeAll(async () => {
  [ed, tiptap, dictation, desktop, notice] = await Promise.all([import("@writer/editor"), import("@tiptap/core"), import("../src/dictation/dictation.ts"), import("../src/desktop.ts"), import("../src/novel/notice.tsx")]);
  await dictation.initDictation();
});

const editors: Editor[] = [];
function open(markdown: string): Editor {
  const editor = new tiptap.Editor({ element: document.createElement("div"), extensions: [...ed.proseContent, ed.DictationExtension] });
  ed.loadMarkdown(editor, markdown);
  editor.commands.focus("end");
  editors.push(editor);
  return editor;
}
const say = (e: DictationEvent) => shell.events!(e);
const shown = (editor: Editor) => editor.view.dom.querySelector(".ghw-heard")?.textContent;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  shell.model = "ready";
  shell.download = "whole";
  shell.microphone = "granted";
  shell.answer = "granted";
  shell.last = "";
  shell.calls = [];
  notice.useNotice.setState({ notice: undefined });
  dictation.useDictation.setState({ settings: desktop.DEFAULT_DICTATION_SETTINGS, downloadStopped: undefined, offer: undefined });
});
afterEach(async () => {
  await dictation.stop();
  for (const editor of editors.splice(0)) editor.destroy();
  vi.useRealTimers();
});

describe("dictating", () => {
  it("is offered once the shell says it can hear, and Mod-Shift-D starts it in the editor", async () => {
    expect(dictation.useDictation.getState().available).toBe(true);
    const editor = open("Fog.\n");
    const event = new KeyboardEvent("keydown", { key: "D", shiftKey: true, ctrlKey: true, bubbles: true });
    Object.defineProperty(event, "keyCode", { value: 68 });
    expect(editor.view.someProp("handleKeyDown", (f) => f(editor.view, event))).toBe(true);
    await vi.waitFor(() => expect(dictation.useDictation.getState().state).toBe("listening"));
    expect(dictation.useDictation.getState()).toMatchObject({ editor, announcement: "Listening" });
    expect(shell.calls).toContain("dictate_start");
  });

  it("shows what's heard, writes each settled phrase once, and on stopping writes the last before saying it stopped", async () => {
    const editor = open("Fog.\n");
    await dictation.start(editor);
    say({ kind: "heard", text: "then" });
    say({ kind: "heard", text: "then sun" });
    expect(shown(editor)).toBe(" Then sun");
    expect(ed.getMarkdown(editor)).toBe("Fog.\n");
    say({ kind: "settled", text: "then sun." });
    expect(ed.getMarkdown(editor)).toBe("Fog. Then sun.\n");
    say({ kind: "heard", text: "rain at" });
    shell.last = "rain at dusk.";
    await dictation.stop();
    expect(ed.getMarkdown(editor)).toBe("Fog. Then sun. Rain at dusk.\n");
    expect(shown(editor)).toBeUndefined();
    expect(dictation.useDictation.getState()).toMatchObject({ state: "off", announcement: "Dictation stopped" });
  });

  it("a shell that never says it stopped: what it heard goes in anyway", async () => {
    const editor = open("Fog.\n");
    await dictation.start(editor);
    say({ kind: "heard", text: "then sun" });
    shell.last = undefined;
    await dictation.stop();
    expect(dictation.useDictation.getState().state).toBe("stopping");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ed.getMarkdown(editor)).toBe("Fog. Then sun\n");
    expect(dictation.useDictation.getState().state).toBe("off");
  });

  it("a failure mid-phrase writes the words heard so far and says what to do", async () => {
    const editor = open("Fog.\n");
    await dictation.start(editor);
    say({ kind: "heard", text: "then sun" });
    say({ kind: "failed", reason: "no-microphone" });
    expect(ed.getMarkdown(editor)).toBe("Fog. Then sun\n");
    expect(dictation.useDictation.getState().state).toBe("off");
    expect(notice.useNotice.getState().notice?.message).toBe("Dictation stopped. There's no microphone. Plug one in, then dictate again. What was heard so far is in the text.");
  });

  it("the caret moving to another editor takes the phrase being heard with it", async () => {
    const first = open("Fog.\n");
    const second = open("Rain.\n");
    first.commands.focus("end");
    await dictation.start(first);
    say({ kind: "heard", text: "and wind" });
    second.commands.focus("end");
    second.emit("focus", { editor: second, event: new FocusEvent("focus"), transaction: second.state.tr });
    expect(shown(first)).toBeUndefined();
    expect(shown(second)).toBe(" And wind");
    say({ kind: "settled", text: "and wind." });
    expect(ed.getMarkdown(first)).toBe("Fog.\n");
    expect(ed.getMarkdown(second)).toBe("Rain. And wind.\n");
  });

  it("stops after a minute without a word", async () => {
    const editor = open("Fog.\n");
    await dictation.start(editor);
    say({ kind: "settled", text: "then sun" });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(dictation.useDictation.getState().state).toBe("listening");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(dictation.useDictation.getState().state).toBe("off");
    expect(shell.calls).toContain("dictate_stop");
  });
});

describe("its settings", () => {
  it("are the shell's, kept by it when changed", async () => {
    expect(dictation.useDictation.getState().settings).toEqual(desktop.DEFAULT_DICTATION_SETTINGS);
    await dictation.saveSettings({ silenceSeconds: 120, microphone: { id: "pulseaudio:alsa_input.usb", name: "USB Microphone" } });
    expect(shell.settings).toEqual({ recognizer: null, microphone: { id: "pulseaudio:alsa_input.usb", name: "USB Microphone" }, silenceSeconds: 120, announce: false });
    expect(dictation.useDictation.getState().settings.silenceSeconds).toBe(120);
  });

  it("stop listening after the silence chosen", async () => {
    await dictation.saveSettings({ silenceSeconds: 30 });
    const editor = open("Fog.\n");
    await dictation.start(editor);
    say({ kind: "settled", text: "then sun" });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(dictation.useDictation.getState().state).toBe("listening");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(dictation.useDictation.getState().state).toBe("off");
  });

  it("read each settled phrase to a screen reader only when asked to", async () => {
    const editor = open("Fog.\n");
    await dictation.start(editor);
    say({ kind: "settled", text: "then sun" });
    expect(dictation.useDictation.getState().announcement).toBe("Listening");
    await dictation.saveSettings({ announce: true });
    say({ kind: "heard", text: "and rain" });
    expect(dictation.useDictation.getState().announcement).toBe("Listening");
    say({ kind: "settled", text: "and rain." });
    expect(dictation.useDictation.getState().announcement).toBe("and rain.");
    await dictation.stop();
  });
});

describe("leaving", () => {
  it("the page hidden: the words heard so far are written at once, and the phrase the host settles as it stops takes their place (#97)", async () => {
    const editor = open("Fog.\n");
    await dictation.start(editor);
    say({ kind: "heard", text: "then sun at" });
    // The host settles the phrase a moment after it's asked to stop.
    shell.last = undefined;
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    expect(ed.getMarkdown(editor)).toBe("Fog. Then sun at\n");
    expect(dictation.useDictation.getState().state).toBe("off");
    await vi.waitFor(() => expect(shell.calls).toContain("dictate_stop"));
    // Its last phrases, one by one, settle the words written for them.
    say({ kind: "settled", text: "Then, sun" });
    say({ kind: "settled", text: "at last." });
    say({ kind: "stopped" });
    expect(ed.getMarkdown(editor)).toBe("Fog. Then, sun at last.\n");
    // Nothing more from that dictation.
    say({ kind: "settled", text: "And wind." });
    say({ kind: "heard", text: "and" });
    expect(ed.getMarkdown(editor)).toBe("Fog. Then, sun at last.\n");
    expect(shown(editor)).toBeUndefined();
  });

  it("Android's app to the background: the same, and words changed meanwhile stay as they are", async () => {
    const editor = open("Fog.\n");
    await dictation.start(editor);
    say({ kind: "heard", text: "then sun" });
    shell.last = undefined;
    window.dispatchEvent(new Event("writer-background"));
    expect(ed.getMarkdown(editor)).toBe("Fog. Then sun\n");
    editor.commands.insertContent("ny");
    say({ kind: "settled", text: "Then, sun." });
    expect(ed.getMarkdown(editor)).toBe("Fog. Then sunny\n");
  });

  it("the editor going writes what was heard first, and stops listening into it", async () => {
    const editor = open("Fog.\n");
    await dictation.start(editor);
    say({ kind: "heard", text: "then sun" });
    ed.leaveDictation(editor);
    expect(ed.getMarkdown(editor)).toBe("Fog. Then sun\n");
    expect(dictation.useDictation.getState().state).toBe("off");
  });

  it("the app quitting: the words heard so far are in the text before anything is saved", async () => {
    const editor = open("Fog.\n");
    await dictation.start(editor);
    say({ kind: "heard", text: "then sun" });
    let saved = "";
    const unflush = desktop.flushOnQuit(async () => void (saved = ed.getMarkdown(editor)));
    await window.writer!.flushAll();
    unflush();
    expect(saved).toBe("Fog. Then sun\n");
  });
});

describe("the speech model", () => {
  const shown = () => notice.useNotice.getState().notice;

  it("missing on the first Dictate: offered in a dialog of its own, with its size; downloaded, it dictates", async () => {
    shell.model = "missing";
    const editor = open("Fog.\n");
    await dictation.start(editor);
    expect(dictation.useDictation.getState().state).toBe("off");
    await vi.waitFor(() => expect(dictation.useDictation.getState().offer).toBeDefined());
    const offer = dictation.useDictation.getState().offer!;
    expect(offer.editor).toBe(editor);
    expect(offer.model).toEqual({ state: "missing", installedBytes: 208_048_243, downloadBytes: 419_093_000 });
    // Not a notice: it's the dialog's to say.
    expect(shown()).toBeUndefined();

    const seen: (number | undefined)[] = [];
    const unsubscribe = dictation.useDictation.subscribe((s) => seen.push(s.downloading?.done));
    await dictation.download(offer.editor, false);
    unsubscribe();
    expect(seen).toContain(209_546_500);
    expect(shell.model).toBe("ready");
    dictation.dictateFrom(offer.editor);
    await vi.waitFor(() => expect(dictation.useDictation.getState().state).toBe("listening"));
    dictation.useDictation.setState({ offer: undefined });
    await dictation.stop();
  });

  it("a download cancelled says what's kept, and goes on from there when asked", async () => {
    shell.model = "missing";
    shell.download = "cancelled";
    await dictation.download(undefined, false);
    expect(dictation.useDictation.getState().downloadStopped).toBe("Download stopped. What's downloaded so far is kept: download again to go on from there.");
    shell.download = "whole";
    await dictation.download(undefined, false);
    expect(dictation.useDictation.getState().downloadStopped).toBeUndefined();
    expect(shell.model).toBe("ready");
  });

  it("downloaded from the settings: they say how far it is, and nothing else does", async () => {
    shell.model = "missing";
    const seen: (number | undefined)[] = [];
    const unsubscribe = dictation.useDictation.subscribe((s) => seen.push(s.downloading?.done));
    await dictation.download(undefined, false);
    unsubscribe();
    expect(seen).toContain(209_546_500);
    expect(dictation.useDictation.getState().downloading).toBeUndefined();
    expect(shown()).toBeUndefined();

    shell.model = "missing";
    shell.download = "cancelled";
    await dictation.download(undefined, false);
    expect(dictation.useDictation.getState().downloadStopped).toBe("Download stopped. What's downloaded so far is kept: download again to go on from there.");
    expect(shown()).toBeUndefined();
  });
});

describe("the microphone, on a phone (#86)", () => {
  const shown = () => notice.useNotice.getState().notice;

  it("not allowed yet: Writer says why, then Android asks, and once it's allowed it dictates", async () => {
    shell.microphone = "prompt";
    const editor = open("Fog.\n");
    await dictation.start(editor);
    expect(dictation.useDictation.getState().state).toBe("off");
    await vi.waitFor(() => expect(shown()?.action?.label).toBe("Allow the microphone"));
    expect(shown()?.message).toMatch(/microphone\. What you say is heard on this \w+ and never leaves it, and nothing is recorded\.$/);
    expect(shown()?.secondary?.label).toBe("Not now");
    shown()!.action!.run();
    await vi.waitFor(() => expect(dictation.useDictation.getState().state).toBe("listening"));
    expect(shell.calls).toContain("dictation_allow_microphone");
    await dictation.stop();
  });

  it("refused for good: says where to allow it, and asks nothing", async () => {
    shell.microphone = "prompt";
    shell.answer = "denied";
    const editor = open("Fog.\n");
    await dictation.start(editor);
    await vi.waitFor(() => expect(shown()?.action?.label).toBe("Allow the microphone"));
    shown()!.action!.run();
    await vi.waitFor(() => expect(shown()?.message).toBe("Writer can't use the microphone: Android won't ask again. Allow it in Android's Settings, under Apps › Writer › Permissions, then dictate again."));
    shell.calls = [];
    await dictation.start(editor);
    await vi.waitFor(() => expect(shown()?.message).toMatch(/^Writer can't use the microphone: Android won't ask again/));
    expect(shown()?.action).toBeUndefined();
    expect(shell.calls).not.toContain("dictation_allow_microphone");
  });
});
