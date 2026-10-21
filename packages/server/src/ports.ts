import type { FileSource } from "@writer/core";
import { portSource, type FilesPort } from "./files-port/port.ts";
import type { GitPort } from "./git-port/port.ts";

/**
 * The ports the server is given by its host (D16): set once by each entry point, as it registers the
 * kinds of book: the CLI and the desktop app (Node's adapters, node-ports.ts), the tests, and later the
 * browser and Android. The server's code asks for them here, never for an adapter.
 */
export interface Ports {
  git: GitPort;
  files: FilesPort;
  host: Host;
}

/** What the server needs to know of where it runs: its folders, its environment, and how paths are written there. */
export interface Host {
  /** Environment variables (GIT_AUTHOR_NAME, and those the host reads itself); none on Android. */
  env(): Record<string, string | undefined>;
  /** Where Writer keeps library.json. */
  configDir(): string;
  /** Where new books and clones go unless the writer says otherwise. */
  booksDir(): string;
  /** gh-writer's config folder, whose library lists books to offer to import (#2); none where there's no gh-writer. */
  ghWriterConfigDir(): string | undefined;
  /** The book templates, a folder each by kind. */
  templates(): string;
  /** A folder the writer typed ("~/books/one", a relative path) as an absolute path. */
  absolute(path: string): string;
  /** A path as the writer reads it: their home folder as ~. */
  shown(path: string): string;
}

let ports: Ports | undefined;

export function setPorts(p: Ports): void {
  ports = p;
}

function given(): Ports {
  if (!ports) throw new Error("The server has no ports: its entry point calls setPorts (or useNodePorts) first.");
  return ports;
}

export function gitPort(): GitPort {
  return given().git;
}

export function filesPort(): FilesPort {
  return given().files;
}

export function host(): Host {
  return given().host;
}

/** A book's files as core's loader reads them, through the files port. */
export function bookSource(root: string): FileSource {
  return portSource(filesPort(), root);
}
