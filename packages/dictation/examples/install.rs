//! Install the speech model from downloads already made: each file is matched to its source by its
//! checksum, then installed into DIR as the listener reads it.
//!
//!   cargo run --release --example install -- DIR DOWNLOAD...
//!
//! With no downloads, it only says whether the model in DIR is whole (exit 1 if it isn't).

use dictation::model;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let dir = Path::new(args.first().expect("DIR"));
    if args.len() == 1 {
        let whole = model::verify(dir);
        eprintln!("{}: {}", dir.display(), whole.as_ref().map(|_| "the speech model, whole".to_string()).unwrap_or_else(|e| e.to_string()));
        std::process::exit(if whole.is_ok() { 0 } else { 1 });
    }
    for download in &args[1..] {
        let mut hash = Sha256::new();
        let mut file = std::fs::File::open(download).unwrap();
        let mut buf = vec![0u8; 1 << 16];
        loop {
            let n = file.read(&mut buf).unwrap();
            if n == 0 {
                break;
            }
            hash.update(&buf[..n]);
        }
        let digest: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
        let source = model::SOURCES.iter().find(|s| s.sha256 == digest).unwrap_or_else(|| panic!("{download} isn't one of the model's sources"));
        model::install(source, Path::new(download), dir).unwrap_or_else(|e| panic!("{download}: {e}"));
        eprintln!("installed {} from {download}", source.name);
    }
    model::verify(dir).expect("the model, whole");
    eprintln!("{}: the speech model, {} MB", dir.display(), model::installed_bytes() / 1_000_000);
}
