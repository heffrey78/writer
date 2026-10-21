//! The git port (lib.rs) for the desktop contract suite: one JSON request per line on stdin,
//! `{ id, op, dir, args }`, one answer per line on stdout, `{ id, ok }` or `{ id, err }`.

use serde_json::Value;
use std::io::{BufRead, Write};

fn main() {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let req: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
        let mut answer = git2_port::call(req["op"].as_str().unwrap_or(""), req["dir"].as_str().unwrap_or("."), &req["args"]);
        answer["id"] = req.get("id").cloned().unwrap_or(Value::Null);
        let _ = writeln!(stdout, "{answer}");
        let _ = stdout.flush();
    }
}
