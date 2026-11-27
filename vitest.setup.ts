// The tests are an entry point like the app's: they register the kinds of book it ships (D14), and
// give the server its ports on Node (D16).
import { registerKinds } from "@writer/kinds";
import { useNodePorts } from "@writer/server/node";
import { afterAll } from "vitest";

registerKinds();
useNodePorts();

// A dialog closed by a file's last cleanup gives the focus back on a timer (ui/dialog.tsx): it runs
// before the file's jsdom is taken down, not after, where it finds no document.
afterAll(() => new Promise((done) => setTimeout(done)));
