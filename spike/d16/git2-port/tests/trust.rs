//! The Android app's way of trusting the device's certificates, tried on this machine's: the folder
//! gathered into one file, and an https remote reached through libgit2 with only that file trusted.
//! Needs the network: `cargo test --release -- --ignored`.

#[test]
#[ignore]
fn an_https_remote_is_reached_trusting_only_the_gathered_certificates() {
    let out = std::env::temp_dir().join(format!("d16-trust-{}.pem", std::process::id()));
    let r = git2_port::trust_certificates_in(&["/nonexistent", "/etc/ssl/certs"], &out).expect("gathered");
    assert!(r["certificates"].as_u64().unwrap() > 50, "{r}");
    assert_eq!(r["from"], serde_json::json!(["/etc/ssl/certs"]));
    let mut remote = git2::Remote::create_detached("https://github.com/octocat/Hello-World.git").unwrap();
    remote.connect(git2::Direction::Fetch).expect("connected over https");
    assert!(!remote.list().unwrap().is_empty());
    let _ = std::fs::remove_file(out);
}
