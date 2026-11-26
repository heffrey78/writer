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

const OPENED = "writer.shares-opened";

/** The shares Save to Writer has shown, by ID: a writer who left one for later isn't sent back to it. */
export function openedShares(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPENED) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/** `shares` shown in Save to Writer: kept with those still waiting, the rest forgotten. */
export function markOpened(shares: Pick<Share, "id">[]): void {
  try {
    localStorage.setItem(OPENED, JSON.stringify(shares.map((s) => s.id)));
  } catch {
    // Not kept: the writer is sent to Save to Writer for these again, next time.
  }
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
 * link or the text's first line, or the link's site. Pictures alone have none: empty, for the writer's.
 */
export function sharedTitle(share: Omit<Share, "id" | "received">): string {
  const clip = (s: string) => (s.length > 80 ? `${s.slice(0, 79).trimEnd()}…` : s);
  if (share.subject) return clip(share.subject);
  const link = sharedLink(share);
  const firstLine = (link ? link.words : (share.text ?? "")).split("\n").map((l) => l.trim()).find(Boolean);
  if (firstLine) return clip(firstLine);
  if (link) return new URL(link.url).hostname.replace(/^www\./, "");
  // Pictures alone say nothing a title could be made of: the writer gives it.
  return "";
}

/**
 * The YouTube video a link is to, its ID: from youtube.com/watch?v=, youtu.be/, /shorts/, /live/ and
 * /embed/, on www., m. and music. too. Any other link has none.
 */
export function videoId(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  const id =
    host === "youtu.be" ? u.pathname.split("/")[1]
    : host === "youtube.com" ? (u.pathname === "/watch" ? u.searchParams.get("v") : u.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1])
    : undefined;
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : undefined;
}

/** How long Save waits for a video's picture before saving without it, in ms. */
export const VIDEO_PICTURE_WAIT = 4000;

/**
 * A YouTube video's picture (#229, a change to #205 that the owner agreed in #221), fetched once while
 * the share is saved: YouTube's own address for it, through the app's host (the page can't read
 * another site's bytes). Nothing if it's not there, or doesn't come within `wait` (offline, say): the
 * share is saved without it. The e2e names a site of its own in env.json, WRITER_VIDEO_PICTURES_URL.
 */
export async function videoPicture(id: string, wait = VIDEO_PICTURE_WAIT): Promise<SharedPicture | undefined> {
  if (!inApp()) return undefined;
  const fetched = (async () => {
    const facts = await invoke<{ env?: Record<string, string> }>("port", { port: "host", op: "facts", args: [] });
    const site = facts.env?.WRITER_VIDEO_PICTURES_URL || "https://img.youtube.com";
    const res = await invoke<{ status: number; headers: [string, string][]; body: { $bytes: string } }>("port", { port: "http", op: "fetch", args: [{ url: `${site}/vi/${id}/hqdefault.jpg`, method: "GET", headers: [] }] });
    const type = res.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1].split(";")[0]?.trim();
    if (res.status !== 200 || !type?.startsWith("image/")) return undefined;
    return { name: `${id}.jpg`, type, data: res.body.$bytes };
  })().catch(() => undefined);
  return Promise.race([fetched, new Promise<undefined>((done) => setTimeout(done, wait))]);
}

/**
 * What's shared as Markdown for a note: a video's picture first (#229), its words, a paragraph to a
 * line, each link kept as a link (Writer doesn't fetch the page), the subject its words where a link
 * came alone, then each picture saved on a line of its own, its caption with it.
 */
export function sharedMarkdown(share: Omit<Share, "id" | "received" | "pictures">, pictures: { url: string; alt: string; caption?: string }[], video?: { url: string; alt: string }): string {
  const parts: string[] = [];
  if (video) parts.push(`![${escapeText(video.alt)}](${video.url})`);
  const text = share.text?.trim();
  if (text) {
    const link = sharedLink(share);
    if (link && !link.words && share.subject) parts.push(`[${escapeText(share.subject)}](${link.url})`);
    // Each line its own paragraph: in Markdown, lines in one paragraph run together, and a recipe's
    // or a list's lines would read as one.
    else parts.push(...text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.replace(LINK, (url) => `<${url}>`)));
  }
  for (const p of pictures) parts.push(`![${escapeText(p.alt)}](${p.url}${p.caption ? ` "${p.caption.replace(/\s+/g, " ").trim().replace(/["\\]/g, (c) => `\\${c}`)}"` : ""})`);
  return parts.length ? `${parts.join("\n\n")}\n` : "";
}

/** Text for a link's or a picture's square brackets. */
function escapeText(s: string): string {
  return s.replace(/[\\[\]]/g, (c) => `\\${c}`).replace(/\s+/g, " ").trim();
}
