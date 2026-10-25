# D17 spike: which speech engine Writer hears with

Task #78, for decision D17 (#77) and requirements #71 (dictation), #72 (Linux) and #73 (Android). The question: which engine and model hear a writer best on the owner's machines, quickly, privately and cheaply enough to leave running while they write?

In short, on this computer: **Parakeet TDT 110M settling each phrase, with the streaming Zipformer showing the words as they're heard, both through sherpa-onnx.** Words show 0.7 s after the voice starts. A phrase settles 1.1 s after the voice stops (1.5 s at p90). It gets 3.4% of words wrong on clean read speech and 5.5% on harder speech, the best of everything tried that keeps up. It uses an eighth of one core, about 600 MB of memory, and 208 MB of models downloaded once. Moonshine base in Parakeet's place writes better prose, but it gets more than twice as many words wrong on harder speech. whisper.cpp can't keep up on this machine, and Vosk is too inaccurate.

The owner's own clips and the phone are still to come (*Still to do*, below).

## What was built

All of it is under `spike/d17/`, outside the app. No production code changed.

| File | What it is |
|---|---|
| `hear/src/lib.rs` | Every engine behind one listener, as Writer's speech crate (#82) would have it: 16 kHz samples in; the phrase being heard and each settled phrase out, the page's two events (DEVELOPER.md, *Dictation*). |
| `hear/src/bin/bench.rs` | One engine on one passage as if spoken live, scored. `--events` scores a log of another recognizer's events by the same rules. |
| `hear/src/bin/live.rs` | An engine on the microphone, to hear it for yourself. |
| `fetch-models.sh`, `fetch-clips.ts` | The models (2 GB) and the LibriSpeech passages, into `models/` and `clips/` (not committed). |
| `record.ts` | The owner's clips: the sample novel's first two scenes and a journal entry, read a paragraph at a time. |
| `run-all.sh`, `table.py` | Every engine on every passage; the tables below from `results/runs.jsonl`. |
| `phone.sh` | The bench on the attached phone over adb (no app), then Android's own recognizer on the same clips through `recognizer/`, a scratch app. |
| `ubuntu-22.04.sh` | The build and a run on Ubuntu 22.04, where the desktop's .deb is built. |

To run them: `./fetch-models.sh`, `node fetch-clips.ts`, `cargo build --release` in `hear` (plus `--features whisper` or `--features vosk` with `--no-default-features --features sherpa-shared`, in target folders of their own: see *whisper.cpp and Vosk*), then `./run-all.sh` and `python3 table.py`. To listen: `cargo run --release --features mic --bin live -- parakeet-110m+zipformer`.

## How it was measured

**What was said.** Two passages of LibriSpeech, read audiobook speech: test-clean (224 s) and test-other (218 s, harder speakers and recordings). Each is three utterances from each of eight speakers, joined with a 1.2 s pause between them, as a writer pausing to think. The Zipformer was trained on LibriSpeech's training half, so its test-clean figure flatters it. The others were trained on wider data that includes LibriSpeech.

**As if live.** Each passage is fed in 100 ms pieces on a simulated clock: a piece is taken no sooner than it would have been spoken, and no sooner than the engine is done with the last one. An engine slower than speech falls behind as it would live. The times are what the writer would see, without waiting through each passage.

- *Words show*: from an utterance's voice starting (by loudness, not counting its own silence) to the first words heard of it.
- *Phrase settles*: from the voice stopping to the phrase settled. *Missed* counts utterances not settled before the next one was well under way.
- *Wrong words*: word error rate over the whole passage, settled text only, lower-cased and without punctuation.
- *Prose*: settled phrases that begin with a capital and end with punctuation.
- *CPU*: process time over the passage's length, so 0.13 is an eighth of one core while listening. On two threads, onnxruntime's threads wait busily and the figure overstates the work, so the one-thread figures are the ones to read.
- *Memory*: the process's peak. *Models*: the files read, on disk.

**Two shapes of engine.**

- *Streaming*: the model hears as the samples come, and says when a phrase has ended, after 0.8 s of silence.
- *Phrase at a time*: Silero's voice detection cuts the speech at pauses of 0.5 s. Each phrase is decoded when it ends, and the phrase so far is decoded again every second for what's heard meanwhile.
- *Hybrid* (`X+zipformer`): the streaming Zipformer gives what's heard, and X settles each phrase, phrase at a time without the redecoding. The Zipformer starts afresh with each settled phrase.

This machine is an Intel i7-6820HQ (2015, 4 cores, 8 threads, no GPU), a fair worst case for a writer's laptop.

## Results on this computer

| Engine | Threads | Wrong words, clean / other | Words show (p50 / p90) | Phrase settles (p50 / p90) | Missed | Prose | CPU (cores) | Memory | Models |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **parakeet-110m+zipformer (beam)** | 1 | **3.4% / 5.5%** | 0.7 / 1.0 s | 1.1 / 1.5 s | 0 | 48/72 | 0.13 | 605 MB | 208 MB |
| parakeet-110m+zipformer | 1 | 4.2% / 6.4% | 0.7 / 1.0 s | 1.1 / 1.5 s | 0 | 49/73 | 0.13 | 599 MB | 208 MB |
| moonshine-base+zipformer | 1 | 6.3% / 13.9% | 0.7 / 1.0 s | 1.1 / 1.6 s | 0 | 72/74 | 0.13 | 477 MB | 213 MB |
| parakeet-110m | 1 | 4.2% / 6.4% | 1.4 / 1.5 s | 1.1 / 2.1 s | 0 | 49/73 | 0.21 | 512 MB | 137 MB |
| moonshine-base | 1 | 6.3% / 13.9% | 1.4 / 1.5 s | 1.1 / 2.4 s | 0 | 72/74 | 0.25 | 364 MB | 142 MB |
| moonshine-tiny | 1 | 6.7% / 17.5% | 1.4 / 1.4 s | 0.9 / 1.7 s | 0 | 71/74 | 0.13 | 215 MB | 45 MB |
| zipformer+punct | 1 | 1.7% / 10.8% | 0.7 / 1.0 s | 1.7 / 1.9 s | 0 | 17/67 | 0.08 | 182 MB | 79 MB |
| kroko+punct | 1 | 4.2% / 11.9% | 0.8 / 1.7 s | 1.9 / 2.5 s | 4 | 21/49 | 0.05 | 200 MB | 79 MB |
| fastconformer+punct | 2 | 6.1% / 10.4% | 0.9 / 1.1 s | 1.7 / 1.9 s | 1 | 17/67 | 0.32 | 273 MB | 144 MB |
| nemotron | 2 | 7.3% / 10.6% | 1.1 / 1.2 s | 1.4 / 1.7 s | 0 | 0/90 | 0.87 | 1022 MB | 662 MB |
| vosk-small | 2 | 10.1% / 26.6% | 0.6 / 0.9 s | 1.2 / 1.3 s | 0 | 0/73 | 0.07 | 337 MB | 71 MB |
| whisper-small+zipformer | 2 | 4.2% / 8.8% | 5.6 / 10.2 s | 2.0 / 8.7 s | 34 | 54/73 | 3.80 | 954 MB | 559 MB |
| whisper-base+zipformer | 2 | 6.9% / 14.8% | 1.8 / 2.3 s | 2.6 / 3.1 s | 37 | 54/74 | 1.17 | 504 MB | 220 MB |
| whisper-base | 2 | 6.5% / – | 1.5 / 3.8 s | 2.6 / 2.7 s | 20 | 27/39 | 5.18 | 388 MB | 149 MB |

Every run is in `results/runs.jsonl`, with what each engine wrote.

The models:
- *Zipformer*: sherpa-onnx's streaming Zipformer, English, 2023-06-26, int8.
- *Kroko*: Banafo's Kroko community Zipformer, 2025-08-06.
- *FastConformer*: NeMo's streaming FastConformer transducer, 480 ms.
- *Nemotron*: NVIDIA's Nemotron Speech Streaming 0.6B, 560 ms, int8.
- *Moonshine*: Moonshine base and tiny, English, quantized, 2026-02-27.
- *Parakeet 110M*: NeMo's Parakeet TDT transducer, 110M, int8.
- *whisper.cpp*: base.en and small.en.
- *Vosk*: vosk-model-small-en-us 0.15.
- *+punct*: sherpa-onnx's online punctuation and casing model, English.

### What the numbers say

- **Parakeet 110M is the most accurate of the engines that keep up**, by some way on the harder passage. Beam search, which the hints need anyway, takes its errors down by a fifth at no cost in CPU. It writes capitals and punctuation itself. Where it falls short of prose, it's mostly a lower-case start after a pause it took for a sentence's middle.
- **Phrase at a time beats streaming for the settled text, and streaming beats it for what's heard.** A streaming model's phrase ends after 0.8 s of its own silence, plus its chunk. Silero's ends after 0.5 s, and decoding a whole phrase at once takes 0.1–0.6 s here. On its own, a phrase-at-a-time engine shows nothing for its first second. The hybrid has both: the Zipformer's words at 0.7 s, Parakeet's phrase at 1.1 s. And it's cheaper, since the phrase isn't decoded again every second.
- **Moonshine writes the best prose** (72 of 74 phrases), but it errs on harder speech: 13.9% to Parakeet's 5.5%. Moonshine tiny is the smallest download, at 45 MB.
- **The Zipformer that D17 named** hears quickly and cheaply. But it writes in capitals without punctuation, so it needs a punctuation model, which punctuates a phrase without its context (17 of 67 phrases came out as prose). It settles late, at 1.7 s, and it's the weakest on the harder passage. It's kept for what's heard, where none of that matters.
- **Nemotron** punctuates, but streaming cuts each phrase before its last full stop, and it drops words where its chunks meet ("Not stopped" for "but not stopped"). It costs most of a core and a gigabyte of memory.
- **whisper.cpp can't keep up on this CPU.** It works on 30-second windows whatever the length of the phrase, so even settling only, small falls seconds behind and misses phrases, and base is the least accurate of the rest. With a GPU it might do; Writer can't count on one.
- **Vosk** is the lightest, but gets a quarter of the words wrong on the harder passage, and writes no punctuation.

### Hints: the book's names

Parakeet can be biased towards given words, the book's names, through beam search with hotwords. On the LibriSpeech passage, words it had misheard were given as hotwords ("harangue", "angor", "mummeries"):
- at score 2, nothing changed;
- at score 5, "angor" was written where it was said, and also where it wasn't;
- at score 10, the passage turned to hotwords.

So hints work, and their strength needs tuning, on the owner's clips with the book's names in them. The spike splits a hotword into the model's word pieces by longest match, not the model's own tokenizer; the crate should use the tokenizer.

### whisper.cpp and Vosk

Each crashed when linked beside sherpa-onnx's static libraries, which carry their own copies of what those engines bundle. With sherpa-onnx's shared libraries they run. Writer would link only one engine, so this is a note for whoever adds a second, not a problem for the first.

## The cost to the apps

- **Desktop**: sherpa-onnx and onnxruntime linked in statically add 30 MB to the shell's binary, about 8 MB compressed. The Arch package would go from 59.5 MB to about 68 MB, within its 100 MB budget. The model isn't in the package: it's downloaded on first use (D17).
- **Ubuntu 22.04**: `ubuntu-22.04.sh` builds the bench in an Ubuntu 22.04 container (glibc 2.35, where the desktop's .deb is built), with sherpa-onnx's prebuilt static libraries, and runs the leading engine there: the same 4.2% of words wrong on test-clean, settling at 1.0 s.
- **Android**: sherpa-onnx's prebuilt arm64 libraries are already aligned for 16 KB pages (Android 15 and later). They're `libonnxruntime.so` (22.2 MB) and `libsherpa-onnx-c-api.so` (4.3 MB), 9.7 MB compressed. The APK would go from 29.5 MB to about 39 MB, with the model downloaded on first use.
- **Licences**:
  - sherpa-onnx: Apache-2.0. onnxruntime: MIT. Silero: MIT.
  - Zipformer: Apache-2.0. The punctuation model: Apache-2.0. Moonshine's English models: MIT.
  - Parakeet 110M and FastConformer: CC-BY-4.0, free to ship with credit in About.
  - Kroko's community models: CC-BY-SA. Nemotron: NVIDIA's own licence.
  - #72 asks for Apache-2.0 or MIT, so Parakeet needs the owner's word.

## Still to do

- **The owner's clips.** Run `node record.ts`, which takes about ten minutes: the sample novel's first two scenes and a journal entry, read a paragraph at a time. Then `./run-all.sh` again. The bench scores them with capitals and punctuation counted, and counts the book's names written as the book spells them. Those clips decide the hotword score.
- **The phone.** With the Pixel attached, `./phone.sh`. It runs the leading engines on the phone over adb, on one and two threads. Then it runs Android's own on-device recognizer on the same clips at speaking pace, through the scratch app (`recognizer/`, Android 13's audio-from-file), scored by the same rules. That settles D17's point 4: Android's recognizer, or the crate built for aarch64.

## What D17 would be amended with

The engine is sherpa-onnx, as D17 says. Its model isn't the streaming Zipformer alone:
- Parakeet TDT 110M (int8, beam search, with the book's names as hotwords) settles each phrase, cut at pauses by Silero's voice detection;
- the streaming Zipformer shows the words as they're heard;
- both run in the speech crate.

The download is 208 MB. Moonshine base is the fallback if Parakeet's CC-BY-4.0 licence isn't acceptable. Android's recognizer is pending the phone.
