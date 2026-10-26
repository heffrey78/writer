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
      if (command === "dictate_start") {
        shell.events = (e) => args!.events!.onmessage(e);
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
  shell.last = "";
  shell.calls = [];
  notice.useNotice.setState({ notice: undefined });
  dictation.useDictation.setState({ settings: desktop.DEFAULT_DICTATION_SETTINGS, downloadStopped: undefined });
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
    await vi.advanceTimersByTimeAsync(2_000);
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
  it("the page hidden: the words heard so far are written, and what comes after is dropped", async () => {
    const editor = open("Fog.\n");
    await dictation.start(editor);
    say({ kind: "heard", text: "then sun" });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    expect(ed.getMarkdown(editor)).toBe("Fog. Then sun\n");
    expect(dictation.useDictation.getState().state).toBe("off");
    say({ kind: "settled", text: "then sun at last" });
    expect(ed.getMarkdown(editor)).toBe("Fog. Then sun\n");
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

  it("missing on the first Dictate: offered for download, with its size, then Dictate once it's in", async () => {
    shell.model = "missing";
    const editor = open("Fog.\n");
    await dictation.start(editor);
    expect(dictation.useDictation.getState().state).toBe("off");
    await vi.waitFor(() => expect(shown()?.action?.label).toBe("Download it"));
    expect(shown()?.message).toBe("Dictation hears with Writer's speech model, which isn't on this computer yet: 419 MB to download, 208 MB once it's in. What you say never leaves the computer.");
    expect(shown()?.secondary?.label).toBe("Not now");

    const messages: string[] = [];
    const unsubscribe = notice.useNotice.subscribe((s) => s.notice && messages.push(s.notice.message));
    shown()!.action!.run();
    await vi.waitFor(() => expect(shown()?.message).toBe("The speech model is in: dictation hears on this computer now."));
    unsubscribe();
    expect(messages).toContain("Downloading the speech model: 50% of 419 MB…");
    expect(messages.filter((m) => m.startsWith("Downloading")).every((m, i, all) => all.indexOf(m) === i)).toBe(true);

    shown()!.action!.run();
    await vi.waitFor(() => expect(dictation.useDictation.getState().state).toBe("listening"));
  });

  it("a download cancelled says what's kept, and goes on from there when asked", async () => {
    shell.model = "missing";
    shell.download = "cancelled";
    const editor = open("Fog.\n");
    await dictation.start(editor);
    await vi.waitFor(() => expect(shown()?.action?.label).toBe("Download it"));
    shown()!.action!.run();
    await vi.waitFor(() => expect(shown()?.message).toBe("Download stopped. What's downloaded so far is kept: download again to go on from there."));
    shell.download = "whole";
    shown()!.action!.run();
    await vi.waitFor(() => expect(shown()?.message).toBe("The speech model is in: dictation hears on this computer now."));
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
