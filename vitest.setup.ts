// The tests are an entry point like the app's: they register the kinds of book it ships (D14), and
// give the server its ports on Node (D16).
import { registerKinds } from "@writer/kinds";
import { useNodePorts } from "@writer/server/node";

registerKinds();
useNodePorts();
