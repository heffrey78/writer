//! The microphone (feature `mic`): what the shells start and stop. Samples come from the system's
//! default input, or the one the writer chose, through cpal, in its own format and rate, and are
//! heard as 16 kHz mono on a thread of their own; events go to the shell's callback, never to disk.
//!
//! On Linux it's PulseAudio's protocol where a server answers it (PipeWire's pipewire-pulse, or
//! PulseAudio), ALSA otherwise. The server names each microphone and lists them without opening one:
//! opening a Bluetooth headset's switches it into its headset mode, which a list mustn't do (#80).

use crate::listener::{Event, Listener, RATE};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{DeviceDescription, DeviceDirection, InterfaceType};
use sherpa_onnx::LinearResampler;
use std::fmt;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread::JoinHandle;
use std::time::Duration;

/// Why dictation couldn't start or go on: in the page's words (DEVELOPER.md, *Dictation*).
#[derive(Debug, PartialEq)]
pub enum Failure {
    /// There's no microphone.
    NoMicrophone,
    /// The microphone chosen isn't connected (its name).
    NotConnected(String),
    /// There is one, but it couldn't be opened (the system won't let Writer, or it's in use).
    Microphone(String),
    Other(String),
}

impl fmt::Display for Failure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Failure::NoMicrophone => write!(f, "there's no microphone"),
            Failure::NotConnected(name) => write!(f, "the microphone {name} isn't connected"),
            Failure::Microphone(e) => write!(f, "the microphone couldn't be used: {e}"),
            Failure::Other(e) => write!(f, "{e}"),
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
    thread: Option<JoinHandle<Listener>>,
}

impl Dictation {
    /// Open the microphone, `chosen` (a `Microphone`'s id) or the system's default, and hear it with
    /// `listener` (opened once and kept: opening the model takes seconds); each update goes to `on`.
    /// Returns once listening, or why it couldn't, with the listener back.
    pub fn start(listener: Listener, chosen: Option<Chosen>, on: impl FnMut(Update) + Send + 'static) -> Result<Dictation, (Failure, Listener)> {
        let (send, receive) = mpsc::channel::<Message>();
        let (started, ready) = mpsc::channel::<Result<(), Failure>>();
        let samples = send.clone();
        let thread = std::thread::spawn(move || run(listener, chosen, samples, receive, started, on));
        match ready.recv() {
            Ok(Ok(())) => Ok(Dictation { send, thread: Some(thread) }),
            Ok(Err(failure)) => Err((failure, thread.join().expect("the dictation thread"))),
            Err(_) => panic!("the dictation thread stopped as it started"),
        }
    }

    /// Stop: the phrase being heard is settled and sent before this returns, and the microphone let
    /// go. Gives the listener back, for the next time.
    pub fn stop(mut self) -> Listener {
        let _ = self.send.send(Message::Stop);
        self.thread.take().expect("running").join().expect("the dictation thread")
    }

    /// Whether it has stopped by itself (the microphone went away).
    pub fn ended(&self) -> bool {
        self.thread.as_ref().is_none_or(|t| t.is_finished())
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

fn run(
    mut listener: Listener,
    chosen: Option<Chosen>,
    samples: mpsc::Sender<Message>,
    receive: mpsc::Receiver<Message>,
    started: mpsc::Sender<Result<(), Failure>>,
    mut on: impl FnMut(Update),
) -> Listener {
    // The stream lives on this thread: cpal's isn't Send everywhere.
    let stream = match open_microphone(chosen.as_ref(), samples) {
        Ok(s) => s,
        Err(f) => {
            void(started.send(Err(f)));
            return listener;
        }
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
                return listener;
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
    listener
}

fn void<T>(_: T) {}

/// A microphone the writer can choose.
#[derive(Clone, Debug, PartialEq)]
pub struct Microphone {
    /// What `start` is given to open it: the same from one run to the next.
    pub id: String,
    /// As the system names it ("Built-in Audio Analog Stereo").
    pub name: String,
    /// Opening it switches Bluetooth headphones into their headset mode.
    pub bluetooth: bool,
}

/// The microphone the writer chose: its id, and its name for saying it isn't connected.
#[derive(Clone, Debug)]
pub struct Chosen {
    pub id: String,
    pub name: String,
}

/// The microphones connected now, none of them opened.
pub fn microphones() -> Vec<Microphone> {
    let host = cpal::default_host();
    let Ok(devices) = host.input_devices() else { return Vec::new() };
    let found = devices.filter_map(|d| Some((d.id().ok()?.to_string(), d.description().ok()?)));
    listed(found)
}

/// The inputs worth choosing from what the host lists: microphones, not the monitors of speakers.
fn listed(devices: impl Iterator<Item = (String, DeviceDescription)>) -> Vec<Microphone> {
    devices
        .filter(|(id, d)| d.direction() == DeviceDirection::Input && !id.ends_with(".monitor"))
        .map(|(id, d)| {
            // PulseAudio's (and PipeWire's) Bluetooth sources are bluez_source.… and bluez_input.….
            let source = id.split_once(':').map_or(id.as_str(), |(_, source)| source);
            let bluetooth = d.interface_type() == InterfaceType::Bluetooth || source.starts_with("bluez_");
            Microphone { name: d.name().to_string(), id, bluetooth }
        })
        .collect()
}

/// The microphone `chosen`, or the default input; its first channel resampled to 16 kHz, into `send`.
fn open_microphone(chosen: Option<&Chosen>, send: mpsc::Sender<Message>) -> Result<cpal::Stream, Failure> {
    let host = cpal::default_host();
    let device = match chosen {
        Some(chosen) => chosen.id.parse().ok().and_then(|id| host.device_by_id(&id)).ok_or_else(|| Failure::NotConnected(chosen.name.clone()))?,
        None => host.default_input_device().ok_or(Failure::NoMicrophone)?,
    };
    let config = device.default_input_config().map_err(|e| Failure::Microphone(e.to_string()))?;
    let (rate, channels) = (config.sample_rate() as i32, config.channels() as usize);
    let mut stream_config: cpal::StreamConfig = config.into();
    // PulseAudio sends a recording in 2 s pieces unless asked for smaller, and starts with the first.
    #[cfg(target_os = "linux")]
    if device.id().is_ok_and(|id| id.host() == cpal::HostId::PulseAudio) {
        stream_config.buffer_size = cpal::BufferSize::Fixed(rate as u32 / 20);
    }
    let resampler = (rate != RATE as i32).then(|| LinearResampler::create(rate, RATE as i32)).flatten();
    let lost = send.clone();
    let stream = device
        .build_input_stream(
            stream_config,
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

#[cfg(test)]
mod tests {
    use super::{listed, Microphone};
    use cpal::{DeviceDescription, DeviceDescriptionBuilder, DeviceDirection, InterfaceType};

    fn device(id: &str, name: &str, direction: DeviceDirection, driver: Option<&str>, interface: InterfaceType) -> (String, DeviceDescription) {
        let mut d = DeviceDescriptionBuilder::new(name).direction(direction).interface_type(interface);
        if let Some(driver) = driver {
            d = d.driver(driver);
        }
        (id.to_string(), d.build())
    }

    #[test]
    fn pulseaudio_lists_its_microphones_and_says_which_are_bluetooth() {
        let found = listed(
            [
                device("pulseaudio:alsa_output.pci-0000_00_1f.3.analog-stereo", "Built-in Audio Analog Stereo", DeviceDirection::Output, None, InterfaceType::Unknown),
                device("pulseaudio:alsa_output.pci-0000_00_1f.3.analog-stereo.monitor", "Monitor of Built-in Audio Analog Stereo", DeviceDirection::Input, None, InterfaceType::Unknown),
                device("pulseaudio:alsa_input.pci-0000_00_1f.3.analog-stereo", "Built-in Audio Analog Stereo", DeviceDirection::Input, None, InterfaceType::Unknown),
                device("pulseaudio:bluez_input.4C:87:5D:00:00:00", "Bose NC 700", DeviceDirection::Input, None, InterfaceType::Unknown),
                device("pulseaudio:bluez_source.4C_87_5D_00_00_01.handsfree_head_unit", "QC35", DeviceDirection::Input, None, InterfaceType::Unknown),
            ]
            .into_iter(),
        );
        assert_eq!(
            found,
            vec![
                Microphone { id: "pulseaudio:alsa_input.pci-0000_00_1f.3.analog-stereo".into(), name: "Built-in Audio Analog Stereo".into(), bluetooth: false },
                Microphone { id: "pulseaudio:bluez_input.4C:87:5D:00:00:00".into(), name: "Bose NC 700".into(), bluetooth: true },
                Microphone { id: "pulseaudio:bluez_source.4C_87_5D_00_00_01.handsfree_head_unit".into(), name: "QC35".into(), bluetooth: true },
            ]
        );
    }

    #[test]
    fn other_hosts_list_their_inputs() {
        let found = listed([device("wasapi:{0.0.1}", "Microphone Array", DeviceDirection::Input, None, InterfaceType::Unknown), device("wasapi:{0.0.0}", "Speakers", DeviceDirection::Output, None, InterfaceType::Unknown)].into_iter());
        assert_eq!(found, vec![Microphone { id: "wasapi:{0.0.1}".into(), name: "Microphone Array".into(), bluetooth: false }]);
    }
}
