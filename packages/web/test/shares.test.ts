import { afterEach, describe, expect, it, vi } from "vitest";
import { parseProse, serializeProse } from "@writer/editor";
import { pictureFile, sharedLink, sharedMarkdown, sharedTitle, videoId, videoPicture } from "../src/share/shares.ts";
import { cardText, leadingSite } from "../src/notes/note-card.tsx";

const invoked = vi.hoisted(() => ({ answer: (_c: string, _a: Record<string, unknown>): Promise<unknown> => Promise.resolve(undefined), calls: [] as unknown[] }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (command: string, args: Record<string, unknown>) => (invoked.calls.push({ command, args }), invoked.answer(command, args)) }));

/** What's shared from another app, made into a note (#205). */

const picture = { name: "IMG_2041.jpg", type: "image/jpeg", data: btoa("\xff\xd8\xff\xe0") };

describe("a note made of what's shared", () => {
  it("from a picture: no title made up, the picture on its own line, a description given as its caption", () => {
    expect(sharedTitle({ pictures: [picture] })).toBe("");
    expect(sharedTitle({ pictures: [picture, picture, picture] })).toBe("");
    const captioned = sharedMarkdown({}, [{ url: "/images/a.jpg", alt: "Camping", caption: 'The "big" tent \\ by the lake' }]);
    expect(captioned).toBe('![Camping](/images/a.jpg "The \\"big\\" tent \\\\ by the lake")\n');
    // As the editor writes it: the note opens and saves byte for byte.
    expect(serializeProse(parseProse(captioned))).toBe(captioned);
    expect(sharedMarkdown({}, [{ url: "/images/the-toll-house.jpg", alt: "The toll house" }])).toBe("![The toll house](/images/the-toll-house.jpg)\n");
    expect(sharedMarkdown({}, [{ url: "/images/a.jpg", alt: "A [rough] sketch" }, { url: "/images/b.jpg", alt: "Another" }])).toBe("![A \\[rough\\] sketch](/images/a.jpg)\n\n![Another](/images/b.jpg)\n");
  });

  it("from a link with words: titled by its subject or its words, the link kept as a link, nothing fetched", () => {
    const share = { text: "Old bridges of the valley https://example.com/bridges?page=2.", pictures: [] };
    expect(sharedLink(share)).toEqual({ url: "https://example.com/bridges?page=2", words: "Old bridges of the valley." });
    expect(sharedTitle(share)).toBe("Old bridges of the valley.");
    expect(sharedTitle({ ...share, subject: "Bridges of the Varn" })).toBe("Bridges of the Varn");
    expect(sharedMarkdown(share, [])).toBe("Old bridges of the valley <https://example.com/bridges?page=2>.\n");
  });

  it("from a link alone: titled by its subject, or its site", () => {
    const share = { text: "https://www.example.com/ford", pictures: [] };
    expect(sharedTitle(share)).toBe("example.com");
    expect(sharedMarkdown(share, [])).toBe("<https://www.example.com/ford>\n");
    expect(sharedTitle({ ...share, subject: "The ford at Varn" })).toBe("The ford at Varn");
    expect(sharedMarkdown({ ...share, subject: "The ford at Varn" }, [])).toBe("[The ford at Varn](https://www.example.com/ford)\n");
  });

  it("from text alone: titled by its first line, each line kept as a paragraph of its own", () => {
    const share = { text: "  The ford floods in spring.\nAsk the ferryman.\n\nHe knows the depths.  ", pictures: [] };
    expect(sharedLink(share)).toBeUndefined();
    expect(sharedTitle(share)).toBe("The ford floods in spring.");
    expect(sharedMarkdown(share, [])).toBe("The ford floods in spring.\n\nAsk the ferryman.\n\nHe knows the depths.\n");
    const recipe = "Crust\n2½ cups flour\n1 cup cold butter";
    expect(sharedMarkdown({ text: recipe }, [])).toBe("Crust\n\n2½ cups flour\n\n1 cup cold butter\n");
    expect(sharedTitle({ text: "x".repeat(100), pictures: [] })).toBe(`${"x".repeat(79)}…`);
  });

  it("from a picture with words: the words, then the picture", () => {
    expect(sharedMarkdown({ text: "From the north bank" }, [{ url: "/images/north.jpg", alt: "The north bank" }])).toBe("From the north bank\n\n![The north bank](/images/north.jpg)\n");
  });

  it("reads a shared picture's bytes as a file", async () => {
    const file = pictureFile(picture);
    expect(file.name).toBe("IMG_2041.jpg");
    expect(file.type).toBe("image/jpeg");
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });
});

describe("a YouTube link's picture (#229)", () => {
  it("is of the video a link is to, in each form YouTube's links take, and of no other link", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=42",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=x",
      "https://youtu.be/dQw4w9WgXcQ?si=abc",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ?si=abc",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    ])
      expect(videoId(url), url).toBe("dQw4w9WgXcQ");
    for (const url of ["https://www.youtube.com/", "https://www.youtube.com/@channel", "https://www.youtube.com/watch?v=short", "https://example.com/watch?v=dQw4w9WgXcQ", "https://notyoutube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/../etc/passwd!", "ftp://youtu.be/dQw4w9WgXcQ", "not a link"])
      expect(videoId(url), url).toBeUndefined();
  });

  it("goes first in the note, before the link, named by the note's title, and the card still shows the link's site", () => {
    const share = { text: "https://youtu.be/dQw4w9WgXcQ", subject: "Riveting a truss bridge" };
    const body = sharedMarkdown(share, [], { url: "/images/riveting-a-truss-bridge.jpg", alt: "Riveting a truss bridge" });
    expect(body).toBe("![Riveting a truss bridge](/images/riveting-a-truss-bridge.jpg)\n\n[Riveting a truss bridge](https://youtu.be/dQw4w9WgXcQ)\n");
    expect(serializeProse(parseProse(body))).toBe(body);
    expect(leadingSite(body)).toBe("youtu.be");
    expect(leadingSite(sharedMarkdown({ text: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, [], { url: "/images/a.jpg", alt: 'A "video" [1]' }))).toBe("youtube.com");
    expect(cardText(sharedMarkdown({ text: "Watch how it's done https://youtu.be/dQw4w9WgXcQ" }, [], { url: "/images/a.jpg", alt: "A" }))).toBe("Watch how it's done");
  });

  describe("fetched while saving", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
      invoked.calls = [];
    });
    const inApp = (env: Record<string, string>, fetched: (url: string) => Promise<unknown>) => {
      vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
      invoked.answer = (command, args) => {
        const a = args as { port: string; op: string; args: [{ url: string }] };
        if (command === "port" && a.port === "host" && a.op === "facts") return Promise.resolve({ env });
        if (command === "port" && a.port === "http" && a.op === "fetch") return fetched(a.args[0].url);
        return Promise.reject(new Error(`No ${command}`));
      };
    };
    const jpeg = { status: 200, headers: [["Content-Type", "image/jpeg"]], body: { $bytes: btoa("\xff\xd8\xff") } };

    it("from YouTube's own address for it, once, through the app's host", async () => {
      inApp({}, () => Promise.resolve(jpeg));
      expect(await videoPicture("dQw4w9WgXcQ")).toEqual({ name: "dQw4w9WgXcQ.jpg", type: "image/jpeg", data: btoa("\xff\xd8\xff") });
      const fetches = invoked.calls.filter((c) => (c as { args: { port: string } }).args.port === "http");
      expect(fetches).toEqual([{ command: "port", args: { port: "http", op: "fetch", args: [{ url: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg", method: "GET", headers: [] }] } }]);
    });

    it("from the site env.json names, for the e2e", async () => {
      const urls: string[] = [];
      inApp({ WRITER_VIDEO_PICTURES_URL: "http://127.0.0.1:5000" }, (url) => (urls.push(url), Promise.resolve(jpeg)));
      await videoPicture("dQw4w9WgXcQ");
      expect(urls).toEqual(["http://127.0.0.1:5000/vi/dQw4w9WgXcQ/hqdefault.jpg"]);
    });

    it("is nothing when it isn't there, isn't a picture, fails or is offline", async () => {
      inApp({}, () => Promise.resolve({ ...jpeg, status: 404 }));
      expect(await videoPicture("dQw4w9WgXcQ")).toBeUndefined();
      inApp({}, () => Promise.resolve({ ...jpeg, headers: [["content-type", "text/html; charset=utf-8"]] }));
      expect(await videoPicture("dQw4w9WgXcQ")).toBeUndefined();
      inApp({}, () => Promise.reject({ message: "fetch failed: dns error" }));
      expect(await videoPicture("dQw4w9WgXcQ")).toBeUndefined();
    });

    it("is nothing when it doesn't come in time: the share is saved without waiting longer", async () => {
      vi.useFakeTimers();
      inApp({}, () => new Promise(() => {}));
      const asked = videoPicture("dQw4w9WgXcQ", 4000);
      await vi.advanceTimersByTimeAsync(4000);
      expect(await asked).toBeUndefined();
    });

    it("is never asked for outside the app", async () => {
      vi.stubGlobal("window", {});
      expect(await videoPicture("dQw4w9WgXcQ")).toBeUndefined();
      expect(invoked.calls).toEqual([]);
    });
  });
});
