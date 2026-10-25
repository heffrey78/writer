//! The listener on a recorded clip (tests/clips): what's heard and settled, and when.
//!
//! The model comes from fetch-models.sh, in models/ (or DICTATION_MODELS).

use dictation::{Event, Listener, Options, RATE};
use proptest::prelude::*;
use std::path::PathBuf;
use std::sync::OnceLock;

fn models() -> PathBuf {
    let dir = std::env::var_os("DICTATION_MODELS").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models"));
    assert!(dir.join("silero_vad.onnx").exists(), "no speech model in {}: run fetch-models.sh", dir.display());
    dir
}

struct Clip {
    samples: Vec<f32>,
    /// Where each utterance starts and ends, in samples, and what was said.
    utterances: Vec<(usize, usize, String)>,
}

fn clip() -> &'static Clip {
    static CLIP: OnceLock<Clip> = OnceLock::new();
    CLIP.get_or_init(|| {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/clips");
        let samples = hound::WavReader::open(dir.join("librispeech.wav")).unwrap().samples::<i16>().map(|s| s.unwrap() as f32 / 32768.0).collect();
        let said: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("librispeech.json")).unwrap()).unwrap();
        let at = |v: &serde_json::Value| (v.as_f64().unwrap() * RATE as f64) as usize;
        let utterances = said["utterances"].as_array().unwrap().iter().map(|u| (at(&u["start"]), at(&u["end"]), u["text"].as_str().unwrap().to_string())).collect();
        Clip { samples, utterances }
    })
}

/// Feed `samples` in pieces of `piece` samples; every event, with the sample count when it came.
fn hear(listener: &mut Listener, samples: &[f32], piece: usize) -> Vec<(usize, Event)> {
    let mut out = Vec::new();
    let mut at = 0;
    for chunk in samples.chunks(piece) {
        at += chunk.len();
        out.extend(listener.feed(chunk).into_iter().map(|e| (at, e)));
    }
    out
}

fn settled(events: &[(usize, Event)]) -> Vec<String> {
    events.iter().filter_map(|(_, e)| if let Event::Settled(t) = e { Some(t.clone()) } else { None }).collect()
}

fn words(text: &str) -> Vec<String> {
    text.to_lowercase().chars().map(|c| if c.is_alphanumeric() || c == '\'' { c } else { ' ' }).collect::<String>().split_whitespace().map(String::from).collect()
}

fn word_error_rate(reference: &str, hypothesis: &str) -> f64 {
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

#[test]
fn hears_the_clip_and_settles_each_phrase_at_its_pause() {
    let clip = clip();
    let mut listener = Listener::open(&models(), &Options::default()).unwrap();
    let mut events = hear(&mut listener, &clip.samples, RATE / 10);
    events.extend(listener.stop().into_iter().map(|e| (clip.samples.len(), e)));

    // Within the spike's budget: it got 3.4% wrong on LibriSpeech's clean speech; a short clip is noisier.
    let reference = clip.utterances.iter().map(|u| u.2.as_str()).collect::<Vec<_>>().join(" ");
    let wer = word_error_rate(&reference, &settled(&events).join(" "));
    assert!(wer <= 0.10, "{:.1}% of words wrong: {:?}", wer * 100.0, settled(&events));

    // Each utterance is settled at the pause after it, within the spike's 1.5 s, before the next begins.
    for (i, (start, end, _)) in clip.utterances.iter().enumerate() {
        let next = clip.utterances.get(i + 1).map(|u| u.0).unwrap_or(clip.samples.len());
        let at = events.iter().find(|(at, e)| *at > *end && matches!(e, Event::Settled(_))).map(|(at, _)| *at);
        assert!(at.is_some_and(|at| at <= end + RATE * 3 / 2 && at <= next), "utterance {i} not settled by its pause: {at:?}");
        // And something of it was heard while it was spoken.
        assert!(events.iter().any(|(at, e)| *at > *start && *at <= *end && matches!(e, Event::Heard(t) if !t.is_empty())), "nothing of utterance {i} heard while spoken");
    }

    // Written as prose: a capital to start and punctuation to end.
    for phrase in settled(&events) {
        assert!(phrase.chars().next().unwrap().is_uppercase(), "{phrase}");
    }
    // What's heard is cleared once its phrase is settled.
    let last_settled = events.iter().rposition(|(_, e)| matches!(e, Event::Settled(_))).unwrap();
    assert!(events[last_settled..].iter().all(|(_, e)| !matches!(e, Event::Heard(t) if !t.is_empty())));
}

#[test]
fn stopping_mid_phrase_settles_what_was_heard() {
    let clip = clip();
    let (start, end, text) = &clip.utterances[0];
    let mut listener = Listener::open(&models(), &Options::default()).unwrap();
    // Two thirds of the first utterance, and stop while it's still being spoken.
    let cut = start + (end - start) * 2 / 3;
    let heard = hear(&mut listener, &clip.samples[..cut], RATE / 10);
    assert!(settled(&heard).is_empty(), "settled before any pause: {:?}", settled(&heard));
    let stopped = listener.stop();
    let phrase = settled(&stopped.iter().cloned().map(|e| (0, e)).collect::<Vec<_>>()).join(" ");
    let said = words(text);
    let got = words(&phrase);
    assert!(got.len() >= said.len() / 2 && said.starts_with(&got[..2]), "stopped with {phrase:?} of {text:?}");
    assert_eq!(stopped.last(), Some(&Event::Heard(String::new())), "what's heard is cleared");

    // Ready for the next dictation: the rest of the clip is heard afresh.
    let after = hear(&mut listener, &clip.samples[clip.utterances[1].0 - RATE / 2..], RATE / 10);
    assert!(settled(&after).iter().any(|p| words(p).first().map(String::as_str) == Some("somehow")), "{:?}", settled(&after));
}

#[test]
fn only_english_for_now() {
    let error = Listener::open(&models(), &Options { language: "sv".into(), ..Options::default() }).err().unwrap();
    assert_eq!(error.to_string(), "dictation doesn't hear sv yet: English only, for now");
}

#[test]
fn nothing_is_written_to_disk() {
    let dir = models();
    let cwd = std::env::current_dir().unwrap();
    let (models_before, cwd_before) = (listing(&walk(&dir)), listing(&walk(&cwd)));
    let audio_before = audio_in(&std::env::temp_dir());
    let mut listener = Listener::open(&dir, &Options::default()).unwrap();
    hear(&mut listener, &clip().samples, RATE / 10);
    listener.stop();
    assert_eq!(listing(&walk(&dir)), models_before);
    assert_eq!(listing(&walk(&cwd)), cwd_before);
    // Other programs use the temp folder too: only new audio there would be ours.
    assert_eq!(audio_in(&std::env::temp_dir()), audio_before);
}

/// Each file and its size, sorted; one that went while being listed is left out.
fn listing(files: &[PathBuf]) -> Vec<(PathBuf, u64)> {
    let mut all: Vec<(PathBuf, u64)> = files.iter().filter_map(|p| std::fs::metadata(p).ok().map(|m| (p.clone(), m.len()))).collect();
    all.sort();
    all
}

/// Audio files at the top of `dir`.
fn audio_in(dir: &std::path::Path) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = std::fs::read_dir(dir).map(|d| d.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| ["wav", "pcm", "raw", "flac", "ogg"].contains(&e.to_str().unwrap_or("")))).collect()).unwrap_or_default();
    found.sort();
    found
}

fn walk(dir: &std::path::Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    entries
        .flatten()
        .flat_map(|e| {
            let p = e.path();
            // The test's own build output aside.
            if p.ends_with("target") {
                Vec::new()
            } else if p.is_dir() {
                walk(&p)
            } else {
                vec![p]
            }
        })
        .collect()
}

proptest! {
    // Each case hears the whole clip: a few are enough to vary how it's cut up.
    #![proptest_config(ProptestConfig { cases: 4, ..ProptestConfig::default() })]

    /// However the samples arrive (a shell's buffers vary), the same phrases are settled, once
    /// each: none is taken back or repeated.
    #[test]
    fn the_same_phrases_settle_however_the_samples_are_cut(piece in 37usize..9000) {
        let clip = clip();
        let mut listener = Listener::open(&models(), &Options::default()).unwrap();
        let mut events = hear(&mut listener, &clip.samples, piece);
        events.extend(listener.stop().into_iter().map(|e| (0, e)));
        let mut reference = Listener::open(&models(), &Options::default()).unwrap();
        let mut expected = hear(&mut reference, &clip.samples, RATE / 10);
        expected.extend(reference.stop().into_iter().map(|e| (0, e)));
        prop_assert_eq!(settled(&events), settled(&expected));
    }
}
