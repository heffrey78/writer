// Vosk's crate links libvosk.so, which fetch-models.sh puts in ../lib: found there at build and at run.
fn main() {
    // sherpa-onnx's shared libraries are copied beside the binary.
    if std::env::var_os("CARGO_FEATURE_SHERPA_SHARED").is_some() {
        println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN");
    }
    if std::env::var_os("CARGO_FEATURE_VOSK").is_some() {
        let lib = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../lib").canonicalize().expect("run fetch-models.sh first");
        println!("cargo:rustc-link-search=native={}", lib.display());
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", lib.display());
    }
}
