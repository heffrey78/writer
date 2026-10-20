import { describe, expect, it } from "vitest";
import { kindByKey, schemaFor, SCHEMAS, V2_KIND, withModules, type SchemaKind } from "@writer/core";
import { KINDS, novel } from "../src/index.ts";

describe("the Novel kind", () => {
  it("is the kind of every book in format v2", () => {
    // Registered with what its modules add: its point of view.
    expect(kindByKey(V2_KIND)).toBe(withModules(novel));
  });

  it("gives back the committed schemas, which are a novel's (#21)", () => {
    for (const name of Object.keys(SCHEMAS) as SchemaKind[]) expect(schemaFor(name, withModules(novel)), name).toEqual(SCHEMAS[name]);
  });

  it("has a prefix of its own for the book, each level, the scene and each built-in type", () => {
    const prefixes = [novel.prefix, ...novel.levels.map((l) => l.prefix), novel.piece.prefix, ...novel.entityTypes.map((t) => t.prefix)];
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

describe("kinds of book", () => {
  it("have keys of their own", () => {
    expect(new Set(KINDS.map((k) => k.key)).size).toBe(KINDS.length);
  });

  it("must be registered before a book of theirs is read", () => {
    expect(() => kindByKey("almanac")).toThrow(/No kind of book “almanac” is registered/);
  });
});
