//! D17's spike (#78): speech engines behind one listener, as Writer's speech crate (#82) would have
//! them. Samples in, 16 kHz mono; out, the phrase being heard so far and each phrase once settled,
//! the two events the page takes (DEVELOPER.md, *Dictation*).
//!
//! Two shapes of engine:
//! - streaming: the model hears as the samples come and says when a phrase has ended (an endpoint);
//! - phrase at a time: Silero's voice detection cuts the speech at pauses, each phrase is decoded
//!   when it ends, and the phrase so far is decoded again every second for what's heard meanwhile.

use sherpa_onnx::{
    OfflineModelConfig, OfflineMoonshineModelConfig, OfflineRecognizer, OfflineRecognizerConfig, OfflineTransducerModelConfig, OnlineModelConfig,
    OnlinePunctuation, OnlinePunctuationConfig, OnlinePunctuationModelConfig, OnlineRecognizer, OnlineRecognizerConfig, OnlineStream,
    OnlineTransducerModelConfig, SileroVadModelConfig, VadModelConfig, VoiceActivityDetector,
};
use std::path::{Path, PathBuf};

pub const RATE: usize = 16_000;

#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    /// The phrase being heard, so far: each replaces the last.
    Heard(String),
    /// A phrase, final.
    Settled(String),
}

pub trait Listener {
    fn feed(&mut self, samples: &[f32], out: &mut Vec<Event>);
    /// No more samples: settle what's being heard.
    fn finish(&mut self, out: &mut Vec<Event>);
}

/// An engine, opened: the listener, and the model files it reads (for their size on disk).
pub struct Engine {
    pub listener: Box<dyn Listener>,
    pub files: Vec<PathBuf>,
    /// Streaming, or phrase at a time.
    pub streaming: bool,
}

pub const ENGINES: &[&str] = &[
    "zipformer",
    "zipformer+punct",
    "kroko+punct",
    "fastconformer",
    "fastconformer+punct",
    "nemotron",
    "moonshine-base",
    "moonshine-tiny",
    "parakeet-110m",
    "parakeet-110m+zipformer",
    "moonshine-base+zipformer",
    "whisper-base",
    "whisper-small",
    "vosk-small",
];

/// The spike's folder: models/, clips/ and results/ are in it. HEAR_DIR says where, on a phone.
pub fn home() -> PathBuf {
    std::env::var_os("HEAR_DIR").map(PathBuf::from).unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join(".."))
}

pub fn models() -> PathBuf {
    home().join("models")
}

fn file(dir: &str, name: &str) -> PathBuf {
    let path = models().join(dir).join(name);
    assert!(path.exists(), "{} is missing: run fetch-models.sh", path.display());
    path
}

fn s(path: &Path) -> Option<String> {
    Some(path.to_string_lossy().into_owned())
}

/// Open the engine `name` (one of ENGINES), on `threads` threads.
pub fn open(name: &str, threads: i32) -> Engine {
    if let Some(settler) = name.strip_suffix("+zipformer") {
        return hybrid(settler, threads);
    }
    let (base, punct) = match name.strip_suffix("+punct") {
        Some(base) => (base, true),
        None => (name, false),
    };
    let mut engine = match base {
        "zipformer" => streaming(&zipformer_files(), threads),
        "kroko" => {
            let d = "sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06";
            streaming(&[file(d, "encoder.onnx"), file(d, "decoder.onnx"), file(d, "joiner.onnx"), file(d, "tokens.txt")], threads)
        }
        "fastconformer" => {
            let d = "sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-480ms-int8";
            streaming(&[file(d, "encoder.int8.onnx"), file(d, "decoder.int8.onnx"), file(d, "joiner.int8.onnx"), file(d, "tokens.txt")], threads)
        }
        "nemotron" => {
            let d = "sherpa-onnx-nemotron-speech-streaming-en-0.6b-560ms-int8-2026-04-25";
            streaming(&[file(d, "encoder.int8.onnx"), file(d, "decoder.int8.onnx"), file(d, "joiner.int8.onnx"), file(d, "tokens.txt")], threads)
        }
        "moonshine-base" | "moonshine-tiny" | "parakeet-110m" => {
            let (config, files) = offline_config(base, threads);
            offline(config, files, threads)
        }
        #[cfg(feature = "whisper")]
        "whisper-base" | "whisper-small" => whisper::open(base, threads),
        #[cfg(feature = "vosk")]
        "vosk-small" => vosk_engine::open(),
        other => panic!("no engine {other} (whisper and vosk need their features)"),
    };
    if punct {
        let d = "sherpa-onnx-online-punct-en-2024-08-06";
        let (model, vocab) = (file(d, "model.int8.onnx"), file(d, "bpe.vocab"));
        let config = OnlinePunctuationConfig {
            model: OnlinePunctuationModelConfig { cnn_bilstm: s(&model), bpe_vocab: s(&vocab), num_threads: 1, ..Default::default() },
        };
        let punctuation = OnlinePunctuation::create(&config).expect("the punctuation model");
        engine.files.extend([model, vocab]);
        engine.listener = Box::new(Punctuated { inner: engine.listener, punctuation });
    }
    engine
}

fn zipformer_files() -> Vec<PathBuf> {
    let d = "sherpa-onnx-streaming-zipformer-en-2023-06-26";
    let t = "epoch-99-avg-1-chunk-16-left-128.int8.onnx";
    vec![file(d, &format!("encoder-{t}")), file(d, &format!("decoder-{t}")), file(d, &format!("joiner-{t}")), file(d, "tokens.txt")]
}

/// The phrase-at-a-time models through sherpa-onnx's offline recognizer, and the files they read.
fn offline_config(base: &str, threads: i32) -> (OfflineRecognizerConfig, Vec<PathBuf>) {
    if base == "parakeet-110m" {
        let d = "sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8";
        let files = vec![file(d, "encoder.int8.onnx"), file(d, "decoder.int8.onnx"), file(d, "joiner.int8.onnx"), file(d, "tokens.txt")];
        let config = OfflineRecognizerConfig {
            model_config: OfflineModelConfig {
                transducer: OfflineTransducerModelConfig { encoder: s(&files[0]), decoder: s(&files[1]), joiner: s(&files[2]) },
                tokens: s(&files[3]),
                num_threads: threads,
                model_type: Some("nemo_transducer".into()),
                ..Default::default()
            },
            ..Default::default()
        };
        return (config, files);
    }
    let d = if base == "moonshine-base" { "sherpa-onnx-moonshine-base-en-quantized-2026-02-27" } else { "sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27" };
    let files = vec![file(d, "encoder_model.ort"), file(d, "decoder_model_merged.ort"), file(d, "tokens.txt")];
    let config = OfflineRecognizerConfig {
        model_config: OfflineModelConfig {
            moonshine: OfflineMoonshineModelConfig { encoder: s(&files[0]), merged_decoder: s(&files[1]), ..Default::default() },
            tokens: s(&files[2]),
            num_threads: threads,
            ..Default::default()
        },
        ..Default::default()
    };
    (config, files)
}

// ---------------------------------------------------------------------------
// Streaming, through sherpa-onnx's online recognizer

/// Silence after speech that ends a phrase: the writer's pause.
const SETTLE_SILENCE_S: f32 = 0.8;

struct Streaming {
    recognizer: OnlineRecognizer,
    stream: OnlineStream,
    heard: String,
}

fn streaming(files: &[PathBuf], threads: i32) -> Engine {
    Engine { listener: Box::new(streamer(files, threads)), files: files.to_vec(), streaming: true }
}

fn streamer(files: &[PathBuf], threads: i32) -> Streaming {
    let config = OnlineRecognizerConfig {
        model_config: OnlineModelConfig {
            transducer: OnlineTransducerModelConfig { encoder: s(&files[0]), decoder: s(&files[1]), joiner: s(&files[2]) },
            tokens: s(&files[3]),
            num_threads: threads,
            ..Default::default()
        },
        decoding_method: Some("greedy_search".into()),
        enable_endpoint: true,
        rule1_min_trailing_silence: 2.4,
        rule2_min_trailing_silence: SETTLE_SILENCE_S,
        rule3_min_utterance_length: 20.0,
        ..Default::default()
    };
    let recognizer = OnlineRecognizer::create(&config).expect("the streaming model");
    let stream = recognizer.create_stream();
    Streaming { recognizer, stream, heard: String::new() }
}

/// Some models write in capitals, without punctuation: lower-cased, to be read (or punctuated).
fn plain(text: &str) -> String {
    let text = text.trim();
    if text.chars().any(|c| c.is_lowercase()) {
        text.to_string()
    } else {
        text.to_lowercase()
    }
}

impl Listener for Streaming {
    fn feed(&mut self, samples: &[f32], out: &mut Vec<Event>) {
        self.stream.accept_waveform(RATE as i32, samples);
        while self.recognizer.is_ready(&self.stream) {
            self.recognizer.decode(&self.stream);
        }
        let text = self.recognizer.get_result(&self.stream).map(|r| plain(&r.text)).unwrap_or_default();
        if self.recognizer.is_endpoint(&self.stream) {
            if !text.is_empty() {
                out.push(Event::Settled(text));
            }
            self.recognizer.reset(&self.stream);
            self.heard.clear();
        } else if text != self.heard {
            out.push(Event::Heard(text.clone()));
            self.heard = text;
        }
    }

    fn finish(&mut self, out: &mut Vec<Event>) {
        self.stream.input_finished();
        while self.recognizer.is_ready(&self.stream) {
            self.recognizer.decode(&self.stream);
        }
        let text = self.recognizer.get_result(&self.stream).map(|r| plain(&r.text)).unwrap_or_default();
        if !text.is_empty() {
            out.push(Event::Settled(text));
        }
    }
}

/// A settled phrase punctuated and capitalised by sherpa-onnx's online punctuation model.
struct Punctuated {
    inner: Box<dyn Listener>,
    punctuation: OnlinePunctuation,
}

impl Punctuated {
    fn fix(&self, events: &mut [Event]) {
        for event in events {
            if let Event::Settled(text) = event {
                *text = self.punctuation.add_punctuation(&text.to_lowercase()).unwrap_or_else(|| text.clone());
            }
        }
    }
}

impl Listener for Punctuated {
    fn feed(&mut self, samples: &[f32], out: &mut Vec<Event>) {
        let from = out.len();
        self.inner.feed(samples, out);
        self.fix(&mut out[from..]);
    }
    fn finish(&mut self, out: &mut Vec<Event>) {
        let from = out.len();
        self.inner.finish(out);
        self.fix(&mut out[from..]);
    }
}

// ---------------------------------------------------------------------------
// Phrase at a time: Silero's voice detection, and a decoder for a phrase

/// How long a pause ends a phrase.
const PHRASE_SILENCE_S: f32 = 0.5;
/// How often the phrase so far is decoded again, for what's heard.
const HEARD_EVERY_S: f32 = 1.0;
/// Audio kept from before the voice starts, so a phrase's first sound isn't cut.
const PREROLL_S: f32 = 0.3;
const WINDOW: usize = 512;

pub type Decode = Box<dyn FnMut(&[f32]) -> String>;

pub struct Phrased {
    vad: VoiceActivityDetector,
    decode: Decode,
    /// Whether it decodes the phrase so far, for what's heard (not when another engine hears).
    hears: bool,
    pending: Vec<f32>,
    recent: Vec<f32>,
    speaking: bool,
    since_heard: usize,
    heard: String,
}

pub fn vad_file() -> PathBuf {
    file(".", "silero_vad.onnx")
}

impl Phrased {
    pub fn new(decode: Decode) -> Self {
        let config = VadModelConfig {
            silero_vad: SileroVadModelConfig {
                model: s(&vad_file()),
                threshold: 0.5,
                min_silence_duration: PHRASE_SILENCE_S,
                min_speech_duration: 0.25,
                window_size: WINDOW as i32,
                max_speech_duration: 20.0,
            },
            sample_rate: RATE as i32,
            num_threads: 1,
            ..Default::default()
        };
        let vad = VoiceActivityDetector::create(&config, 60.0).expect("Silero's voice detection");
        Phrased { vad, decode, hears: true, pending: Vec::new(), recent: Vec::new(), speaking: false, since_heard: 0, heard: String::new() }
    }

    fn settle(&mut self, out: &mut Vec<Event>) {
        while !self.vad.is_empty() {
            if let Some(segment) = self.vad.front() {
                let text = (self.decode)(segment.samples()).trim().to_string();
                if !text.is_empty() {
                    out.push(Event::Settled(text));
                }
            }
            self.vad.pop();
            self.speaking = false;
            self.recent.clear();
            self.heard.clear();
        }
    }
}

impl Listener for Phrased {
    fn feed(&mut self, samples: &[f32], out: &mut Vec<Event>) {
        self.pending.extend_from_slice(samples);
        let windows = self.pending.len() / WINDOW;
        for i in 0..windows {
            let window: Vec<f32> = self.pending[i * WINDOW..(i + 1) * WINDOW].to_vec();
            self.vad.accept_waveform(&window);
            self.recent.extend_from_slice(&window);
            if self.vad.detected() && !self.speaking {
                self.speaking = true;
                self.since_heard = 0;
            }
            if self.speaking && self.hears {
                self.since_heard += WINDOW;
                if self.since_heard as f32 >= HEARD_EVERY_S * RATE as f32 {
                    self.since_heard = 0;
                    let text = (self.decode)(&self.recent).trim().to_string();
                    if text != self.heard {
                        out.push(Event::Heard(text.clone()));
                        self.heard = text;
                    }
                }
            } else if !self.speaking {
                let keep = (PREROLL_S * RATE as f32) as usize;
                if self.recent.len() > keep {
                    self.recent.drain(..self.recent.len() - keep);
                }
            }
            self.settle(out);
        }
        self.pending.drain(..windows * WINDOW);
    }

    fn finish(&mut self, out: &mut Vec<Event>) {
        self.vad.flush();
        self.settle(out);
    }
}

fn offline(config: OfflineRecognizerConfig, mut files: Vec<PathBuf>, _threads: i32) -> Engine {
    files.push(vad_file());
    Engine { listener: Box::new(phrased(&config)), files, streaming: false }
}

/// Names to spell as the book does (HEAR_HOTWORDS="harangue,angor"), in the model's word pieces:
/// split by longest match against its tokens, near enough to its own splitting for the spike.
fn hotwords(tokens: &Path) -> Option<String> {
    let words = std::env::var("HEAR_HOTWORDS").ok()?;
    let pieces: Vec<String> = std::fs::read_to_string(tokens).ok()?.lines().filter_map(|l| l.rsplit_once(' ').map(|(p, _)| p.to_string())).collect();
    let split = |word: &str| {
        let mut rest = format!("▁{}", word.to_lowercase());
        let mut out = Vec::new();
        while !rest.is_empty() {
            let piece = pieces.iter().filter(|p| rest.starts_with(p.as_str())).max_by_key(|p| p.len())?;
            out.push(piece.clone());
            rest = rest[piece.len()..].to_string();
        }
        Some(out.join(" "))
    };
    words.split(',').map(|w| w.split_whitespace().map(split).collect::<Option<Vec<_>>>().map(|p| p.join(" "))).collect::<Option<Vec<_>>>().map(|l| l.join("\n"))
}

fn phrased(config: &OfflineRecognizerConfig) -> Phrased {
    let words = config.model_config.tokens.as_ref().and_then(|t| hotwords(Path::new(t)));
    let mut config = config.clone();
    if words.is_some() {
        config.decoding_method = Some("modified_beam_search".into());
        config.hotwords_score = std::env::var("HEAR_HOTWORDS_SCORE").ok().and_then(|s| s.parse().ok()).unwrap_or(2.0);
        eprintln!("hotwords: {:?}", words);
    }
    let recognizer = OfflineRecognizer::create(&config).expect("the model");
    Phrased::new(Box::new(move |samples| {
        let stream = match &words {
            Some(w) => recognizer.create_stream_with_hotwords(w),
            None => recognizer.create_stream(),
        };
        stream.accept_waveform(RATE as i32, samples);
        recognizer.decode(&stream);
        stream.get_result().map(|r| r.text).unwrap_or_default()
    }))
}

/// What's heard from the streaming Zipformer, quick and cheap; each phrase settled by `settler`,
/// phrase at a time, which writes prose. The Zipformer starts afresh with each settled phrase.
struct Hybrid {
    hearer: Streaming,
    settler: Phrased,
}

fn hybrid(settler: &str, threads: i32) -> Engine {
    let hearer = streamer(&zipformer_files(), 1);
    let (mut settler, mut files) = match settler {
        #[cfg(feature = "whisper")]
        "whisper-base" | "whisper-small" => whisper::phrased(settler, threads),
        _ => {
            let (config, files) = offline_config(settler, threads);
            (phrased(&config), files)
        }
    };
    settler.hears = false;
    files.extend(zipformer_files());
    files.push(vad_file());
    Engine { listener: Box::new(Hybrid { hearer, settler }), files, streaming: true }
}

impl Hybrid {
    fn take(&mut self, heard: Vec<Event>, settled: Vec<Event>, out: &mut Vec<Event>) {
        out.extend(heard.into_iter().filter(|e| matches!(e, Event::Heard(_))));
        if !settled.is_empty() {
            self.hearer.recognizer.reset(&self.hearer.stream);
            self.hearer.heard.clear();
            out.extend(settled);
        }
    }
}

impl Listener for Hybrid {
    fn feed(&mut self, samples: &[f32], out: &mut Vec<Event>) {
        let (mut heard, mut settled) = (Vec::new(), Vec::new());
        self.hearer.feed(samples, &mut heard);
        self.settler.feed(samples, &mut settled);
        self.take(heard, settled, out);
    }
    fn finish(&mut self, out: &mut Vec<Event>) {
        let mut settled = Vec::new();
        self.settler.finish(&mut settled);
        self.take(Vec::new(), settled, out);
    }
}

#[cfg(feature = "whisper")]
mod whisper {
    use super::*;
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    pub fn open(name: &str, threads: i32) -> Engine {
        let (listener, mut files) = phrased(name, threads);
        files.push(vad_file());
        Engine { listener: Box::new(listener), files, streaming: false }
    }

    pub fn phrased(name: &str, threads: i32) -> (Phrased, Vec<PathBuf>) {
        let model = file(".", if name == "whisper-base" { "ggml-base.en.bin" } else { "ggml-small.en.bin" });
        whisper_rs::install_logging_hooks();
        let context = WhisperContext::new_with_params(&model, WhisperContextParameters::default()).expect("the whisper model");
        let mut state = context.create_state().expect("a whisper state");
        let decode: Decode = Box::new(move |samples| {
            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            params.set_n_threads(threads);
            params.set_language(Some("en"));
            params.set_no_context(true);
            params.set_single_segment(true);
            params.set_print_progress(false);
            params.set_print_realtime(false);
            params.set_print_special(false);
            params.set_print_timestamps(false);
            params.set_suppress_blank(true);
            params.set_suppress_nst(true);
            // Whisper wants a second at least.
            let mut padded = samples.to_vec();
            if padded.len() < RATE + RATE / 10 {
                padded.resize(RATE + RATE / 10, 0.0);
            }
            if state.full(params, &padded).is_err() {
                return String::new();
            }
            state.as_iter().map(|segment| segment.to_str_lossy().map(|t| t.into_owned()).unwrap_or_default()).collect::<Vec<_>>().join(" ")
        });
        (Phrased::new(decode), vec![model])
    }
}

#[cfg(feature = "vosk")]
mod vosk_engine {
    use super::*;
    use vosk::{DecodingState, Model, Recognizer};

    struct Vosk {
        recognizer: Recognizer,
        heard: String,
    }

    pub fn open() -> Engine {
        let dir = models().join("vosk-model-small-en-us-0.15");
        vosk::set_log_level(vosk::LogLevel::Error);
        let model = Model::new(dir.to_string_lossy()).expect("the vosk model");
        let recognizer = Recognizer::new(&model, RATE as f32).expect("a vosk recognizer");
        // The recognizer holds what it needs of the model.
        std::mem::forget(model);
        let files = std::fs::read_dir(&dir).unwrap().flat_map(|e| walk(&e.unwrap().path())).collect();
        Engine { listener: Box::new(Vosk { recognizer, heard: String::new() }), files, streaming: true }
    }

    fn walk(path: &Path) -> Vec<PathBuf> {
        if path.is_dir() {
            std::fs::read_dir(path).unwrap().flat_map(|e| walk(&e.unwrap().path())).collect()
        } else {
            vec![path.to_path_buf()]
        }
    }

    impl Listener for Vosk {
        fn feed(&mut self, samples: &[f32], out: &mut Vec<Event>) {
            let pcm: Vec<i16> = samples.iter().map(|s| (s * 32767.0).clamp(-32768.0, 32767.0) as i16).collect();
            match self.recognizer.accept_waveform(&pcm) {
                Ok(DecodingState::Finalized) => {
                    let text = self.recognizer.result().single().map(|r| r.text.to_string()).unwrap_or_default();
                    if !text.trim().is_empty() {
                        out.push(Event::Settled(text));
                    }
                    self.heard.clear();
                }
                _ => {
                    let text = self.recognizer.partial_result().partial.to_string();
                    if text != self.heard {
                        out.push(Event::Heard(text.clone()));
                        self.heard = text;
                    }
                }
            }
        }
        fn finish(&mut self, out: &mut Vec<Event>) {
            let text = self.recognizer.final_result().single().map(|r| r.text.to_string()).unwrap_or_default();
            if !text.trim().is_empty() {
                out.push(Event::Settled(text));
            }
        }
    }
}
