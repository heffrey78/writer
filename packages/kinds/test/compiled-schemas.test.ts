import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validate } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { describe, expect, it } from "vitest";
import { compiledSchemas } from "../../../scripts/compile-schemas.ts";
import { useCompiledKindSchemas } from "../src/compiled-schemas.ts";

/** The shipped kinds' validators compiled ahead of time (#51), for the engine in a page: current, and judging as Ajv does at run time. */

const generated = (name: string) => readFileSync(fileURLToPath(new URL(`../generated/${name}`, import.meta.url)), "utf8");
const sample = (name: string) => fileURLToPath(new URL(`../../../examples/${name}`, import.meta.url));

describe("the compiled schemas", () => {
  it("are those the kinds' schemas compile to now (else run `npm run build:template`)", () => {
    for (const [name, text] of compiledSchemas().files) expect(generated(name), `${name}: run \`npm run build:template\``).toBe(text);
  });

  it("judge the sample books as the schemas compiled at run time do", async () => {
    const books = ["sample-novel", "sample-journal", "sample-campaign", "sample-nonfiction"];
    const before = await Promise.all(books.map(async (b) => (await validate(nodeSource(sample(b)))).diagnostics));
    useCompiledKindSchemas();
    const after = await Promise.all(books.map(async (b) => (await validate(nodeSource(sample(b)))).diagnostics));
    expect(after).toEqual(before);
  });
});
