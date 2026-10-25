// The clips the spike hears, into clips/ (not committed): LibriSpeech's test-clean and test-other,
// read audiobook speech, a few utterances from each of several speakers, joined with pauses as
// dictation has them. Each passage is a 16 kHz mono WAV and a JSON of its utterances: where each
// starts and ends in the passage, and what was said.
//
//   node fetch-clips.ts
//
// The owner's own clips (record.sh) go in clips/ beside these, in the same form.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dirname;
const clips = join(here, "clips");
const RATE = 16_000;
/** The pause between utterances: long enough to settle a phrase, as a writer pausing to think. */
const PAUSE_S = 1.2;
const SPEAKERS = 8;
const PER_SPEAKER = 3;

mkdirSync(clips, { recursive: true });

for (const set of ["test-clean", "test-other"]) {
  const out = join(clips, `librispeech-${set}`);
  if (existsSync(`${out}.wav`)) continue;
  const root = join(clips, "LibriSpeech", set);
  if (!existsSync(root)) {
    console.log(`fetching ${set}`);
    execFileSync("sh", ["-c", `curl -sSL https://www.openslr.org/resources/12/${set}.tar.gz | tar xz -C '${clips}'`], { stdio: "inherit" });
  }
  const utterances: { file: string; text: string }[] = [];
  for (const speaker of readdirSync(root).sort((a, b) => Number(a) - Number(b)).slice(0, SPEAKERS)) {
    const chapter = readdirSync(join(root, speaker)).sort()[0]!;
    const dir = join(root, speaker, chapter);
    const lines = readFileSync(join(dir, `${speaker}-${chapter}.trans.txt`), "utf8").trim().split("\n");
    for (const line of lines.slice(0, PER_SPEAKER)) {
      const [id, ...words] = line.split(" ");
      utterances.push({ file: join(dir, `${id}.flac`), text: words.join(" ") });
    }
  }
  // Each utterance as raw 16 kHz samples, then all of them with a pause between.
  const pause = Buffer.alloc(Math.round(PAUSE_S * RATE) * 2);
  const parts: Buffer[] = [pause];
  const said: { start: number; end: number; text: string }[] = [];
  let at = pause.length / 2;
  for (const u of utterances) {
    const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", u.file, "-f", "s16le", "-ac", "1", "-ar", String(RATE), "-"], { maxBuffer: 1 << 28 });
    said.push({ start: at / RATE, end: (at + pcm.length / 2) / RATE, text: u.text });
    parts.push(pcm, pause);
    at += pcm.length / 2 + pause.length / 2;
  }
  const pcm = Buffer.concat(parts);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "s16le", "-ar", String(RATE), "-ac", "1", "-i", "-", `${out}.wav`], { input: pcm });
  writeFileSync(`${out}.json`, JSON.stringify({ source: `LibriSpeech ${set}`, rate: RATE, seconds: at / RATE, utterances: said }, null, 2));
  console.log(`${out}.wav: ${said.length} utterances, ${(at / RATE).toFixed(1)} s`);
}
