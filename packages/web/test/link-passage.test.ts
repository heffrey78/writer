import { join } from "node:path";
import { loadBook, passagesOf } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { expect, test } from "vitest";
import { linkedBody } from "../src/bible/link-passage.ts";

const novel = await loadBook(nodeSource(join(import.meta.dirname, "../../../examples/sample-novel")));
const BEN = "char_b3n0vs";
const unlinked = () => passagesOf(novel, BEN).filter((p) => !p.linked);

test("links a plain name by changing only its bytes, as the editor writes a mention", () => {
  for (const p of unlinked()) {
    const body = p.piece.body;
    const out = linkedBody(novel, p, BEN, body)!;
    const [from, to] = p.raw!;
    expect(out).toBe(`${body.slice(0, from)}[${body.slice(from, to)}](#${BEN})${body.slice(to)}`);
    // Everything else byte for byte.
    expect(out.slice(0, from)).toBe(body.slice(0, from));
    expect(out.slice(out.length - (body.length - to))).toBe(body.slice(to));
  }
});

test("finds the name again when the piece has changed elsewhere, or in its paragraph around the sentence", () => {
  const p = unlinked().find((x) => x.piece.title === "The Flood")!;
  const sentence = p.block.text.slice(...p.block.sentence);
  // A paragraph added at the top: the passage moves.
  const added = `A new opening paragraph.\n\n${p.piece.body}`;
  const out = linkedBody(novel, p, BEN, added)!;
  expect(out).toContain(`[Ben](#${BEN})`);
  expect(out.replace(`[Ben](#${BEN})`, "Ben")).toBe(added);
  // Its paragraph changed, its sentence not.
  const changed = p.piece.body.replace(sentence, `Rain fell. ${sentence}`);
  expect(changed).not.toBe(p.piece.body);
  const again = linkedBody(novel, p, BEN, changed)!;
  expect(again.replace(`[Ben](#${BEN})`, "Ben")).toBe(changed);
  expect(again.indexOf(`[Ben](#${BEN})`)).toBe(changed.indexOf(sentence) + p.block.at[0] - p.block.sentence[0]);
});

test("links nothing when the sentence reads differently now, or the passage is a mention already", () => {
  const p = unlinked()[0]!;
  const sentence = p.block.text.slice(...p.block.sentence);
  expect(linkedBody(novel, p, BEN, p.piece.body.replace(sentence, "Something else entirely."))).toBeUndefined();
  const mention = passagesOf(novel, BEN).find((x) => x.linked)!;
  expect(linkedBody(novel, mention, BEN, mention.piece.body)).toBeUndefined();
});
