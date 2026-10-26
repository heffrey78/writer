//! The model's download (feature `download`), for the shells: what's missing of it in the host's
//! folder, fetched from the pinned sources `model` lists, resuming a download cut short, each source
//! installed as it comes and the whole checked at the end. The host says where, and shows progress.

use crate::model::{self, ModelError, Source};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

/// Where the model is in the host's folder.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum State {
    Ready,
    /// Not downloaded, or only partly.
    Missing,
    /// There, but not as its checksums say.
    Damaged,
}

impl State {
    pub fn of(dir: &Path) -> State {
        match model::check(dir) {
            Ok(()) => State::Ready,
            Err(ModelError::Damaged(_)) => State::Damaged,
            Err(_) => State::Missing,
        }
    }

    /// As the page says it (DEVELOPER.md, *Dictation*).
    pub fn as_str(self) -> &'static str {
        match self {
            State::Ready => "ready",
            State::Missing => "missing",
            State::Damaged => "damaged",
        }
    }
}

/// The sources whose files aren't all there at their size.
pub fn wanted(dir: &Path) -> Vec<&'static Source> {
    model::SOURCES
        .iter()
        .filter(|s| model::FILES.iter().filter(|f| f.source == s.name).any(|f| fs::metadata(dir.join(f.path)).map(|m| m.len() != f.bytes).unwrap_or(true)))
        .collect()
}

/// What's left to download into `dir`, in bytes.
pub fn left(dir: &Path) -> u64 {
    wanted(dir).iter().map(|s| s.bytes).sum()
}

/// Download what's missing of the model into `dir`, installing each source as it comes; `progress`
/// hears `(done, total)` bytes. Resumes a download cut short; refuses one that isn't what its source
/// lists. Ends with the whole model checked. Stops with "cancelled", keeping what it has, once
/// `cancel` is set.
pub fn download(dir: &Path, user_agent: &str, cancel: &AtomicBool, mut progress: impl FnMut(u64, u64)) -> Result<(), String> {
    let downloads = dir.join("downloads");
    fs::create_dir_all(&downloads).map_err(|e| e.to_string())?;
    let sources = wanted(dir);
    let total: u64 = sources.iter().map(|s| s.bytes).sum();
    let client = reqwest::blocking::Client::builder().user_agent(user_agent).build().map_err(|e| e.to_string())?;
    let mut before = 0;
    for source in sources {
        let file = downloads.join(source.url.rsplit('/').next().unwrap_or(source.name));
        fetch(&client, source.url, &file, source.bytes, cancel, |done| progress(before + done, total))?;
        model::install(source, &file, dir).map_err(|e| {
            // A download that isn't the source's is no use to resume.
            let _ = fs::remove_file(&file);
            e.to_string()
        })?;
        let _ = fs::remove_file(&file);
        before += source.bytes;
    }
    let _ = fs::remove_dir(&downloads);
    model::verify(dir).map_err(|e| e.to_string())
}

/// Download `url` into `to`, `bytes` long, going on from what's there already; `on` hears how much
/// is done. Stops, keeping what it has, when `cancel` is set.
pub fn fetch(client: &reqwest::blocking::Client, url: &str, to: &Path, bytes: u64, cancel: &AtomicBool, mut on: impl FnMut(u64)) -> Result<(), String> {
    let have = fs::metadata(to).map(|m| m.len()).unwrap_or(0);
    if have == bytes {
        on(bytes);
        return Ok(());
    }
    let mut request = client.get(url);
    if have > 0 && have < bytes {
        request = request.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let mut response = request.send().map_err(|e| format!("couldn't download the speech model: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("couldn't download the speech model: the server answered {status}"));
    }
    // A server that ignores the range sends it all again.
    let resumed = status == reqwest::StatusCode::PARTIAL_CONTENT;
    let mut out = OpenOptions::new().create(true).write(true).append(resumed).truncate(!resumed).open(to).map_err(|e| e.to_string())?;
    let mut done = if resumed { have } else { 0 };
    let mut buf = vec![0u8; 1 << 16];
    let mut told = 0;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        // A connection that closes early is an error here, or an early end: either way, what's
        // downloaded is kept for the next try.
        let n = response.read(&mut buf).unwrap_or(0);
        if n == 0 {
            break;
        }
        out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        done += n as u64;
        if done - told >= 1 << 20 || done == bytes {
            on(done);
            told = done;
        }
    }
    out.sync_all().map_err(|e| e.to_string())?;
    if done != bytes {
        return Err(format!("the download of the speech model stopped at {done} of {bytes} bytes: try again to go on from there"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::fetch;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::sync::atomic::AtomicBool;

    /// A server for `body` that honours a range, if `ranges`, and stops after `cut` bytes once.
    fn serve(body: Vec<u8>, ranges: bool, cut: Option<usize>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/model", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            let mut cut = cut;
            for stream in listener.incoming() {
                let mut stream = stream.unwrap();
                let mut from = 0;
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line.trim().is_empty() {
                        break;
                    }
                    if let Some(range) = line.to_lowercase().strip_prefix("range: bytes=") {
                        from = if ranges { range.trim().trim_end_matches('-').parse().unwrap() } else { 0 };
                    }
                }
                let part = &body[from..];
                let status = if from > 0 { "206 Partial Content" } else { "200 OK" };
                let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", part.len());
                match cut.take() {
                    Some(n) => {
                        let _ = stream.write_all(&part[..n]);
                    }
                    None => {
                        let _ = stream.write_all(part);
                    }
                }
            }
        });
        url
    }

    fn body() -> Vec<u8> {
        (0..300_000u32).map(|i| (i % 251) as u8).collect()
    }

    #[test]
    fn downloads_whole_and_tells_how_far_it_is() {
        let dir = tempfile::tempdir().unwrap();
        let to = dir.path().join("model");
        let url = serve(body(), true, None);
        let mut seen = Vec::new();
        fetch(&reqwest::blocking::Client::new(), &url, &to, 300_000, &AtomicBool::new(false), |d| seen.push(d)).unwrap();
        assert_eq!(std::fs::read(&to).unwrap(), body());
        assert_eq!(seen.last(), Some(&300_000));
    }

    #[test]
    fn a_download_cut_short_goes_on_from_where_it_stopped() {
        let dir = tempfile::tempdir().unwrap();
        let to = dir.path().join("model");
        let url = serve(body(), true, Some(100_000));
        let client = reqwest::blocking::Client::new();
        let first = fetch(&client, &url, &to, 300_000, &AtomicBool::new(false), |_| {});
        assert!(first.unwrap_err().contains("stopped at 100000 of 300000 bytes"));
        fetch(&client, &url, &to, 300_000, &AtomicBool::new(false), |_| {}).unwrap();
        assert_eq!(std::fs::read(&to).unwrap(), body());
    }

    #[test]
    fn a_server_that_ignores_ranges_is_downloaded_again_from_the_start() {
        let dir = tempfile::tempdir().unwrap();
        let to = dir.path().join("model");
        std::fs::write(&to, &body()[..50_000]).unwrap();
        let url = serve(body(), false, None);
        fetch(&reqwest::blocking::Client::new(), &url, &to, 300_000, &AtomicBool::new(false), |_| {}).unwrap();
        assert_eq!(std::fs::read(&to).unwrap(), body());
    }

    #[test]
    fn cancelling_keeps_what_was_downloaded() {
        let dir = tempfile::tempdir().unwrap();
        let to = dir.path().join("model");
        let url = serve(body(), true, None);
        let error = fetch(&reqwest::blocking::Client::new(), &url, &to, 300_000, &AtomicBool::new(true), |_| {}).unwrap_err();
        assert_eq!(error, "cancelled");
    }
}
