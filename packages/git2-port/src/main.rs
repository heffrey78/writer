//! The git port (lib.rs) for the desktop contract suite: one JSON request per line on stdin,
//! `{ id, op, dir, args }`; for each, any number of `{ id, progress }` lines, then `{ id, ok }` or
//! `{ id, err }`. Requests run at once, each on its own thread, as the server's calls come; a `cancel`
//! request stops the transfer whose `cancel` argument it names.

use serde_json::{Value, json};
use std::io::{BufRead, Write};
use std::sync::{Arc, Mutex};

fn main() {
    let out = Arc::new(Mutex::new(std::io::stdout()));
    let send = |out: &Arc<Mutex<std::io::Stdout>>, v: Value| {
        let mut out = out.lock().unwrap();
        let _ = writeln!(out, "{v}");
        let _ = out.flush();
    };
    let mut running = vec![];
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let req: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
        let out = Arc::clone(&out);
        running.push(std::thread::spawn(move || {
            let id = req.get("id").cloned().unwrap_or(Value::Null);
            let mut progress = |p: Value| send(&out, json!({ "id": id, "progress": p }));
            let mut answer = git2_port::call_with(req["op"].as_str().unwrap_or(""), req["dir"].as_str().unwrap_or("."), &req["args"], &mut progress);
            answer["id"] = id.clone();
            send(&out, answer);
        }));
    }
    // Answers still on their way are waited for: stdin's end isn't the work's.
    for r in running {
        let _ = r.join();
    }
}
