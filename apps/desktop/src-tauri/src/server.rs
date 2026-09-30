//! Runs `apps/server` as a child process and relays its stdio to every window, unparsed.
//!
//! Each line the server prints is emitted as a `server://message` event; `server_send` writes one line to its stdin.
//! When the server exits, `server://exit` carries its exit code.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use tauri::{AppHandle, Emitter, State};

pub struct Server {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
}

impl Server {
    pub fn start(app: &AppHandle) -> std::io::Result<Self> {
        let mut child = command()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;
        let stdin = child.stdin.take().expect("stdin is piped");
        let stdout = child.stdout.take().expect("stdout is piped");
        let stderr = child.stderr.take().expect("stderr is piped");

        let app = app.clone();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = app.emit("server://message", line);
            }
            let _ = app.emit("server://exit", ());
        });
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                log::info!(target: "server", "{line}");
            }
        });

        Ok(Self { child: Mutex::new(child), stdin: Mutex::new(stdin) })
    }

    pub fn stop(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Development runs the workspace's server through uv; a bundled app runs the server binary next to its own.
fn command() -> Command {
    if cfg!(debug_assertions) {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
        let mut command = Command::new("uv");
        command.args(["run", "--quiet", "alpine-server"]).current_dir(root);
        command
    } else {
        let exe = std::env::current_exe().expect("the app knows its own path");
        Command::new(exe.with_file_name("alpine-server"))
    }
}

#[tauri::command]
pub fn server_send(line: String, server: State<'_, Server>) -> Result<(), String> {
    let mut stdin = server.stdin.lock().map_err(|e| e.to_string())?;
    writeln!(stdin, "{line}").and_then(|()| stdin.flush()).map_err(|e| e.to_string())
}
