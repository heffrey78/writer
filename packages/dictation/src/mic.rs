//! The microphone (feature `mic`): what the shells start and stop. Samples come from the system's
//! default input through cpal, in its own format and rate, and are heard as 16 kHz mono on a thread
//! of their own; events go to the shell's callback, never to disk.

use crate::listener::{Event, Listener, Options, RATE};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use sherpa_onnx::LinearResampler;
use std::fmt;
use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread::JoinHandle;
use std::time::Duration;

/// Why dictation couldn't start or go on: in the page's words (DEVELOPER.md, *Dictation*).
#[derive(Debug, PartialEq)]
pub enum Failure {
    /// There's no microphone.
    NoMicrophone,
    /// There is one, but it couldn't be opened (the system won't let Writer, or it's in use).
    Microphone(String),
    /// The model isn't there, or isn't whole.
    Model(String),
    Other(String),
}

impl fmt::Display for Failure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Failure::NoMicrophone => write!(f, "there's no microphone"),
            Failure::Microphone(e) => write!(f, "the microphone couldn't be used: {e}"),
            Failure::Model(e) | Failure::Other(e) => write!(f, "{e}"),
        }
    }
}

/// What the shell hears from dictation, on the dictation's thread.
pub enum Update {
    Event(Event),
    /// It stopped by itself (the microphone went away): what was heard is settled first.
    Failed(Failure),
}

enum Message {
    Samples(Vec<f32>),
    Lost(String),
    Stop,
}

/// Dictation running: the microphone open, and the listener hearing it.
pub struct Dictation {
    send: mpsc::Sender<Message>,
    thread: Option<JoinHandle<()>>,
}

impl Dictation {
    /// Open the model in `models` and the default microphone, and start hearing; each update goes
    /// to `on`. Returns once listening, or why it couldn't.
    pub fn start(models: PathBuf, options: Options, on: impl FnMut(Update) + Send + 'static) -> Result<Dictation, Failure> {
        let (send, receive) = mpsc::channel::<Message>();
        let (started, ready) = mpsc::channel::<Result<(), Failure>>();
        let samples = send.clone();
        let thread = std::thread::spawn(move || run(models, options, samples, receive, started, on));
        match ready.recv() {
            Ok(Ok(())) => Ok(Dictation { send, thread: Some(thread) }),
            Ok(Err(failure)) => {
                let _ = thread.join();
                Err(failure)
            }
            Err(_) => Err(Failure::Other("dictation stopped as it started".into())),
        }
    }

    /// Stop: the phrase being heard is settled and sent before this returns, and the microphone let go.
    pub fn stop(mut self) {
        let _ = self.send.send(Message::Stop);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for Dictation {
    fn drop(&mut self) {
        let _ = self.send.send(Message::Stop);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn run(models: PathBuf, options: Options, samples: mpsc::Sender<Message>, receive: mpsc::Receiver<Message>, started: mpsc::Sender<Result<(), Failure>>, mut on: impl FnMut(Update)) {
    let mut listener = match Listener::open(&models, &options) {
        Ok(l) => l,
        Err(e) => return void(started.send(Err(Failure::Model(e.to_string())))),
    };
    // The stream lives on this thread: cpal's isn't Send everywhere.
    let stream = match open_microphone(samples) {
        Ok(s) => s,
        Err(f) => return void(started.send(Err(f))),
    };
    void(started.send(Ok(())));
    loop {
        match receive.recv_timeout(Duration::from_millis(200)) {
            Ok(Message::Samples(chunk)) => {
                for event in listener.feed(&chunk) {
                    on(Update::Event(event));
                }
            }
            Ok(Message::Lost(why)) => {
                drop(stream);
                for event in listener.stop() {
                    on(Update::Event(event));
                }
                on(Update::Failed(Failure::Microphone(why)));
                return;
            }
            Ok(Message::Stop) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
    drop(stream);
    // Samples already sent, then what's being heard.
    while let Ok(Message::Samples(chunk)) = receive.try_recv() {
        for event in listener.feed(&chunk) {
            on(Update::Event(event));
        }
    }
    for event in listener.stop() {
        on(Update::Event(event));
    }
}

fn void<T>(_: T) {}

/// The default input, its first channel resampled to 16 kHz, into `send`.
fn open_microphone(send: mpsc::Sender<Message>) -> Result<cpal::Stream, Failure> {
    let device = cpal::default_host().default_input_device().ok_or(Failure::NoMicrophone)?;
    let config = device.default_input_config().map_err(|e| Failure::Microphone(e.to_string()))?;
    let (rate, channels) = (config.sample_rate() as i32, config.channels() as usize);
    let resampler = (rate != RATE as i32).then(|| LinearResampler::create(rate, RATE as i32)).flatten();
    let lost = send.clone();
    let stream = device
        .build_input_stream(
            config.into(),
            move |data: &[f32], _| {
                let mono: Vec<f32> = data.chunks(channels.max(1)).map(|frame| frame[0]).collect();
                let samples = match &resampler {
                    Some(r) => r.resample(&mono, false),
                    None => mono,
                };
                let _ = send.send(Message::Samples(samples));
            },
            move |e| {
                let _ = lost.send(Message::Lost(e.to_string()));
            },
            None,
        )
        .map_err(|e| Failure::Microphone(e.to_string()))?;
    stream.play().map_err(|e| Failure::Microphone(e.to_string()))?;
    Ok(stream)
}
