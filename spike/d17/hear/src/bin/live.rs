//! An engine on the microphone, to hear it for yourself: what's heard updates in place, and each
//! settled phrase is printed on its own line. Ctrl+C to stop.
//!
//!   cargo run --release --features mic,whisper,vosk --bin live -- ENGINE [THREADS]

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hear::{open, Event, RATE};
use sherpa_onnx::LinearResampler;
use std::io::Write;
use std::sync::mpsc;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let name = args.first().map(String::as_str).unwrap_or("nemotron");
    let threads: i32 = args.get(1).map(|t| t.parse().unwrap()).unwrap_or(2);
    let mut engine = open(name, threads);

    let device = cpal::default_host().default_input_device().expect("no microphone");
    let config = device.default_input_config().expect("the microphone's format");
    let (rate, channels) = (config.sample_rate() as i32, config.channels() as usize);
    let (send, receive) = mpsc::channel::<Vec<f32>>();
    let stream = device
        .build_input_stream(
            &config.into(),
            move |data: &[f32], _| {
                // The first channel, mono.
                let _ = send.send(data.chunks(channels).map(|frame| frame[0]).collect());
            },
            |e| eprintln!("microphone: {e}"),
            None,
        )
        .expect("couldn't open the microphone");
    stream.play().unwrap();
    let resampler = (rate != RATE as i32).then(|| LinearResampler::create(rate, RATE as i32).unwrap());
    eprintln!("{name} is listening ({rate} Hz in). Speak; Ctrl+C to stop.");

    let mut out = Vec::new();
    for samples in receive {
        let samples = match &resampler {
            Some(r) => r.resample(&samples, false),
            None => samples,
        };
        engine.listener.feed(&samples, &mut out);
        for event in out.drain(..) {
            match event {
                Event::Heard(text) => {
                    print!("\r\x1b[2K\x1b[2m{text}\x1b[0m");
                }
                Event::Settled(text) => {
                    print!("\r\x1b[2K{text}\n");
                }
            }
            std::io::stdout().flush().unwrap();
        }
    }
}
