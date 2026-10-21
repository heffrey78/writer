import { nodeGitPort } from "./git-port/node.ts";
import { setPorts } from "./ports.ts";

/** The server's ports on Node (D16): git itself. Called by the CLI, the desktop app's server and the tests. */
export function useNodePorts(): void {
  setPorts({ git: nodeGitPort });
}
