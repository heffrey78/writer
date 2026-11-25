/*
 * What other apps share with Writer on Android (#204, #205): pictures, text and links, which the
 * app's plugin keeps in the app's own storage until the page has written them into a book. The page
 * asks for them as it starts and when the app says one has come (a `writer-shared` event), and says
 * when one is written, so it's let go. In a browser there are none.
 */

/** A picture shared, its bytes base64. */
export interface SharedPicture {
  name: string;
  type: string;
  data: string;
}

/** One share: what came in one go from another app. */
export interface Share {
  id: string;
  /** When it came, in ms. */
  received: number;
  text?: string;
  /** What some apps send as its title (a page's, with its link). */
  subject?: string;
  pictures: SharedPicture[];
}

/** Whether the page is in Tauri's webview, which has the app's commands: elsewhere nothing is shared. */
const inApp = () => "__TAURI_INTERNALS__" in window;

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(command, args);
}

/** What's been shared and not yet written into a book, oldest first. */
export async function pendingShares(): Promise<Share[]> {
  if (!inApp()) return [];
  return (await invoke<{ shares: Share[] }>("shares").catch(() => ({ shares: [] }))).shares;
}

/** The share `id` is written into a book (or let go): the app forgets it. */
export async function shareDone(id: string): Promise<void> {
  if (inApp()) await invoke("share_done", { id });
}

/** Call `heard` when the app says something's been shared. */
export function onShared(heard: () => void): () => void {
  window.addEventListener("writer-shared", heard);
  return () => window.removeEventListener("writer-shared", heard);
}

/** A shared picture as a file, for the picture flow. */
export function pictureFile(p: SharedPicture): File {
  const text = atob(p.data);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return new File([bytes], p.name, { type: p.type });
}

const LINK = /\bhttps?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]'"]/gi;

/** The first link in what's shared, and the words that came with it (the text without it), if any. */
export function sharedLink(share: Pick<Share, "text">): { url: string; words: string } | undefined {
  const url = share.text?.match(LINK)?.[0];
  if (!url) return undefined;
  // The words around it closed up: "Old bridges https://… ." reads "Old bridges.".
  return { url, words: share.text!.replace(url, "").replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim() };
}

/**
 * A title for a note made of what's shared: its subject (a page's title), the words that came with a
 * link or the text's first line, the link's site, or what it is ("A picture", "3 pictures").
 */
export function sharedTitle(share: Omit<Share, "id" | "received">): string {
  const clip = (s: string) => (s.length > 80 ? `${s.slice(0, 79).trimEnd()}…` : s);
  if (share.subject) return clip(share.subject);
  const link = sharedLink(share);
  const firstLine = (link ? link.words : (share.text ?? "")).split("\n").map((l) => l.trim()).find(Boolean);
  if (firstLine) return clip(firstLine);
  if (link) return new URL(link.url).hostname.replace(/^www\./, "");
  const n = share.pictures.length;
  return n === 1 ? "A picture" : `${n} pictures`;
}

/**
 * What's shared as Markdown for a note: its words, each link kept as a link (Writer doesn't fetch the
 * page), the subject its words where a link came alone, then each picture saved on a line of its own.
 */
export function sharedMarkdown(share: Omit<Share, "id" | "received" | "pictures">, pictures: { url: string; alt: string }[]): string {
  const parts: string[] = [];
  const text = share.text?.trim();
  if (text) {
    const link = sharedLink(share);
    if (link && !link.words && share.subject) parts.push(`[${escapeText(share.subject)}](${link.url})`);
    else parts.push(...text.split(/\n\s*\n/).map((p) => p.trim().replace(LINK, (url) => `<${url}>`)));
  }
  for (const p of pictures) parts.push(`![${escapeText(p.alt)}](${p.url})`);
  return parts.length ? `${parts.join("\n\n")}\n` : "";
}

/** Text for a link's or a picture's square brackets. */
function escapeText(s: string): string {
  return s.replace(/[\\[\]]/g, (c) => `\\${c}`).replace(/\s+/g, " ").trim();
}
