import type { GitPort } from "./git-port/port.ts";

/**
 * The ports the server is given by its host (D16): set once by each entry point, as it registers the
 * kinds of book: the CLI and the desktop app (Node's adapters, node-ports.ts), the tests, and later the
 * browser and Android. The server's code asks for them here, never for an adapter.
 */
export interface Ports {
  git: GitPort;
}

let ports: Ports | undefined;

export function setPorts(p: Ports): void {
  ports = p;
}

export function gitPort(): GitPort {
  if (!ports) throw new Error("The server has no ports: its entry point calls setPorts (or useNodePorts) first.");
  return ports.git;
}
