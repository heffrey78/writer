import { useQuery } from "@tanstack/react-query";
import { ArrowUpCircle } from "lucide-react";
import { create } from "zustand";
import { api, keys } from "./api.ts";
import { Markdown } from "./issues/markdown.tsx";
import { Modal } from "./ui/dialog.tsx";

/** Whether the About dialog is open: from the ⋯ menu, the palette, or the update button. */
export const useAbout = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

/** The app's version and what it runs on, and a newer release: asked once a session (the server checks GitHub daily). */
export function useAppInfo() {
  return useQuery({ queryKey: keys.app, queryFn: api.app, staleTime: Infinity, retry: false });
}

/** In the top bar while a newer release is out (the desktop app only): opens About, with the notes and the download. */
export function UpdateButton() {
  const update = useAppInfo().data?.update;
  if (!update) return null;
  return (
    <button
      type="button"
      onClick={() => useAbout.getState().set(true)}
      className="flex items-center gap-1.5 rounded-md border border-rule px-2 py-1 text-sm text-ink hover:bg-paper"
    >
      <ArrowUpCircle className="size-4 text-accent" aria-hidden />
      Writer {update.version} is out
    </button>
  );
}

/**
 * About Writer: its version, the Node and git it runs on, a newer release's notes and download,
 * and, in the desktop app, the licences of what it ships (git's with where its source is: GPL-2.0).
 * The fonts it ships, everywhere (#192).
 */
export function AboutDialog() {
  const { open, set } = useAbout();
  const info = useAppInfo().data;
  const licenses = useQuery({ queryKey: keys.licenses, queryFn: api.licenses, enabled: open && !!info?.desktop, staleTime: Infinity });
  const fonts = useQuery({ queryKey: ["font-licences"], queryFn: fontLicences, enabled: open, staleTime: Infinity });
  if (!open) return null;
  return (
    <Modal title="About Writer" onClose={() => set(false)} className="max-w-2xl">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Version</dt>
        <dd>{info?.version ?? "Run from its source (writer serve)"}</dd>
        <dt className="text-muted">Node.js</dt>
        <dd>{info?.node ?? "…"}</dd>
        <dt className="text-muted">git</dt>
        <dd>{info ? `${info.git.version ?? "not found"}${info.git.bundled ? " (comes with Writer)" : " (this computer's)"}` : "…"}</dd>
      </dl>

      {info?.update && (
        <section aria-labelledby="about-update" className="mt-5 rounded-md border border-rule p-3">
          <h3 id="about-update" className="font-semibold">
            Writer {info.update.version} is out
          </h3>
          {info.update.notes && <Markdown text={info.update.notes} className="mt-2 max-h-60 overflow-auto text-sm" />}
          <p className="mt-2 text-sm">
            <a href={info.update.url} target="_blank" rel="noreferrer" className="text-accent underline">
              Download it from GitHub
            </a>
            , then install it over this one. Your books and settings stay as they are.
          </p>
        </section>
      )}

      {info?.desktop && (
        <section aria-labelledby="about-licenses" className="mt-5">
          <h3 id="about-licenses" className="font-semibold">
            Licences
          </h3>
          <p className="mt-1 text-sm text-muted">Writer is free software under the MIT licence. It comes with Node.js and git, each under its own licence.</p>
          {licenses.data?.map((l) => (
            <details key={l.name} className="mt-2 text-sm">
              <summary className="cursor-pointer">{l.name.replace(/\.(txt|md)$/, "")}</summary>
              <pre className="mt-1 max-h-60 overflow-auto rounded bg-paper p-2 text-xs whitespace-pre-wrap">{l.text}</pre>
            </details>
          ))}
        </section>
      )}

      <section aria-labelledby="about-fonts" className="mt-5">
        <h3 id="about-fonts" className="font-semibold">
          Fonts
        </h3>
        <p className="mt-1 text-sm text-muted">Writer comes with these fonts, each under the SIL Open Font License 1.1.</p>
        {fonts.data?.map((f) => (
          <details key={f.name} className="mt-2 text-sm">
            <summary className="cursor-pointer">{f.name}</summary>
            <pre className="mt-1 max-h-60 overflow-auto rounded bg-paper p-2 text-xs whitespace-pre-wrap">{f.text}</pre>
          </details>
        ))}
      </section>
    </Modal>
  );
}

const FONT_NAMES: Record<string, string> = {
  "atkinson-hyperlegible": "Atkinson Hyperlegible",
  "eb-garamond": "EB Garamond",
  "ibm-plex-mono": "IBM Plex Mono",
  inter: "Inter",
  literata: "Literata",
};

/** The fonts' licences, from beside them in fonts/: read only when About is open. */
async function fontLicences(): Promise<{ name: string; text: string }[]> {
  const files = import.meta.glob<string>("./fonts/*/OFL.txt", { query: "?raw", import: "default" });
  const out = await Promise.all(Object.entries(files).map(async ([path, load]) => ({ name: FONT_NAMES[path.split("/")[2]!] ?? path, text: await load() })));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
