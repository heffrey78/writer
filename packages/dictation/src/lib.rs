//! Writer's speech crate (D17 #77, from the spike #78; requirements #71–#76).
//!
//! Dictation hears on the device: 16 kHz samples in, the phrase being heard and each settled phrase
//! out, the two things the page shows and writes (DEVELOPER.md, *Dictation*). The shells use it:
//! the desktop's (#83, with the `mic` feature) and Android's (#86, with `shared`). Audio is held in
//! memory only for the phrase being heard; nothing here writes to disk but `model::install`.
//!
//! - `model`: the files, where they come from, and whether the ones on disk are whole.
//! - `Listener`: hearing samples, from a clip or a microphone.
//! - `mic::Dictation` (feature `mic`): the microphone, heard on a thread of its own.

pub mod model;
mod listener;
#[cfg(feature = "mic")]
pub mod mic;

pub use listener::{Error, Event, Listener, Options, RATE};
