//! One engine on one passage, as if spoken live: the passage is fed in 100 ms pieces on a simulated
//! clock, each piece no sooner than it would have been spoken and no sooner than the engine is done
//! with the last one. So what's measured is what the writer would see, without waiting in real time.
//!
//!   cargo run --release --features whisper,vosk --bin bench -- ENGINE CLIP [THREADS]
//!
//! CLIP is a passage in ../clips without its extension (librispeech-test-clean). One JSON line is
//! printed, and appended to ../results/runs.jsonl.

use hear::{home, open, Event, RATE};
use serde::Deserialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::time::Instant;

#[derive(Deserialize)]
struct Passage {
    source: String,
    utterances: Vec<Utterance>,
}

#[derive(Deserialize)]
struct Utterance {
    start: f64,
    end: f64,
    text: String,
}

const PIECE: usize = RATE / 10;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // `--events FILE CLIP NAME`: score what another recognizer heard (Android's, written by the
    // scratch app in ../recognizer), by the same rules.
    let recorded = args.first().is_some_and(|a| a == "--events");
    let args = if recorded { &args[1..] } else { &args[..] };
    let (name, clip) = if recorded { (args.get(2).expect("NAME"), args.get(1).expect("CLIP")) } else { (args.first().expect("ENGINE"), args.get(1).expect("CLIP")) };
    let threads: i32 = if recorded { 0 } else { args.get(2).map(|t| t.parse().unwrap()).unwrap_or(2) };
    let clips = home().join("clips");
    let passage: Passage = serde_json::from_str(&fs::read_to_string(clips.join(format!("{clip}.json"))).unwrap()).unwrap();
    let samples: Vec<f32> = hound::WavReader::open(clips.join(format!("{clip}.wav"))).unwrap().samples::<i16>().map(|s| s.unwrap() as f32 / 32768.0).collect();
    let seconds = samples.len() as f64 / RATE as f64;

    let mut events: Vec<(f64, Event)> = Vec::new();
    let (mut clock, mut busy, mut cpu, mut load_s, mut files, mut streaming) = (0.0f64, f64::NAN, f64::NAN, f64::NAN, Vec::new(), true);
    if recorded {
        for line in fs::read_to_string(&args[0]).unwrap().lines() {
            let e: serde_json::Value = serde_json::from_str(line).unwrap();
            let (t, text) = (e["t"].as_f64().unwrap(), e["text"].as_str().unwrap_or("").to_string());
            clock = clock.max(t);
            match e["kind"].as_str() {
                Some("heard") => events.push((t, Event::Heard(text))),
                Some("settled") if !text.is_empty() => events.push((t, Event::Settled(text))),
                Some("error") => eprintln!("{text} at {t:.1} s"),
                _ => {}
            }
        }
    } else {
        let loading = Instant::now();
        let mut engine = open(name, threads);
        load_s = loading.elapsed().as_secs_f64();
        (files, streaming) = (engine.files.clone(), engine.streaming);

        // The simulated clock, in seconds of the passage.
        busy = 0.0;
        let cpu_listening = cpu_seconds();
        let mut out = Vec::new();
        for (i, piece) in samples.chunks(PIECE).enumerate() {
            let spoken = ((i + 1) * PIECE).min(samples.len()) as f64 / RATE as f64;
            let start = clock.max(spoken);
            let t = Instant::now();
            engine.listener.feed(piece, &mut out);
            let took = t.elapsed().as_secs_f64();
            busy += took;
            clock = start + took;
            events.extend(out.drain(..).map(|e| (clock, e)));
        }
        let t = Instant::now();
        engine.listener.finish(&mut out);
        busy += t.elapsed().as_secs_f64();
        clock += t.elapsed().as_secs_f64();
        events.extend(out.drain(..).map(|e| (clock, e)));
        cpu = cpu_seconds() - cpu_listening;
    }

    // Where each utterance's voice starts and stops, by its loudness, not counting its own silence.
    let voiced: Vec<(f64, f64)> = passage.utterances.iter().map(|u| voice(&samples, u.start, u.end)).collect();

    // From the voice starting to the first words heard of it; from it stopping to the phrase settled.
    let mut first_heard = Vec::new();
    let mut settle = Vec::new();
    let mut unsettled = 0;
    for (i, &(on, off)) in voiced.iter().enumerate() {
        let next_on = voiced.get(i + 1).map(|v| v.0).unwrap_or(f64::INFINITY);
        if let Some((t, _)) = events.iter().find(|(t, e)| *t > on && matches!(e, Event::Heard(text) if !text.is_empty()) || *t > on && matches!(e, Event::Settled(_))) {
            first_heard.push(t - on);
        }
        // Settled once the voice stops, before the next phrase is half heard.
        match events.iter().find(|(t, e)| *t >= off && matches!(e, Event::Settled(_))) {
            Some((t, _)) if *t < next_on + 1.0 => settle.push(t - off),
            _ => unsettled += 1,
        }
    }

    let settled: Vec<&str> = events.iter().filter_map(|(_, e)| if let Event::Settled(t) = e { Some(t.as_str()) } else { None }).collect();
    let hypothesis = settled.join(" ");
    let reference = passage.utterances.iter().map(|u| u.text.as_str()).collect::<Vec<_>>().join(" ");
    let (errors, words) = word_errors(&normalise(&reference), &normalise(&hypothesis));
    // Where what was said is written as prose (the owner's clips), the same with capitals and
    // punctuation counted: a missing full stop or a lower-case name is an error too.
    let prose_wer = reference.contains(['.', ',']).then(|| {
        let (e, n) = word_errors(&prose(&reference), &prose(&hypothesis));
        round(e as f64 / n as f64 * 100.0, 2)
    });
    // The book's names (the owner's clips), each said and each written as the book spells it.
    let names = ["Ada", "Ben", "Varn", "Mira", "Tomas"]
        .iter()
        .filter(|n| reference.contains(*n))
        .map(|n| (n.to_string(), serde_json::json!({ "said": reference.matches(*n).count(), "written": hypothesis.matches(*n).count() })))
        .collect::<serde_json::Map<_, _>>();
    // Written as prose: phrases that begin with a capital and end with punctuation.
    let prose = settled.iter().filter(|t| t.chars().next().is_some_and(char::is_uppercase) && t.trim_end().ends_with(['.', '?', '!', ','])).count();
    let model_mb = files.iter().map(|f| fs::metadata(f).map(|m| m.len()).unwrap_or(0)).sum::<u64>() as f64 / 1e6;

    let result = serde_json::json!({
        "engine": name,
        "clip": clip,
        "source": passage.source,
        "threads": threads,
        "streaming": streaming,
        "seconds": round(seconds, 1),
        // Beam search (HEAR_HOTWORDS set, even empty), and the names it's biased towards.
        "hotwords": std::env::var("HEAR_HOTWORDS").ok(),
        "device": std::env::var("HEAR_DEVICE").unwrap_or_else(|_| "this computer".into()),
        "wer": round(errors as f64 / words as f64 * 100.0, 2),
        "prose_wer": prose_wer,
        "names": names,
        "words": words,
        "load_s": round(load_s, 2),
        "rtf": round(busy / seconds, 3),
        "cores": round(cpu / seconds, 2),
        "peak_mb": if recorded { f64::NAN } else { peak_mb() },
        "model_mb": round(model_mb, 1),
        "first_heard_ms": percentiles(&first_heard),
        "settle_ms": percentiles(&settle),
        "unsettled": unsettled,
        "phrases": settled.len(),
        "prose_phrases": prose,
        "lag_at_end_s": round(clock - seconds, 2),
        "hypothesis": hypothesis,
    });
    println!("{result}");
    let results = home().join("results");
    fs::create_dir_all(&results).unwrap();
    let mut log = OpenOptions::new().create(true).append(true).open(results.join("runs.jsonl")).unwrap();
    writeln!(log, "{result}").unwrap();
}

/// The first and last 20 ms frames between `start` and `end` at least a tenth as loud as the loudest.
fn voice(samples: &[f32], start: f64, end: f64) -> (f64, f64) {
    let frame = RATE / 50;
    let (a, b) = ((start * RATE as f64) as usize, ((end * RATE as f64) as usize).min(samples.len()));
    let rms: Vec<f32> = samples[a..b].chunks(frame).map(|f| (f.iter().map(|s| s * s).sum::<f32>() / f.len() as f32).sqrt()).collect();
    let peak = rms.iter().cloned().fold(0.0, f32::max);
    let first = rms.iter().position(|r| *r >= peak / 10.0).unwrap_or(0);
    let last = rms.iter().rposition(|r| *r >= peak / 10.0).unwrap_or(rms.len());
    (start + (first * frame) as f64 / RATE as f64, start + ((last + 1) * frame) as f64 / RATE as f64)
}

fn normalise(text: &str) -> Vec<String> {
    text.to_lowercase()
        .replace(['’', '‘'], "'")
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '\'' { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .map(|w| w.trim_matches('\'').to_string())
        .filter(|w| !w.is_empty())
        .collect()
}

/// Words with their capitals, and punctuation as words of its own.
fn prose(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for word in text.replace(['’', '‘'], "'").replace(['“', '”'], "\"").split_whitespace() {
        let core = word.trim_matches(|c: char| !c.is_alphanumeric() && c != '\'');
        let (before, after) = word.split_once(core).unwrap_or(("", word));
        out.extend(before.chars().filter(|c| ".,;:!?".contains(*c)).map(String::from));
        if !core.is_empty() {
            out.push(core.to_string());
        }
        out.extend(after.chars().filter(|c| ".,;:!?".contains(*c)).map(String::from));
    }
    out
}

/// Word-level edit distance, and the reference's length.
fn word_errors(reference: &[String], hypothesis: &[String]) -> (usize, usize) {
    let mut row: Vec<usize> = (0..=hypothesis.len()).collect();
    for (i, r) in reference.iter().enumerate() {
        let mut prev = row[0];
        row[0] = i + 1;
        for (j, h) in hypothesis.iter().enumerate() {
            let cur = row[j + 1];
            row[j + 1] = if r == h { prev } else { 1 + prev.min(row[j]).min(row[j + 1]) };
            prev = cur;
        }
    }
    (row[hypothesis.len()], reference.len())
}

fn percentiles(values: &[f64]) -> serde_json::Value {
    if values.is_empty() {
        return serde_json::Value::Null;
    }
    let mut v = values.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let at = |p: f64| (v[((v.len() - 1) as f64 * p).round() as usize] * 1000.0).round();
    serde_json::json!({ "p50": at(0.5), "p90": at(0.9), "max": at(1.0) })
}

fn round(x: f64, places: i32) -> f64 {
    let f = 10f64.powi(places);
    (x * f).round() / f
}

fn cpu_seconds() -> f64 {
    let mut usage: libc::rusage = unsafe { std::mem::zeroed() };
    unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut usage) };
    let t = |tv: libc::timeval| tv.tv_sec as f64 + tv.tv_usec as f64 / 1e6;
    t(usage.ru_utime) + t(usage.ru_stime)
}

/// The process's peak resident memory, in MB.
fn peak_mb() -> f64 {
    let status = fs::read_to_string("/proc/self/status").unwrap_or_default();
    status.lines().find_map(|l| l.strip_prefix("VmHWM:")).and_then(|v| v.trim().trim_end_matches(" kB").parse::<f64>().ok()).map(|kb| (kb / 1000.0).round()).unwrap_or(0.0)
}
