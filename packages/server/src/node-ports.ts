import { nodeFilesPort } from "./files-port/node.ts";
import { nodeGitPort } from "./git-port/node.ts";
import { nodeHost } from "./node-host.ts";
import { setPorts } from "./ports.ts";

/** The server's ports on Node (D16): git itself, the disk, and Node's host. Called by the CLI, the desktop app's server and the tests. */
export function useNodePorts(): void {
  setPorts({ git: nodeGitPort, files: nodeFilesPort, host: nodeHost });
}
