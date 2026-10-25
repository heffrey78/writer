// The owner's own clips (#78): two passages read aloud, a paragraph at a time, into clips/ as
// owner-novel and owner-journal, in the same form as the LibriSpeech passages, with the passages'
// own punctuation as what was said (so the bench can score prose, not only words).
//
//   node record.ts            both passages
//   node record.ts journal    one of them
//
// Each paragraph: Enter to start, read it at a dictating pace, Enter to stop. The microphone is the
// system's default input (PipeWire's pw-record).

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const here = import.meta.dirname;
const clips = join(here, "clips");
const RATE = 16_000;
const PAUSE_S = 1.2;

/** A scene's paragraphs as read: no front matter, a mention as its name. */
function scene(path: string): string[] {
  const body = readFileSync(join(here, "../../examples/sample-novel/manuscript", path), "utf8").split(/^---$/m).slice(2).join("---");
  return body.split(/\n\s*\n/).map((p) => p.replace(/\[([^\]]+)\]\(#[^)]+\)/g, "$1").replace(/\s+/g, " ").trim()).filter(Boolean);
}

const PASSAGES: Record<string, string[]> = {
  // The sample novel's first two scenes: its people and places by name.
  novel: [...scene("01-return/01-arrival/01-the-station.md"), ...scene("01-return/01-arrival/02-the-bridge.md")],
  // A journal entry in the sample journal's voice, with its people and places.
  journal: [
    "Out to the spit before seven. The tide was already turning, and Mira had counted forty curlew by the time I got there.",
    "Tomas came down with the flask at nine. We sat on the old groyne and argued about whether the godwits were late or we were early.",
    "In the afternoon I walked back along the sluice. The reeds are going gold at the edges, and the water was so still it held the whole sky.",
    "I keep meaning to write down what I see before I see it differently. Today it was the light on the mud: silver, then brown, then nothing.",
    "Patience is a choice too. Tomorrow, the first proper count of the season.",
  ],
};

/** What's wrong with a take's level, if anything: clipped, or too quiet. */
function level(pcm: Buffer): string | undefined {
  const n = pcm.length / 2;
  let clipped = 0;
  const frames: number[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = pcm.readInt16LE(i * 2);
    if (Math.abs(s) >= 32767) clipped++;
    sum += s * s;
    if ((i + 1) % 800 === 0) {
      frames.push(Math.sqrt(sum / 800) / 32768);
      sum = 0;
    }
  }
  frames.sort((a, b) => a - b);
  const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-6));
  const quiet = db(frames[Math.floor(frames.length * 0.1)] ?? 0);
  const loud = db(frames[Math.floor(frames.length * 0.9)] ?? 0);
  if (clipped / n > 0.005) return `Too loud for the microphone: ${((100 * clipped) / n).toFixed(1)}% of it clipped. Turn the input down in the system's sound settings (around a third is often right).`;
  if (quiet > -30) return `Too loud even between words (${quiet.toFixed(0)} dBFS): turn the input down in the system's sound settings.`;
  if (loud < -40) return `Too quiet (${loud.toFixed(0)} dBFS at its loudest): turn the input up, or move closer.`;
  return undefined;
}

const ask = createInterface({ input: process.stdin, output: process.stdout });
mkdirSync(clips, { recursive: true });

for (const name of process.argv[2] ? [process.argv[2]] : Object.keys(PASSAGES)) {
  const paragraphs = PASSAGES[name];
  if (!paragraphs) throw new Error(`No passage ${name}: novel or journal`);
  console.log(`\n=== ${name}: ${paragraphs.length} paragraphs. Read each at the pace you'd dictate, pausing where you'd pause.\n`);
  const pause = Buffer.alloc(Math.round(PAUSE_S * RATE) * 2);
  const parts: Buffer[] = [pause];
  const said: { start: number; end: number; text: string }[] = [];
  let at = pause.length / 2;
  for (const [i, text] of paragraphs.entries()) {
    console.log(`\n[${i + 1}/${paragraphs.length}] ${text}\n`);
    let pcm: Buffer;
    for (;;) {
      await ask.question("Enter to start…");
      const take = join(clips, `.take-${i}.wav`);
      const recorder = spawn("pw-record", ["--rate", String(RATE), "--channels", "1", "--format", "s16", take], { stdio: "ignore" });
      await ask.question("Recording. Enter to stop.");
      recorder.kill("SIGINT");
      await new Promise((done) => recorder.on("exit", done));
      pcm = execFileSync("ffmpeg", ["-v", "error", "-i", take, "-f", "s16le", "-ac", "1", "-ar", String(RATE), "-"], { maxBuffer: 1 << 28 });
      rmSync(take);
      // A take too loud for the microphone (clipped) or too quiet to hear is no test of an engine.
      const problem = level(pcm);
      if (!problem) break;
      const again = await ask.question(`${problem} Enter to record this paragraph again, or k and Enter to keep it.`);
      if (again.trim() === "k") break;
    }
    said.push({ start: at / RATE, end: (at + pcm.length / 2) / RATE, text });
    parts.push(pcm, pause);
    at += pcm.length / 2 + pause.length / 2;
  }
  const out = join(clips, `owner-${name}`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "s16le", "-ar", String(RATE), "-ac", "1", "-i", "-", `${out}.wav`], { input: Buffer.concat(parts) });
  writeFileSync(`${out}.json`, JSON.stringify({ source: `the owner reading the sample ${name}`, rate: RATE, seconds: at / RATE, utterances: said }, null, 2));
  console.log(`\n${out}.wav: ${said.length} paragraphs, ${(at / RATE).toFixed(1)} s`);
}
ask.close();
