import type { BookKind } from "./kinds.ts";
import { recordTypesOf } from "./modules.ts";

/** Lowercase Crockford base32: digits and letters without i, l, o, u. */
export const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
export const ID_LENGTH = 6;
export const ID_PATTERN = /^([a-z]{2,8})_([0-9a-hjkmnp-tv-z]{6})$/;

/** Prefixes of the records every kind of book has; the book's own, its sections' and pieces' are its kind's, and its modules' records' theirs. */
export const RECORD_PREFIXES = {
  relationship: "rel",
  note: "note",
} as const;

export interface EntityTypeDef {
  key: string;
  prefix: string;
  folder: string;
  label: string;
  color?: string;
  builtin: boolean;
  /** What its entries are, where a feature needs to know: people (who can't be in two places at once) or places. */
  is?: "person" | "place";
}

/** Prefixes a book's own entry types may not use: its kind's, its modules' records' and every kind's records'. */
export function reservedPrefixes(kind: BookKind): ReadonlySet<string> {
  return new Set([
    kind.prefix,
    ...kind.levels.map((l) => l.prefix),
    kind.piece.prefix,
    ...Object.values(RECORD_PREFIXES),
    ...recordTypesOf(kind).map((t) => t.prefix),
    ...kind.entityTypes.map((t) => t.prefix),
  ]);
}

export function isId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/** The prefix of an ID, or undefined if it is not a well-formed ID. */
export function idPrefix(id: string): string | undefined {
  return ID_PATTERN.exec(id)?.[1];
}

/** Generate a new random ID with the given prefix. */
export function newId(prefix: string, randomBytes: (n: number) => Uint8Array = cryptoRandom): string {
  if (!/^[a-z]{2,8}$/.test(prefix)) throw new Error(`Invalid ID prefix: ${prefix}`);
  const bytes = randomBytes(ID_LENGTH);
  let suffix = "";
  for (const b of bytes) suffix += ID_ALPHABET[b & 31];
  return `${prefix}_${suffix}`;
}

function cryptoRandom(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}
