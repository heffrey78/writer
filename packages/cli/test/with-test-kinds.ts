// The CLI, knowing the test kinds too (#35): an entry point like the app's, which registers the kinds
// it ships, then the field guide, which the app doesn't ship. For tests that run `writer` on a book
// of a test kind (examples/sample-field-guide), here and in the web app's e2e.
import { registerKind } from "@writer/core";
import { registerKinds } from "@writer/kinds";
import { fieldGuide } from "../../core/test/kinds.ts";

registerKinds();
registerKind(fieldGuide);
await import("../src/main.ts");
