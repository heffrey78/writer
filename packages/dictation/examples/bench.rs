//! The listener on a passage as if spoken live, as the spike measured (docs/architecture/d17-spike.md):
//! fed in 100 ms pieces on a simulated clock, no piece sooner than it was spoken or than the last
//! is done. Prints the words wrong, when phrases settle after the voice stops, and the CPU.
//!
//!   cargo run --release --example bench -- [PASSAGE.wav] [MODELS]
//!
//! PASSAGE.wav has its utterances in PASSAGE.json beside it (tests/clips/librispeech.wav by default).

use dictation::{Event, Listener, Options, RATE};
use std::path::PathBuf;
use std::time::Instant;

fn main() {
    let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let args: Vec<String> = std::env::args().skip(1).collect();
    let wav = args.first().map(PathBuf::from).unwrap_or_else(|| here.join("tests/clips/librispeech.wav"));
    let models = args.get(1).map(PathBuf::from).unwrap_or_else(|| here.join("models"));
    let samples: Vec<f32> = hound::WavReader::open(&wav).unwrap().samples::<i16>().map(|s| s.unwrap() as f32 / 32768.0).collect();
    let said: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(wav.with_extension("json")).unwrap()).unwrap();
    let utterances: Vec<(f64, String)> = said["utterances"].as_array().unwrap().iter().map(|u| (u["end"].as_f64().unwrap(), u["text"].as_str().unwrap().to_string())).collect();
    let seconds = samples.len() as f64 / RATE as f64;

    let loading = Instant::now();
    let mut listener = Listener::open(&models, &Options::default()).unwrap();
    let load = loading.elapsed().as_secs_f64();
    let cpu_before = cpu_seconds();
    let (mut clock, mut busy) = (0.0f64, 0.0f64);
    let mut settled: Vec<(f64, String)> = Vec::new();
    // BENCH_PIECE_MS=10 to feed it as a microphone does, a few milliseconds at a time.
    let piece = RATE * std::env::var("BENCH_PIECE_MS").ok().and_then(|ms| ms.parse::<usize>().ok()).unwrap_or(100) / 1000;
    for (i, chunk) in samples.chunks(piece).enumerate() {
        let spoken = ((i + 1) * piece).min(samples.len()) as f64 / RATE as f64;
        let t = Instant::now();
        let events = listener.feed(chunk);
        let took = t.elapsed().as_secs_f64();
        busy += took;
        clock = clock.max(spoken) + took;
        settled.extend(events.into_iter().filter_map(|e| if let Event::Settled(t) = e { Some((clock, t)) } else { None }));
    }
    settled.extend(listener.stop().into_iter().filter_map(|e| if let Event::Settled(t) = e { Some((clock, t)) } else { None }));
    let cpu = cpu_seconds() - cpu_before;

    // From each utterance's end (its trailing silence included, so this is generous) to the first
    // phrase settled after it.
    let mut delays: Vec<f64> = utterances.iter().filter_map(|(end, _)| settled.iter().find(|(t, _)| t >= end).map(|(t, _)| t - end)).collect();
    delays.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let at = |p: f64| delays.get(((delays.len().max(1) - 1) as f64 * p).round() as usize).copied().unwrap_or(f64::NAN);
    let reference: String = utterances.iter().map(|u| u.1.as_str()).collect::<Vec<_>>().join(" ");
    let hypothesis: String = settled.iter().map(|s| s.1.as_str()).collect::<Vec<_>>().join(" ");
    println!("{}: {seconds:.0} s, {} utterances", wav.display(), utterances.len());
    println!("words wrong {:.1}%", wer(&reference, &hypothesis) * 100.0);
    println!("phrase settles after its utterance ends: p50 {:.2} s, p90 {:.2} s, max {:.2} s", at(0.5), at(0.9), at(1.0));
    println!("CPU {:.2} cores while listening; decoding {:.3}× real time; model opened in {load:.1} s", cpu / seconds, busy / seconds);
}

fn wer(reference: &str, hypothesis: &str) -> f64 {
    let words = |t: &str| t.to_lowercase().chars().map(|c| if c.is_alphanumeric() || c == '\'' { c } else { ' ' }).collect::<String>().split_whitespace().map(String::from).collect::<Vec<_>>();
    let (r, h) = (words(reference), words(hypothesis));
    let mut row: Vec<usize> = (0..=h.len()).collect();
    for (i, rw) in r.iter().enumerate() {
        let mut prev = row[0];
        row[0] = i + 1;
        for (j, hw) in h.iter().enumerate() {
            let cur = row[j + 1];
            row[j + 1] = if rw == hw { prev } else { 1 + prev.min(row[j]).min(row[j + 1]) };
            prev = cur;
        }
    }
    row[h.len()] as f64 / r.len() as f64
}

/// This process's CPU time so far, from /proc (Linux).
fn cpu_seconds() -> f64 {
    let stat = std::fs::read_to_string("/proc/self/stat").unwrap_or_default();
    let fields: Vec<&str> = stat.rsplit_once(')').map(|(_, rest)| rest.split_whitespace().collect()).unwrap_or_default();
    // utime and stime, in clock ticks (100 a second on Linux).
    let ticks: f64 = fields.get(11..13).map(|f| f.iter().filter_map(|t| t.parse::<f64>().ok()).sum()).unwrap_or(0.0);
    ticks / 100.0
}
