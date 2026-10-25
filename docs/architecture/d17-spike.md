# D17 spike: which speech engine Writer hears with

Task #78, for decision D17 (#77) and requirements #71 (dictation), #72 (Linux) and #73 (Android). The question: which engine and model hear a writer best on the owner's machines, quickly, privately and cheaply enough to leave running while they write?

In short: **Parakeet TDT 110M settling each phrase, with the streaming Zipformer showing the words as they're heard, both through sherpa-onnx, on the desktop and on Android alike.**
- **Speed:** words show 0.7 s after the voice starts, and a phrase settles about 1 s after it stops. On the owner's Pixel 10 Pro it settles sooner still.
- **Accuracy:** on the owner reading the sample novel and a journal entry, 5.2% and 6.0% of words are wrong, and 9.6% and 14.3% once capitals and punctuation count. On LibriSpeech, 3.4% and 5.5% (with beam search).
- **Cost:** an eighth of one core here, a tenth on the phone, about 600 MB of memory, and 208 MB of models downloaded once.
- **The rest:**
  - Android's own on-device recognizer is less accurate, and it gives no end of a phrase.
  - Moonshine writes prose nearly as well, but errs more on harder speech.
  - whisper.cpp can't keep up, and Vosk is too inaccurate.

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

So hotwords do bias Parakeet, but they over-insert soon after they help. On the owner's clips they didn't help at all (*Results on the owner's own clips*). The spike splits a hotword into the model's word pieces by longest match, not the model's own tokenizer, so a fairer test would use the tokenizer; that's for #81 to try.

### whisper.cpp and Vosk

Each crashed when linked beside sherpa-onnx's static libraries, which carry their own copies of what those engines bundle. With sherpa-onnx's shared libraries they run. Writer would link only one engine, so this is a note for whoever adds a second, not a problem for the first.

## Results on the phone

The bench built for Android (arm64, 16 KB pages) and run over adb on the owner's Pixel 10 Pro (`phone.sh`), with the same models and passages, greedy decoding:

| Engine | Threads | Wrong words, clean / other | Words show (p50 / p90) | Phrase settles (p50 / p90) | Missed | Prose | CPU (cores) | Memory | Models |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **parakeet-110m+zipformer** | 1 | **4.0% / 6.4%** | 0.7 / 1.0 s | **0.9 / 1.1 s** | 0 | 50/73 | 0.09 | 592 MB | 208 MB |
| moonshine-base+zipformer | 1 | 6.9% / 13.9% | 0.7 / 1.0 s | 1.0 / 1.4 s | 0 | 72/74 | 0.10 | 506 MB | 213 MB |
| parakeet-110m | 1 | 4.0% / 6.4% | 1.4 / 1.4 s | 0.9 / 1.4 s | 0 | 50/73 | 0.09 | 496 MB | 137 MB |
| moonshine-base | 1 | 6.9% / 13.9% | 1.4 / 1.5 s | 0.9 / 1.8 s | 0 | 72/74 | 0.15 | 397 MB | 142 MB |
| moonshine-tiny | 1 | 6.9% / 17.5% | 1.4 / 1.4 s | 0.9 / 1.4 s | 0 | 70/74 | 0.09 | 241 MB | 45 MB |
| zipformer+punct | 1 | 1.9% / 10.8% | 0.7 / 1.0 s | 1.7 / 1.9 s | 0 | 17/67 | 0.06 | 214 MB | 79 MB |
| kroko+punct | 1 | 4.6% / 11.5% | 1.0 / 1.7 s | 1.9 / 2.4 s | 3 | 21/49 | 0.03 | 234 MB | 79 MB |
| parakeet-110m+zipformer | 2 | 4.0% / 6.4% | 0.7 / 1.0 s | 1.0 / 1.2 s | 0 | 50/73 | 0.18 | 593 MB | 208 MB |

All 28 runs are in `results/phone.jsonl`.

- **The phone keeps up with every engine on one thread**, and settles sooner than this computer: its cores are newer.
- **The order is the same as on the computer**, and so are the words written, so one model serves both.
- **Two threads don't help.** They settle no sooner, and they cost twice the CPU.
- **Memory is the price**: about 600 MB while dictating, for the two models. The Pixel has room for it. A phone with 4 GB might not; Moonshine tiny (45 MB, 240 MB in memory) is the small choice there, at the accuracy cost above.

## Results on the owner's own clips

The owner read the sample novel's first two scenes (113 s, nine paragraphs) and a journal entry in the sample journal's voice (60 s, five paragraphs) with `record.ts`. Their own punctuation is the reference, so a second error rate counts capitals and punctuation too ("with prose"). One thread on this computer, except where it says the phone:

| Engine | Wrong words, novel / journal | With prose, novel / journal | Words show (p50) | Phrase settles (p50 / p90) | Missed | Names written as the book has them |
|---|---:|---:|---:|---:|---:|---|
| **parakeet-110m+zipformer** | **5.2% / 6.0%** | **9.6% / 14.3%** | 0.7 s | 0.9 / 1.0 s | 1 | Ada, Ben, Varn ×2, Mira; not Tomas |
| parakeet-110m+zipformer, on the phone | 5.6% / 6.8% | 10.4% / 15.0% | 0.7 s | 0.8 / 0.9 s | 0 | the same |
| moonshine-base+zipformer | 6.9% / 6.8% | 12.3% / 13.5% | 0.7 s | 0.9 / 1.0 s | 0 | Ada, Ben, Mira |
| moonshine-tiny | 10.4% / 10.3% | 15.0% / 15.8% | 1.4 s | 0.8 / 0.9 s | 0 | Ben, Varn, Mira |
| kroko+punct | 2.2% / 7.7% | 13.5% / 24.1% | 0.9 s | 2.3 / 2.6 s | 0 | Ada, Ben, Mira |
| zipformer+punct | 6.1% / 12.0% | 18.1% / 24.8% | 0.7 s | 1.7 / 1.8 s | 0 | Ben, Mira |
| whisper-small+zipformer | 3.0% / 5.1% | 7.3% / 11.3% | 5.7 s | 5.7 / 10.4 s | 9 | Ada, Ben, Varn ×2, Mira |
| vosk-small | 16.4% / 22.2% | 33.1% / 41.4% | 0.5 s | 1.2 / 1.5 s | 0 | none |
| Android's on-device recognizer, on the phone | 9.5% / 9.4% | 23.5% / 24.1% | 0.7 s | 1.9 / 5.2 s | – | Ada, Ben, Mira |

- **Parakeet writes the owner's prose best** of the engines that keep up, and spells the novel's names as the book does.
- **whisper.cpp small writes it better still, but can't keep up.** Phrases settle 6 to 10 s late, and it misses some.
- **Kroko gets the fewest words wrong on the novel**, but it settles at 2.3 s, and its punctuation model is weaker.
- **Every engine, and Android's recognizer, writes "Thomas" for Tomas.** That's how the name sounds, so it isn't a mishearing: no hotword will change it. Putting the writer's names right afterwards does, with the book's index as the list (#81), as long as it matches by how names sound, not only how they're spelled.
- **Hotwords made no difference here.** Scores 1 to 2 changed nothing; 3 cost both "Varn"s, as over-biasing did on LibriSpeech. Since the names were mostly right without them, the crate starts without hotwords. It keeps beam search, which is better without them too, and leaves the names to #81.

## Android's own recognizer

`recognizer/` fed each clip, at speaking pace, to Android's on-device recognizer (`createOnDeviceSpeechRecognizer`, with Android 13's audio from a file), and logged what it showed with the times.

- **It never ends a phrase.** Given audio this way, a session never ends at a pause, and it never returns a final result: the session's result is empty.
- **A segmented session doesn't help.** It returned no segments either, and stopped reading after 22 s without a word to say so. That crashed the first version of the scratch app.
- **So phrases settle late.** The recognizer shows the words as it hears them, then starts over, so the phrase before only counts as settled when the next phrase begins: 1.9 s at p50, and up to 6 s after a long pause.
- **It stalled.** On LibriSpeech it stopped responding partway through one passage, and the app was sent to the background partway through the other. It was scored on what it was given before that: 88 s and 46 s, about 32% wrong. That figure is harsh, since "starting over" only approximates what it settled.
- **It writes no prose.** No phrase came back capitalised and punctuated as a sentence.
- **It's less accurate on the owner's clips**: 9.5% to Parakeet's 5.6% on the same phone.

So D17's point 4 goes the other way: on Android, Writer's own crate, not Android's recognizer. The crate keeps up on the phone with room to spare, and the system keyboard's own voice typing stays available as an input method (#85).

## The cost to the apps

- **Desktop**: sherpa-onnx and onnxruntime linked in statically add 30 MB to the shell's binary, about 8 MB compressed. The Arch package would go from 59.5 MB to about 68 MB, within its 100 MB budget. The model isn't in the package: it's downloaded on first use (D17).
- **Ubuntu 22.04**: `ubuntu-22.04.sh` builds the bench in an Ubuntu 22.04 container (glibc 2.35, where the desktop's .deb is built), with sherpa-onnx's prebuilt static libraries, and runs the leading engine there: the same 4.2% of words wrong on test-clean, settling at 1.0 s.
- **Android**: sherpa-onnx's prebuilt arm64 libraries are already aligned for 16 KB pages (Android 15 and later). They're `libonnxruntime.so` (22.2 MB) and `libsherpa-onnx-c-api.so` (4.3 MB), 9.7 MB compressed. The APK would go from 29.5 MB to about 39 MB, with the model downloaded on first use.
- **Licences**:
  - sherpa-onnx: Apache-2.0. onnxruntime: MIT. Silero: MIT.
  - Zipformer: Apache-2.0. The punctuation model: Apache-2.0. Moonshine's English models: MIT.
  - Parakeet 110M and FastConformer: CC-BY-4.0, free to ship with credit in About.
  - Kroko's community models: CC-BY-SA. Nemotron: NVIDIA's own licence.
  - #72 asked for Apache-2.0 or MIT; the owner accepted CC-BY-4.0 for Parakeet, with the model credited in About Writer (2026-10-25), and #72 now says so.

## What D17 is amended with

- **The engine** is sherpa-onnx, as D17 says, on the desktop and on Android.
- **Its models**, in the speech crate (#82), downloaded on first use (208 MB):
  - Parakeet TDT 110M (int8, beam search) settles each phrase, cut at pauses of 0.5 s by Silero's voice detection;
  - the streaming Zipformer (2023-06-26, int8) shows the words as they're heard.
- **The book's names** are put right after a phrase settles (#81), not given as hotwords.
- **The fallback** is Moonshine base (MIT) in Parakeet's place. Moonshine tiny (45 MB) is the choice for a phone short of memory.
- **On Android**, the same crate, built for arm64 with 16 KB pages. Not Android's on-device recognizer, which gives no end of a phrase and is less accurate. The system keyboard's voice typing keeps working beside it.
