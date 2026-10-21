import { resolve } from "node:path";
import { convertBook, OperationError } from "@writer/server";

/** Make the book in `dir` a book of the kind `to`, as one commit, and return the process exit code. */
export async function runConvert(dir: string, to: string, out: (s: string) => void = console.log, err: (s: string) => void = console.error): Promise<number> {
  try {
    const { commit, files, notes } = await convertBook(resolve(dir), to);
    out(`Made a ${to}, ${commit ? `in commit ${commit.slice(0, 7)}` : "with nothing to commit"} (${files.length} files).`);
    for (const note of notes) out(`  ${note}`);
    return 0;
  } catch (e) {
    if (!(e instanceof OperationError)) throw e;
    err(e.message);
    return 1;
  }
}
