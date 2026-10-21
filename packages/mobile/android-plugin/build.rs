// The plugin's Android library (android/), for tauri-build to put in the app's Gradle project.
fn main() {
    let dir = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("android");
    println!("cargo:android_library_path={}", dir.display());
    println!("cargo:rerun-if-changed=android");
}
