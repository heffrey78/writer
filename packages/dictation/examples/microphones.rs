//! The microphones dictation can choose from, as the settings list them, none of them opened.
//!
//!   cargo run --features mic --example microphones

fn main() {
    for m in dictation::mic::microphones() {
        println!("{}{}\n  {}", m.name, if m.bluetooth { " (Bluetooth)" } else { "" }, m.id);
    }
}
