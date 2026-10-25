//! The speech model: the files the listener reads, where they come from, and whether the ones in
//! the host's folder are whole. D17 (#77, amended from the spike #78) names them: Parakeet TDT
//! 110M settles each phrase, the streaming Zipformer shows what's heard, and Silero finds the
//! pauses. The host downloads each source from its pinned address and hands it to `install`, which
//! keeps only the files listed here, checked against their checksums.

use sha2::{Digest, Sha256};
use std::fmt;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

/// Where a set of the model's files comes from.
#[derive(Debug)]
pub struct Source {
    pub name: &'static str,
    pub url: &'static str,
    /// Of what's downloaded from `url`.
    pub sha256: &'static str,
    pub bytes: u64,
    /// A bzip2'd tar to take files from, or the file itself.
    pub archive: bool,
    /// Its licence, for About Writer (in `licenses/`).
    pub licence: &'static str,
}

/// One of the files the listener reads, as it's kept in the host's folder.
#[derive(Debug)]
pub struct ModelFile {
    /// In the host's folder.
    pub path: &'static str,
    /// The source it comes from, and its file name in that source's archive (its folder aside).
    pub source: &'static str,
    pub member: &'static str,
    pub sha256: &'static str,
    pub bytes: u64,
}

pub const SOURCES: &[Source] = &[
    Source {
        name: "parakeet",
        url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8.tar.bz2",
        sha256: "f628312e9fdf8686374cb01a69425c41732529d540860311f16f37cbc32cfe9b",
        bytes: 108_035_095,
        archive: true,
        licence: "parakeet-tdt-110m-CC-BY-4.0.md",
    },
    Source {
        name: "zipformer",
        url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2",
        sha256: "639e25b578e9e997131402199419c13a941f8e4e198e2da1ce57dbf5cf401282",
        bytes: 310_414_022,
        archive: true,
        licence: "zipformer-Apache-2.0.txt",
    },
    Source {
        name: "silero",
        url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
        sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6",
        bytes: 643_854,
        archive: false,
        licence: "silero-vad-MIT.txt",
    },
];

pub const FILES: &[ModelFile] = &[
    ModelFile { path: "parakeet/encoder.int8.onnx", source: "parakeet", member: "encoder.int8.onnx", sha256: "0f35509ddeb9b39002fb077d979a9fe74f06eb0bc4dd5c34f512f82e5111d657", bytes: 131_113_202 },
    ModelFile { path: "parakeet/decoder.int8.onnx", source: "parakeet", member: "decoder.int8.onnx", sha256: "f7c331c5504c2e593c76ed22b728e3f554af6c4a383dde862e719ced08b1da19", bytes: 3_955_863 },
    ModelFile { path: "parakeet/joiner.int8.onnx", source: "parakeet", member: "joiner.int8.onnx", sha256: "bf7dff69e9f2cdbe9943d70da358f38b361c115ba0105bae7e908e0d6ec782f6", bytes: 1_411_403 },
    ModelFile { path: "parakeet/tokens.txt", source: "parakeet", member: "tokens.txt", sha256: "450e56bd2f036fe5b6aa821865838cc5aa9d8b0106134ce9a9ba0664abe6cd10", bytes: 9_953 },
    ModelFile { path: "zipformer/encoder.int8.onnx", source: "zipformer", member: "encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx", sha256: "5022b2eca5b19d1bc104fcf33e26bc32604b7df553cd2e1f62e31dc7b05e9c87", bytes: 70_108_816 },
    ModelFile { path: "zipformer/decoder.int8.onnx", source: "zipformer", member: "decoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx", sha256: "780c63ee94c7cfa314211172e5d09b406c0da2beab5c40ea2f54cc95670b76a5", bytes: 540_688 },
    ModelFile { path: "zipformer/joiner.int8.onnx", source: "zipformer", member: "joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx", sha256: "abd5e30f3f16fc510605c6029dba33f10e4386bd75c5bdc30cf94076864db10d", bytes: 259_416 },
    ModelFile { path: "zipformer/tokens.txt", source: "zipformer", member: "tokens.txt", sha256: "49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb", bytes: 5_048 },
    ModelFile { path: "silero_vad.onnx", source: "silero", member: "", sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6", bytes: 643_854 },
];

/// The whole of the model, on disk.
pub fn installed_bytes() -> u64 {
    FILES.iter().map(|f| f.bytes).sum()
}

/// What's wrong with the model in the host's folder.
#[derive(Debug, PartialEq)]
pub enum ModelError {
    /// A file isn't there: the model hasn't been downloaded, or only partly.
    Missing(PathBuf),
    /// A file is there but isn't the one listed: cut short, or changed.
    Damaged(PathBuf),
    /// A download isn't what its source lists.
    WrongDownload(&'static str),
    Io(String),
}

impl fmt::Display for ModelError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ModelError::Missing(p) => write!(f, "the speech model isn't all there: {} is missing", p.display()),
            ModelError::Damaged(p) => write!(f, "the speech model is damaged: {} isn't as downloaded", p.display()),
            ModelError::WrongDownload(s) => write!(f, "the download of the speech model's {s} files isn't the one expected"),
            ModelError::Io(e) => write!(f, "couldn't read the speech model: {e}"),
        }
    }
}

impl std::error::Error for ModelError {}

impl From<io::Error> for ModelError {
    fn from(e: io::Error) -> Self {
        ModelError::Io(e.to_string())
    }
}

/// Whether every file is in `dir` at its size: quick, for each time the listener opens.
pub fn check(dir: &Path) -> Result<(), ModelError> {
    for file in FILES {
        let path = dir.join(file.path);
        match fs::metadata(&path) {
            Err(_) => return Err(ModelError::Missing(path)),
            Ok(m) if m.len() != file.bytes => return Err(ModelError::Damaged(path)),
            Ok(_) => {}
        }
    }
    Ok(())
}

/// Whether every file in `dir` is the one listed, by its checksum: after a download, or when a
/// file is suspect (a few hundred milliseconds for the whole model).
pub fn verify(dir: &Path) -> Result<(), ModelError> {
    check(dir)?;
    for file in FILES {
        let path = dir.join(file.path);
        if sha256(&mut File::open(&path)?)? != file.sha256 {
            return Err(ModelError::Damaged(path));
        }
    }
    Ok(())
}

fn sha256(reader: &mut impl Read) -> io::Result<String> {
    let mut hash = Sha256::new();
    io::copy(reader, &mut HashWriter(&mut hash))?;
    Ok(hash.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

struct HashWriter<'a>(&'a mut Sha256);

impl Write for HashWriter<'_> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.update(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// Install the files a source gives into `dir`, from `download` (the file saved from its `url`).
/// The download is checked against the source first, and each file against its own checksum;
/// each is written beside its place and moved there whole, so a half-written file never stands
/// where the listener looks.
pub fn install(source: &Source, download: &Path, dir: &Path) -> Result<(), ModelError> {
    install_from(source, FILES, download, dir)
}

/// `install`, with the files listed by the caller: for tests.
pub fn install_from(source: &Source, files: &[ModelFile], download: &Path, dir: &Path) -> Result<(), ModelError> {
    if fs::metadata(download)?.len() != source.bytes || sha256(&mut File::open(download)?)? != source.sha256 {
        return Err(ModelError::WrongDownload(source.name));
    }
    let wanted: Vec<&ModelFile> = files.iter().filter(|f| f.source == source.name).collect();
    if !source.archive {
        for file in &wanted {
            put(dir, file, &mut File::open(download)?)?;
        }
        return Ok(());
    }
    let mut archive = tar::Archive::new(bzip2::read::BzDecoder::new(File::open(download)?));
    let mut found = 0;
    for entry in archive.entries()? {
        let mut entry = entry?;
        let path = entry.path()?.into_owned();
        // Members are "<folder>/<file>", sometimes "./<folder>/<file>".
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
        if let Some(file) = wanted.iter().find(|f| f.member == name) {
            put(dir, file, &mut entry)?;
            found += 1;
        }
    }
    if found < wanted.len() {
        let missing = wanted.iter().find(|f| !dir.join(f.path).exists()).map(|f| dir.join(f.path)).unwrap_or_default();
        return Err(ModelError::Missing(missing));
    }
    Ok(())
}

fn put(dir: &Path, file: &ModelFile, from: &mut impl Read) -> Result<(), ModelError> {
    let path = dir.join(file.path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let partial = path.with_extension("partial");
    let mut out = File::create(&partial)?;
    let mut hash = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = from.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
        out.write_all(&buf[..n])?;
    }
    out.sync_all()?;
    drop(out);
    let digest: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if digest != file.sha256 {
        let _ = fs::remove_file(&partial);
        return Err(ModelError::Damaged(path));
    }
    fs::rename(&partial, &path)?;
    Ok(())
}
