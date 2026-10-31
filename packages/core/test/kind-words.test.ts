import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileBook, loadBook, vocabulary } from "../src/index.ts";
import { nodeSource } from "../src/node.ts";
import { snapshots } from "../src/snapshots.ts";

/**
 * What's generated for a book says its kind's words (#125): a journal's diagrams never say "story" or
 * "scene". A novel's words are what they were, down to the byte, so gh-writer's novels keep their files.
 */

const sample = (name: string) => fileURLToPath(new URL(`../../../examples/sample-${name}`, import.meta.url));
const NOVEL_WORDS = /\b(story|stories|scenes?)\b/i;

describe("what's generated", () => {
  for (const name of ["journal", "campaign", "nonfiction"]) {
    it(`for a ${name} has no novel's words, and is what its book holds`, async () => {
      const book = await loadBook(nodeSource(sample(name)));
      for (const [file, content] of snapshots(book)) {
        expect(`${file}: ${NOVEL_WORDS.exec(content)?.[0] ?? "none"}`).toBe(`${file}: none`);
        expect(readFileSync(`${sample(name)}/${file}`, "utf8")).toBe(content);
      }
    });
  }

  it("for a novel is byte for byte what it was, and still says story", async () => {
    const book = await loadBook(nodeSource(sample("novel")));
    const drawn = snapshots(book);
    const onDisk = readdirSync(`${sample("novel")}/diagrams`).filter((f) => f !== "layouts.yaml");
    expect([...drawn.keys()].sort()).toEqual(onDisk.map((f) => `diagrams/${f}`).sort());
    for (const [file, content] of drawn) expect(readFileSync(`${sample("novel")}/${file}`, "utf8")).toBe(content);
    expect(drawn.get("diagrams/README.md")).toContain("it's rewritten when the story changes.");
    expect(drawn.get("diagrams/timeline.svg")).toContain("The book in story time, and in reading order");
  });
});

describe("a compiled book", () => {
  it("names the break between its pieces in its kind's words", async () => {
    const named = async (name: string) => (await compileBook(await loadBook(nodeSource(sample(name))), nodeSource(sample(name)))).breakName;
    expect(await named("novel")).toBe("Scene break");
    expect(await named("journal")).toBe("Entry break");
    expect(await named("campaign")).toBe("Session break");
    expect(await named("nonfiction")).toBe("Section break");
  });
});

describe("a kind's words for its map and time", () => {
  it("are each kind's own, the novel's as they were", async () => {
    const said = async (name: string) => vocabulary((await loadBook(nodeSource(sample(name)))).kind);
    expect((await said("novel")).map.One).toBe("Story map");
    expect((await said("novel")).time.One).toBe("Story time");
    expect((await said("novel")).subject).toBe("story");
    expect((await said("journal")).map.One).toBe("Journal map");
    expect((await said("journal")).time).toEqual({ One: "Dates", in: "by date", In: "By date", order: "date order" });
    expect((await said("journal")).subject).toBe("journal");
    expect((await said("campaign")).map.One).toBe("Campaign map");
    expect((await said("campaign")).time.In).toBe("In campaign time");
    expect((await said("nonfiction")).map.One).toBe("Book map");
    expect((await said("nonfiction")).subject).toBe("book");
  });
});
