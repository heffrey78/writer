//! The Android app's way of trusting the device's certificates (git2_port::trust_certificates_in),
//! run over this machine's folder: every certificate parsed in memory and added to libgit2, and an
//! https remote still reached. Here libgit2 also finds the system's certificates by itself, so this
//! can't show that the added ones alone suffice; the phone (spike/d16/android) shows that.
//! Needs the network: `cargo test --release -- --ignored`.

#[test]
#[ignore]
fn the_certificates_in_a_folder_are_added_in_memory_and_https_still_works() {
    let r = git2_port::trust_certificates_in(&["/nonexistent", "/etc/ssl/certs"]).expect("trusted");
    assert!(r["certificates"].as_u64().unwrap() > 50, "{r}");
    assert_eq!(r["from"], serde_json::json!(["/etc/ssl/certs"]));
    let mut remote = git2::Remote::create_detached("https://github.com/octocat/Hello-World.git").unwrap();
    remote.connect(git2::Direction::Fetch).expect("reached over https");
    assert!(!remote.list().unwrap().is_empty());
}
