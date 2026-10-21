// Copy the tools vendored into the novel template (validate, snapshots, compile and its type) into
// another kind's template (`node scripts/vendor-tools.ts templates/journal`): every kind's books carry
// the same tools, which know every kind the app ships. Run by `npm run build:template`.
import { cpSync } from "node:fs";
import { join } from "node:path";

const from = "templates/novel/.github/gh-writer";
for (const dest of process.argv.slice(2)) {
  const to = join(dest, ".github/gh-writer");
  for (const file of ["validate.mjs", "snapshots.mjs", "compile.mjs"]) cpSync(join(from, file), join(to, file));
  cpSync(join(from, "fonts"), join(to, "fonts"), { recursive: true });
  console.log(`Vendored the tools into ${to}`);
}
