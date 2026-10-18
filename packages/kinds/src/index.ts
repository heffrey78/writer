import { registerKind, type BookKind } from "@writer/core";
import { novel } from "./novel.ts";

export { novel };

/** Every kind of book the app ships. */
export const KINDS: readonly BookKind[] = [novel];

/** Make the shipped kinds known to the base: each of the app's entry points calls this once (D14). */
export function registerKinds(): void {
  for (const kind of KINDS) registerKind(kind);
}
