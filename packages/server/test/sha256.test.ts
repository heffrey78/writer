import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sha256 } from "../src/sha256.ts";

/** The engine's SHA-256 (D16) gives node:crypto's hex for any text or bytes: a write's base is the same hash on every host. */

const node = (x: string | Uint8Array) => createHash("sha256").update(x).digest("hex");

describe("sha256", () => {
  it("matches the standard's examples", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("matches node:crypto for any text and any bytes, across block edges", () => {
    fc.assert(fc.property(fc.string({ unit: "grapheme", maxLength: 300 }), (s) => sha256(s) === node(s)));
    fc.assert(fc.property(fc.uint8Array({ maxLength: 300 }), (b) => sha256(b) === node(b)));
    for (let n = 50; n < 140; n++) expect(sha256("x".repeat(n))).toBe(node("x".repeat(n)));
  });
});
