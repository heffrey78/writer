//! The model's files: missing, damaged, and installed from a download.

use dictation::model::{self, ModelError, ModelFile, Source};
use dictation::{Error, Listener, Options};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

fn models() -> PathBuf {
    let dir = std::env::var_os("DICTATION_MODELS").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models"));
    assert!(dir.join("silero_vad.onnx").exists(), "no speech model in {}: run fetch-models.sh", dir.display());
    dir
}

/// The model in a folder of its own: hard links, so nothing is copied.
fn copy_of_model() -> tempfile::TempDir {
    let copy = tempfile::tempdir().unwrap();
    for file in model::FILES {
        let to = copy.path().join(file.path);
        fs::create_dir_all(to.parent().unwrap()).unwrap();
        fs::hard_link(models().join(file.path), &to).or_else(|_| fs::copy(models().join(file.path), &to).map(|_| ())).unwrap();
    }
    copy
}

#[test]
fn the_installed_model_is_whole() {
    model::verify(&models()).unwrap();
    assert_eq!(model::installed_bytes(), 208_048_243);
}

#[test]
fn a_missing_file_is_named_and_the_listener_does_not_open() {
    let copy = copy_of_model();
    let gone = copy.path().join("parakeet/joiner.int8.onnx");
    fs::remove_file(&gone).unwrap();
    assert_eq!(model::check(copy.path()), Err(ModelError::Missing(gone.clone())));
    let error = Listener::open(copy.path(), &Options::default()).err().unwrap();
    assert_eq!(error, Error::Model(ModelError::Missing(gone.clone())));
    assert_eq!(error.to_string(), format!("the speech model isn't all there: {} is missing", gone.display()));
}

#[test]
fn a_file_cut_short_or_changed_is_damaged() {
    let copy = copy_of_model();
    // Cut short: a new file in the link's place, so the original isn't touched.
    let tokens = copy.path().join("zipformer/tokens.txt");
    let whole = fs::read(&tokens).unwrap();
    fs::remove_file(&tokens).unwrap();
    fs::write(&tokens, &whole[..whole.len() / 2]).unwrap();
    assert_eq!(model::check(copy.path()), Err(ModelError::Damaged(tokens.clone())));
    // Changed, at the same length: only the checksum finds it.
    let mut changed = whole.clone();
    changed[0] ^= 1;
    fs::write(&tokens, &changed).unwrap();
    assert_eq!(model::check(copy.path()), Ok(()));
    assert_eq!(model::verify(copy.path()), Err(ModelError::Damaged(tokens)));
}

/// A source made here: a bzip2'd tar with a file in a folder, and what it's listed as.
fn archive(dir: &Path, content: &[u8]) -> (PathBuf, String, u64) {
    let path = dir.join("source.tar.bz2");
    let mut tar = tar::Builder::new(bzip2::write::BzEncoder::new(fs::File::create(&path).unwrap(), bzip2::Compression::fast()));
    let mut header = tar::Header::new_gnu();
    header.set_size(content.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    tar.append_data(&mut header, "./some-model/model.onnx", content).unwrap();
    tar.into_inner().unwrap().finish().unwrap().flush().unwrap();
    let bytes = fs::read(&path).unwrap();
    (path, sha256(&bytes), bytes.len() as u64)
}

fn sha256(bytes: &[u8]) -> String {
    use sha2::Digest;
    sha2::Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn leak(s: String) -> &'static str {
    Box::leak(s.into_boxed_str())
}

#[test]
fn install_takes_the_listed_files_from_a_download_checked_against_its_source() {
    let work = tempfile::tempdir().unwrap();
    let content = b"the model's weights";
    let (download, digest, bytes) = archive(work.path(), content);
    let source = Source { name: "test", url: "https://example.invalid/source.tar.bz2", sha256: leak(digest), bytes, archive: true, licence: "" };
    let files = [ModelFile { path: "test/model.onnx", source: "test", member: "model.onnx", sha256: leak(sha256(content)), bytes: content.len() as u64 }];
    let dir = work.path().join("models");
    model::install_from(&source, &files, &download, &dir).unwrap();
    assert_eq!(fs::read(dir.join("test/model.onnx")).unwrap(), content);
    // Nothing half-written is left beside it.
    assert_eq!(fs::read_dir(dir.join("test")).unwrap().count(), 1);

    // A download that isn't the source's is refused, and nothing is installed from it.
    let other = Source { sha256: "0".repeat(64).leak(), ..source };
    let elsewhere = work.path().join("elsewhere");
    assert_eq!(model::install_from(&other, &files, &download, &elsewhere), Err(ModelError::WrongDownload("test")));
    assert!(!elsewhere.exists());

    // A file in the archive that isn't the one listed is refused, and not left in place.
    let wrong = [ModelFile { sha256: leak(sha256(b"something else")), ..files[0] }];
    let third = work.path().join("third");
    let source = Source { name: "test", url: "", sha256: other.sha256, bytes: other.bytes, archive: true, licence: "" };
    let source = Source { sha256: leak(sha256(&fs::read(&download).unwrap())), ..source };
    assert_eq!(model::install_from(&source, &wrong, &download, &third), Err(ModelError::Damaged(third.join("test/model.onnx"))));
    assert!(!third.join("test/model.onnx").exists());
    assert!(!third.join("test/model.partial").exists());
}

#[test]
fn each_source_has_its_licence_for_about_writer() {
    let licenses = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("licenses");
    for source in model::SOURCES {
        assert!(licenses.join(source.licence).exists(), "{} has no licence in licenses/", source.name);
    }
    // And the engine's own, which the shells link.
    for engine in ["sherpa-onnx-Apache-2.0.txt", "onnxruntime-MIT.txt"] {
        assert!(licenses.join(engine).exists(), "{engine}");
    }
}
