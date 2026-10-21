import { kindByKey } from "@writer/core";
import { parseProse, serializeProse } from "@writer/editor";
import { describe, expect, it } from "vitest";

/** A kind's piece template (#42) is written as the editor writes it, so a new piece opened and left alone is saved byte for byte. */

describe("a kind's piece template", () => {
  it.each(["campaign"])("of the %s comes back from the editor as it went in", (key) => {
    const template = kindByKey(key).piece.template!;
    expect(template).toBeTruthy();
    expect(serializeProse(parseProse(template))).toBe(template);
  });
});
