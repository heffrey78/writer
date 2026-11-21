import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { appendQuote, quotesIn } from "../src/index.ts";

describe("appendQuote", () => {
  it("adds the quote and its piece after a blank line, changing nothing before", () => {
    const quote = "counted them twice, the way you count stitches in a wound";
    const added = `> ${quote}\n\n— *The Station*\n`;
    expect(appendQuote("Voice: short sentences.\n", quote, "The Station")).toBe(`Voice: short sentences.\n\n${added}`);
    expect(appendQuote("Voice: short sentences.", quote, "The Station")).toBe(`Voice: short sentences.\n\n${added}`);
    expect(appendQuote("Voice.\n\n", quote, "The Station")).toBe(`Voice.\n\n${added}`);
    // An entry with no notes yet.
    expect(appendQuote("", quote, "The Station")).toBe(added);
    expect(appendQuote("\n", quote, "The Station")).toBe(`\n${added}`);
  });

  it("keeps a body's Windows line endings, and quotes paragraphs as one quote", () => {
    expect(appendQuote("Notes.\r\n", "One.\n\nTwo.", "Night")).toBe("Notes.\r\n\r\n> One.\r\n>\r\n> Two.\r\n\r\n— *Night*\r\n");
  });

  it("escapes a title Markdown would read as emphasis", () => {
    expect(appendQuote("", "x", "The *Real* Bridge")).toBe("> x\n\n— *The \\*Real\\* Bridge*\n");
  });
});

describe("quotesIn", () => {
  it("reads back every quote added, with its piece, among other notes and quotes", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            quote: fc.array(fc.stringMatching(/^[A-Za-z][A-Za-z ,.'’]{0,30}[a-z.]$/), { minLength: 1, maxLength: 3 }).map((ps) => ps.join("\n\n")),
            title: fc.stringMatching(/^[A-Z][A-Za-z '*_]{0,20}[a-z]$/),
          }),
          { maxLength: 4 },
        ),
        (added) => {
          let body = "Backstory.\n\n> A quote of my own, with no piece.\n";
          for (const { quote, title } of added) body = appendQuote(body, quote, title);
          expect(quotesIn(body)).toEqual(added);
          expect(quotesIn(body.replace(/\n/g, "\r\n"))).toEqual(added);
        },
      ),
    );
  });
});
