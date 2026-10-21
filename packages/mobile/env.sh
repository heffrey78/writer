# The Android build's tools (#52): Unity's Android SDK, NDK and JDK (read only, from the row_vr
# project's Unity install), and Rust with the Android targets from its own rustup folder. Nothing
# here changes the system's Rust or PATH outside the shell that sources it.
UNITY_ANDROID="${UNITY_ANDROID:-$HOME/Unity/Hub/Editor/6000.6.2f1/Editor/Data/PlaybackEngines/AndroidPlayer}"
export ANDROID_HOME="$UNITY_ANDROID/SDK"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export NDK_HOME="$UNITY_ANDROID/NDK"
export JAVA_HOME="$UNITY_ANDROID/OpenJDK"
export RUSTUP_HOME="$HOME/.local/share/writer-rust/rustup"
export CARGO_HOME="$HOME/.local/share/writer-rust/cargo"
export PATH="$CARGO_HOME/bin:$JAVA_HOME/bin:$PATH"
