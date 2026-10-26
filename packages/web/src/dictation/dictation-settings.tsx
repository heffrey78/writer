import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { create } from "zustand";
import { cancelDictationDownload, dictationModel, dictationSettings, type DictationModel, type Microphone } from "../desktop.ts";
import { ErrorAlert } from "../ui/alert.tsx";
import { Button } from "../ui/button.tsx";
import { Confirm } from "../ui/confirm.tsx";
import { Modal } from "../ui/dialog.tsx";
import { DEVICE, dictateFrom, download, initDictation, removeModel, saveSettings, useDictation } from "./dictation.ts";

/** Whether dictation's settings are open: from the ⋯ menu or the palette, where the shell can hear. */
export const useDictationSettings = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

const MODEL = ["dictation", "model"] as const;
const SETUP = ["dictation", "setup"] as const;

/** Listening stops after this long without a word heard: the choices, in seconds. */
const SILENCES: [number, string][] = [
  [30, "30 seconds"],
  [60, "1 minute"],
  [120, "2 minutes"],
  [300, "5 minutes"],
  [600, "10 minutes"],
];

const mb = (bytes: number) => Math.round(bytes / 1e6);

/**
 * Dictation's settings (#80): how Writer hears the writer, all of it on this device. The speech
 * model's state, with Download, Cancel and Remove; which microphone; when listening stops by itself;
 * and whether a screen reader reads out each phrase written. Kept by the shell, never in a book.
 */
export function DictationSettingsDialog() {
  const { open, set } = useDictationSettings();
  // Asked once, app-wide: whether there's anything to set.
  useEffect(() => void initDictation(), []);
  return (
    <>
      {open && <DictationSettingsForm onClose={() => set(false)} />}
      <ModelOffer />
    </>
  );
}

/**
 * The first Dictate where the speech model isn't there yet: what it is and how big, the download's
 * progress, then Dictate once it's in. A dialog, not a notice: it's hundreds of megabytes to agree to.
 */
function ModelOffer() {
  const { offer, downloading, downloadStopped } = useDictation();
  const [model, setModel] = useState<DictationModel>();
  const [done, setDone] = useState(false);
  const was = useDictation((s) => !!s.downloading);
  useEffect(() => {
    setModel(offer?.model);
    setDone(false);
  }, [offer]);
  // Its state once the download ends: in, or still to finish.
  useEffect(() => {
    if (!offer || was) return;
    void dictationModel().then((m) => {
      if (!m) return;
      setModel(m);
      setDone(m.state === "ready");
    });
  }, [was, offer]);
  if (!offer) return null;
  const close = () => {
    if (downloading) cancelDictationDownload();
    useDictation.setState({ offer: undefined });
  };
  const shown = model ?? offer.model;
  return (
    <Modal title={done ? "The speech model is in" : "Dictation needs its speech model"} onClose={close}>
      {done ? (
        <p className="text-sm">Dictation hears on this {DEVICE} now. What you say never leaves it, and nothing is recorded.</p>
      ) : (
        <>
          <p className="text-sm">
            Writer hears you with its own speech model, on this {DEVICE}: what you say never leaves it, and nothing is recorded.
          </p>
          <div className="rounded-md border border-rule p-3">
            <ModelState model={shown} downloading={downloading} />
          </div>
          {downloadStopped && !downloading && <p className="text-sm text-danger">{downloadStopped}</p>}
        </>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {done ? (
          <>
            <Button onClick={close}>Close</Button>
            {offer.editor && !offer.editor.isDestroyed && (
              <Button
                variant="primary"
                onClick={() => {
                  close();
                  dictateFrom(offer.editor);
                }}
              >
                Dictate
              </Button>
            )}
          </>
        ) : downloading ? (
          <Button onClick={cancelDictationDownload}>Cancel download</Button>
        ) : (
          <>
            <Button onClick={close}>Not now</Button>
            <Button variant="primary" onClick={() => void download(offer.editor, false)}>
              {downloadStopped ? "Download again" : `Download it (${mb(shown.downloadBytes)} MB)`}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

function DictationSettingsForm({ onClose }: { onClose: () => void }) {
  const { settings, downloading, downloadStopped } = useDictation();
  const queryClient = useQueryClient();
  const model = useQuery({ queryKey: MODEL, queryFn: dictationModel });
  const setup = useQuery({ queryKey: SETUP, queryFn: dictationSettings });
  const [error, setError] = useState<string>();
  const ids = { recognizer: useId(), model: useId(), microphone: useId(), microphoneNote: useId(), silence: useId(), announce: useId() };

  // The model's state changes as its download ends.
  const wasDownloading = useDictation((s) => !!s.downloading);
  useEffect(() => {
    if (!wasDownloading) void queryClient.invalidateQueries({ queryKey: MODEL });
  }, [wasDownloading, queryClient]);

  const save = (changes: Parameters<typeof saveSettings>[0]) => {
    setError(undefined);
    saveSettings(changes).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  const recognizers = setup.data?.recognizers ?? [];
  const microphones = setup.data?.microphones ?? [];
  const chosen = settings.microphone;
  const connected = !chosen || microphones.some((m) => m.id === chosen.id);
  const bluetooth = chosen ? microphones.find((m) => m.id === chosen.id)?.bluetooth : microphones.some((m) => m.bluetooth);

  return (
    <Modal title="Dictation" onClose={onClose} className="max-w-lg">
      <p className="text-sm text-muted">What you say is heard on this {DEVICE}, by Writer itself, and never leaves it. Nothing you say is recorded or kept.</p>

      {recognizers.length > 1 ? (
        <fieldset className="grid gap-1.5">
          <legend className="text-sm font-medium">Hears with</legend>
          {recognizers.map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-sm">
              <input type="radio" name={ids.recognizer} checked={(settings.recognizer ?? recognizers[0]!.id) === r.id} onChange={() => save({ recognizer: r.id })} />
              {r.words}
            </label>
          ))}
        </fieldset>
      ) : (
        recognizers[0] && (
          <p className="text-sm">
            <span className="font-medium">Hears </span>
            {lowerFirst(recognizers[0].words)}.
          </p>
        )
      )}

      <section aria-labelledby={ids.model} className="grid gap-2 rounded-md border border-rule p-3">
        <h3 id={ids.model} className="text-sm font-medium">
          Speech model
        </h3>
        <ModelState model={model.data ?? undefined} downloading={downloading} />
        {downloadStopped && !downloading && <p className="text-sm text-danger">{downloadStopped}</p>}
        <div className="flex flex-wrap gap-2">
          {downloading ? (
            <Button size="sm" onClick={cancelDictationDownload}>
              Cancel download
            </Button>
          ) : model.data && model.data.state !== "ready" ? (
            <Button size="sm" variant="primary" onClick={() => void download(undefined, false)}>
              Download it
            </Button>
          ) : model.data?.state === "ready" ? (
            <Confirm
              trigger={<Button size="sm">Remove from this {DEVICE}</Button>}
              title="Remove the speech model?"
              description={`It frees ${mb(model.data.installedBytes)} MB. Dictation can't hear you until it's downloaded again.`}
              action="Remove it"
              danger
              onConfirm={() => void removeModel().then(() => queryClient.invalidateQueries({ queryKey: MODEL }), (e: unknown) => setError(e instanceof Error ? e.message : String(e)))}
            />
          ) : null}
        </div>
      </section>

      <div className="grid gap-1.5">
        <label htmlFor={ids.microphone} className="text-sm font-medium">
          Microphone
        </label>
        <select
          id={ids.microphone}
          value={chosen?.id ?? ""}
          aria-describedby={bluetooth ? ids.microphoneNote : undefined}
          onChange={(e) => {
            const picked = microphones.find((m) => m.id === e.target.value);
            save({ microphone: picked ? { id: picked.id, name: picked.name } : null });
          }}
          className="h-9 w-full min-w-0 rounded-md border border-rule bg-raised px-2 text-sm text-ink"
        >
          <option value="">The system's choice</option>
          {microphones.map((m) => (
            <option key={m.id} value={m.id}>
              {microphoneName(m)}
            </option>
          ))}
          {!connected && <option value={chosen.id}>{chosen.name} (not connected)</option>}
        </select>
        {bluetooth && (
          <p id={ids.microphoneNote} className="text-xs text-muted">
            {chosen
              ? "This is Bluetooth headphones' microphone. They switch to headset mode while you dictate, and sound poorer until you stop. Some computers stall for a moment as they switch back: choose the computer's own microphone to keep them as they are."
              : "If the system's choice is Bluetooth headphones, they switch to headset mode while you dictate, and sound poorer until you stop. Some computers stall for a moment as they switch back: choose the computer's own microphone to keep them as they are."}
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={ids.silence} className="text-sm font-medium">
          Stop listening after
        </label>
        <select
          id={ids.silence}
          value={settings.silenceSeconds}
          onChange={(e) => save({ silenceSeconds: Number(e.target.value) })}
          className="h-9 w-full min-w-0 rounded-md border border-rule bg-raised px-2 text-sm text-ink"
        >
          {SILENCES.map(([seconds, words]) => (
            <option key={seconds} value={seconds}>
              {words} without a word
            </option>
          ))}
          {!SILENCES.some(([s]) => s === settings.silenceSeconds) && <option value={settings.silenceSeconds}>{settings.silenceSeconds} seconds without a word</option>}
        </select>
      </div>

      <label htmlFor={ids.announce} className="flex items-start gap-2 text-sm">
        <input id={ids.announce} type="checkbox" checked={settings.announce} onChange={(e) => save({ announce: e.target.checked })} className="mt-0.5" />
        <span>Read each phrase out to a screen reader as it's written</span>
      </label>

      {error && <ErrorAlert title="Couldn't keep that">{error}</ErrorAlert>}
      <div className="flex justify-end">
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}

/** Where the speech model is: on this device, downloading, or to download. */
function ModelState({ model, downloading }: { model: DictationModel | undefined; downloading: { done: number; total: number } | undefined }) {
  if (downloading) {
    const percent = downloading.total ? Math.floor((100 * downloading.done) / downloading.total) : 0;
    return (
      <div className="grid gap-1 text-sm">
        <p>
          Downloading: {percent}% of {mb(downloading.total)} MB…
        </p>
        <progress value={downloading.done} max={Math.max(downloading.total, 1)} aria-label="Speech model downloaded" className="h-2 w-full accent-accent" />
      </div>
    );
  }
  if (!model) return <p className="text-sm text-muted">…</p>;
  if (model.state === "ready") return <p className="text-sm">
        Writer's speech model for English is on this {DEVICE}: {mb(model.installedBytes)} MB.
      </p>;
  if (model.state === "damaged") return <p className="text-sm">
        The speech model is damaged on this {DEVICE}: download it again, {mb(model.downloadBytes)} MB.
      </p>;
  return (
    <p className="text-sm">
      Writer's speech model for English isn't on this {DEVICE} yet: {mb(model.downloadBytes)} MB to download, {mb(model.installedBytes)} MB once it's in. It's downloaded once, from GitHub.
    </p>
  );
}

const microphoneName = (m: Microphone) => (m.bluetooth ? `${m.name} (Bluetooth)` : m.name);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
