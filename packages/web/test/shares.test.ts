import { describe, expect, it } from "vitest";
import { pictureFile, sharedLink, sharedMarkdown, sharedTitle } from "../src/share/shares.ts";

/** What's shared from another app, made into a note (#205). */

const picture = { name: "IMG_2041.jpg", type: "image/jpeg", data: btoa("\xff\xd8\xff\xe0") };

describe("a note made of what's shared", () => {
  it("from a picture: titled for what it is, the picture on its own line", () => {
    const share = { pictures: [picture] };
    expect(sharedTitle(share)).toBe("A picture");
    expect(sharedTitle({ pictures: [picture, picture, picture] })).toBe("3 pictures");
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

  it("from text alone: titled by its first line, its paragraphs kept", () => {
    const share = { text: "  The ford floods in spring.\nAsk the ferryman.\n\nHe knows the depths.  ", pictures: [] };
    expect(sharedLink(share)).toBeUndefined();
    expect(sharedTitle(share)).toBe("The ford floods in spring.");
    expect(sharedMarkdown(share, [])).toBe("The ford floods in spring.\nAsk the ferryman.\n\nHe knows the depths.\n");
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
