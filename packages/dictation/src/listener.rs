//! Hearing: 16 kHz mono samples in; the phrase being heard and each settled phrase out.
//!
//! Two models listen to the same samples (D17, as the spike #78 found best). The streaming
//! Zipformer gives what's heard as the writer speaks: quick and cheap, but in capitals and without
//! punctuation, so it's only ever shown, lower-cased. Silero's voice detection cuts the speech at
//! pauses, and Parakeet TDT 110M decodes each phrase whole when it ends, with its capitals and
//! punctuation: that's the settled phrase. The Zipformer starts afresh after each one.

use crate::model::{self, ModelError};
use sherpa_onnx::{
    OfflineModelConfig, OfflineRecognizer, OfflineRecognizerConfig, OfflineTransducerModelConfig, OnlineModelConfig, OnlineRecognizer,
    OnlineRecognizerConfig, OnlineStream, OnlineTransducerModelConfig, SileroVadModelConfig, VadModelConfig, VoiceActivityDetector,
};
use std::fmt;
use std::path::Path;

/// Samples a second: what `feed` takes.
pub const RATE: usize = 16_000;

/// A pause this long ends a phrase.
const PHRASE_SILENCE_S: f32 = 0.5;
/// A phrase is cut after this long without a pause, as no writer dictates longer in one breath.
const LONGEST_PHRASE_S: f32 = 20.0;
const WINDOW: usize = 512;

#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    /// The phrase being heard, so far; each replaces the last. Empty once it's settled.
    Heard(String),
    /// A phrase, final: written into the text.
    Settled(String),
}

#[derive(Clone, Debug)]
pub struct Options {
    /// English only, for now (D17; other languages come with #92).
    pub language: String,
    /// For the decoding; one is enough (the spike: a tenth of a core on the phone).
    pub threads: i32,
}

impl Default for Options {
    fn default() -> Self {
        Options { language: "en".into(), threads: 1 }
    }
}

#[derive(Debug, PartialEq)]
pub enum Error {
    Model(ModelError),
    /// A language the model doesn't hear.
    Language(String),
    /// The engine wouldn't start with the model's files.
    Engine(&'static str),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Model(e) => e.fmt(f),
            Error::Language(l) => write!(f, "dictation doesn't hear {l} yet: English only, for now"),
            Error::Engine(what) => write!(f, "the speech engine couldn't start its {what}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<ModelError> for Error {
    fn from(e: ModelError) -> Self {
        Error::Model(e)
    }
}

pub struct Listener {
    hearer: OnlineRecognizer,
    stream: OnlineStream,
    vad: VoiceActivityDetector,
    settler: OfflineRecognizer,
    /// Samples not yet a whole window for the voice detection.
    pending: Vec<f32>,
    heard: String,
}

fn s(dir: &Path, file: &str) -> Option<String> {
    Some(dir.join(file).to_string_lossy().into_owned())
}

impl Listener {
    /// Open the model in `dir` (as `model::install` left it), checking first that it's all there.
    pub fn open(dir: &Path, options: &Options) -> Result<Listener, Error> {
        if options.language != "en" {
            return Err(Error::Language(options.language.clone()));
        }
        model::check(dir)?;
        let hearer = OnlineRecognizer::create(&OnlineRecognizerConfig {
            model_config: OnlineModelConfig {
                transducer: OnlineTransducerModelConfig {
                    encoder: s(dir, "zipformer/encoder.int8.onnx"),
                    decoder: s(dir, "zipformer/decoder.int8.onnx"),
                    joiner: s(dir, "zipformer/joiner.int8.onnx"),
                },
                tokens: s(dir, "zipformer/tokens.txt"),
                // It only shows what's heard: one thread, whatever the decoding has.
                num_threads: 1,
                ..Default::default()
            },
            decoding_method: Some("greedy_search".into()),
            ..Default::default()
        })
        .ok_or(Error::Engine("streaming model"))?;
        let stream = hearer.create_stream();
        let vad = VoiceActivityDetector::create(
            &VadModelConfig {
                silero_vad: SileroVadModelConfig {
                    model: s(dir, "silero_vad.onnx"),
                    threshold: 0.5,
                    min_silence_duration: PHRASE_SILENCE_S,
                    min_speech_duration: 0.25,
                    window_size: WINDOW as i32,
                    max_speech_duration: LONGEST_PHRASE_S,
                },
                sample_rate: RATE as i32,
                num_threads: 1,
                ..Default::default()
            },
            60.0,
        )
        .ok_or(Error::Engine("voice detection"))?;
        let settler = OfflineRecognizer::create(&OfflineRecognizerConfig {
            model_config: OfflineModelConfig {
                transducer: OfflineTransducerModelConfig {
                    encoder: s(dir, "parakeet/encoder.int8.onnx"),
                    decoder: s(dir, "parakeet/decoder.int8.onnx"),
                    joiner: s(dir, "parakeet/joiner.int8.onnx"),
                },
                tokens: s(dir, "parakeet/tokens.txt"),
                num_threads: options.threads.max(1),
                model_type: Some("nemo_transducer".into()),
                ..Default::default()
            },
            // A fifth fewer words wrong than greedy, for no more CPU (the spike).
            decoding_method: Some("modified_beam_search".into()),
            max_active_paths: 4,
            ..Default::default()
        })
        .ok_or(Error::Engine("model"))?;
        Ok(Listener { hearer, stream, vad, settler, pending: Vec::new(), heard: String::new() })
    }

    /// Samples heard, 16 kHz mono, in any number at a time; what's heard and settled because of them.
    pub fn feed(&mut self, samples: &[f32]) -> Vec<Event> {
        let mut out = Vec::new();
        self.stream.accept_waveform(RATE as i32, samples);
        while self.hearer.is_ready(&self.stream) {
            self.hearer.decode(&self.stream);
        }
        let heard = self.hearer.get_result(&self.stream).map(|r| r.text.trim().to_lowercase()).unwrap_or_default();

        self.pending.extend_from_slice(samples);
        let windows = self.pending.len() / WINDOW;
        let mut settled = false;
        for i in 0..windows {
            self.vad.accept_waveform(&self.pending[i * WINDOW..(i + 1) * WINDOW]);
            settled |= self.settle(&mut out);
        }
        self.pending.drain(..windows * WINDOW);

        // What's heard is shown while there's speech: the Zipformer runs a little behind the voice
        // detection, and can still give a word once the phrase has ended.
        if settled {
            self.afresh(&mut out);
        } else if heard != self.heard && !heard.is_empty() && self.vad.detected() {
            out.push(Event::Heard(heard.clone()));
            self.heard = heard;
        }
        out
    }

    /// The writer stopped: settle the phrase being heard, and be ready for the next dictation.
    pub fn stop(&mut self) -> Vec<Event> {
        let mut out = Vec::new();
        if !self.pending.is_empty() {
            let mut last = std::mem::take(&mut self.pending);
            last.resize(WINDOW, 0.0);
            self.vad.accept_waveform(&last);
        }
        self.vad.flush();
        self.settle(&mut out);
        self.vad.reset();
        self.afresh(&mut out);
        out
    }

    /// Each phrase the voice detection has ended, decoded whole.
    fn settle(&mut self, out: &mut Vec<Event>) -> bool {
        let mut any = false;
        while !self.vad.is_empty() {
            if let Some(phrase) = self.vad.front() {
                let stream = self.settler.create_stream();
                stream.accept_waveform(RATE as i32, phrase.samples());
                self.settler.decode(&stream);
                let text = stream.get_result().map(|r| r.text.trim().to_string()).unwrap_or_default();
                if !text.is_empty() {
                    out.push(Event::Settled(text));
                    any = true;
                }
            }
            self.vad.pop();
        }
        any
    }

    /// What's heard starts afresh after a settled phrase: nothing greyed is left of it.
    fn afresh(&mut self, out: &mut Vec<Event>) {
        self.hearer.reset(&self.stream);
        if !self.heard.is_empty() {
            self.heard.clear();
            out.push(Event::Heard(String::new()));
        }
    }
}
