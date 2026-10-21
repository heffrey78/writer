//! The GitHub token on Android (#52): sealed by a key in Android's keystore (the writer-android
//! plugin's cipher) and kept in a file in the app's storage, so it's never in a plain file and can't
//! be read off a backup of the storage without the device's key.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use std::path::PathBuf;

/// Seals and opens bytes, base64 both ways: Android's keystore in the app, a stand-in in tests.
pub trait Cipher: Send + Sync {
    fn seal(&self, plain: String) -> Result<String, String>;
    fn open(&self, sealed: String) -> Result<String, String>;
}

pub struct Secrets<C: Cipher> {
    file: PathBuf,
    cipher: C,
}

impl<C: Cipher> Secrets<C> {
    pub fn new(file: PathBuf, cipher: C) -> Self {
        Secrets { file, cipher }
    }

    /// The token, or None if there's none, or if what's kept can't be opened (the key went with a
    /// reinstall, say): then it's forgotten, and the writer signs in again.
    pub fn get(&self) -> Result<Option<String>, String> {
        let Some(sealed) = crate::files::read(&self.file.to_string_lossy()).map_err(|e| e.message)? else { return Ok(None) };
        let opened = self.cipher.open(BASE64.encode(sealed)).and_then(|b64| BASE64.decode(b64).map_err(|e| e.to_string())).and_then(|b| String::from_utf8(b).map_err(|e| e.to_string()));
        match opened {
            Ok(token) => Ok(Some(token)),
            Err(_) => {
                self.delete()?;
                Ok(None)
            }
        }
    }

    pub fn set(&self, token: &str) -> Result<(), String> {
        let sealed = BASE64.decode(self.cipher.seal(BASE64.encode(token))?).map_err(|e| e.to_string())?;
        crate::files::write(&self.file.to_string_lossy(), &sealed).map_err(|e| e.message)
    }

    pub fn delete(&self) -> Result<(), String> {
        crate::files::remove(&self.file.to_string_lossy()).map_err(|e| e.message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stand-in for the keystore: XOR with a key byte, and a check byte so a wrong key fails to open.
    struct Xor(u8);

    impl Cipher for Xor {
        fn seal(&self, plain: String) -> Result<String, String> {
            let mut out = vec![self.0];
            out.extend(BASE64.decode(plain).unwrap().iter().map(|b| b ^ self.0));
            Ok(BASE64.encode(out))
        }
        fn open(&self, sealed: String) -> Result<String, String> {
            let bytes = BASE64.decode(sealed).unwrap();
            if bytes.first() != Some(&self.0) {
                return Err("The key that sealed this is gone.".into());
            }
            Ok(BASE64.encode(bytes[1..].iter().map(|b| b ^ self.0).collect::<Vec<_>>()))
        }
    }

    #[test]
    fn keeps_the_token_sealed_and_gives_it_back() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("secrets/github");
        let secrets = Secrets::new(file.clone(), Xor(0x5a));
        assert_eq!(secrets.get().unwrap(), None);
        secrets.set("gho_token123").unwrap();
        let kept = std::fs::read(&file).unwrap();
        assert!(!String::from_utf8_lossy(&kept).contains("gho_token123"));
        assert_eq!(secrets.get().unwrap().as_deref(), Some("gho_token123"));
        secrets.set("gho_other").unwrap();
        assert_eq!(secrets.get().unwrap().as_deref(), Some("gho_other"));
        secrets.delete().unwrap();
        secrets.delete().unwrap();
        assert_eq!(secrets.get().unwrap(), None);
    }

    #[test]
    fn forgets_a_token_its_key_cant_open() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("github");
        Secrets::new(file.clone(), Xor(1)).set("gho_token123").unwrap();
        let after_reinstall = Secrets::new(file.clone(), Xor(2));
        assert_eq!(after_reinstall.get().unwrap(), None);
        assert!(!file.exists());
    }
}
