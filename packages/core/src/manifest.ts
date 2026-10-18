import { V2_KIND } from "./kinds.ts";
import { parseYaml } from "./parse.ts";
import type { FileSource } from "./source.ts";

/*
 * A book's manifest: its settings, and what kind of book it is (D15). Format 3 keeps them in
 * book.yaml, which names the kind; formats 1 and 2 keep them in novel.yaml, and every book in them is
 * a novel. A folder with neither isn't a book.
 */

/** Format 3's manifest. */
export const MANIFEST = "book.yaml";

/** Formats 1 and 2's manifest, a novel's. */
export const NOVEL_MANIFEST = "novel.yaml";

/** The newest format this build reads and writes: 3, book.yaml naming the book's kind. */
export const SCHEMA_VERSION = 3;

/** The format that keeps off-page events as files of their own (D11): what an event change needs a novel in. */
export const EVENT_FILES_FORMAT = 2;

export interface Manifest {
  /** book.yaml or novel.yaml. */
  file: string;
  text: string;
  /** Its schema_version (novel.yaml without one is format 1). */
  version: number;
  /** The kind it names: a novel for novel.yaml; undefined for a book.yaml that names none. */
  kind: string | undefined;
}

/** The book's manifest: book.yaml if it has one, else novel.yaml; undefined in a folder with neither. */
export async function readManifest(source: Pick<FileSource, "read">): Promise<Manifest | undefined> {
  for (const file of [MANIFEST, NOVEL_MANIFEST]) {
    const text = await source.read(file);
    if (text === undefined) continue;
    const data = parseYaml(text, file).data;
    const fields = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
    const version = typeof fields["schema_version"] === "number" ? fields["schema_version"] : file === MANIFEST ? SCHEMA_VERSION : 1;
    const kind = file === NOVEL_MANIFEST ? V2_KIND : typeof fields["kind"] === "string" ? fields["kind"] : undefined;
    return { file, text, version, kind };
  }
  return undefined;
}
