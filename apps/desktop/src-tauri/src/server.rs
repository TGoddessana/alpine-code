//! Runs `apps/server` as a child process and relays its stdio to every window, unparsed.
//!
//! Each line the server prints is emitted as a `server://message` event; `server_send` writes one line to its stdin.
//! When the server exits, `server://exit` carries its exit code.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Mutex, mpsc};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State};

pub struct Server {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
}

impl Server {
    pub fn start(app: &AppHandle) -> std::io::Result<Self> {
        let mut child = command(app)?
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

/// Development runs the workspace's server through uv; a bundled app runs it on the Python runtime it carries
/// (built by `scripts/bundle_runtime.py`).
fn command(app: &AppHandle) -> std::io::Result<Command> {
    if cfg!(debug_assertions) {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
        let mut command = Command::new("uv");
        command.args(["run", "--quiet", "alpine-server"]).current_dir(root);
        return Ok(command);
    }
    let runtime = app.path().resource_dir().map_err(std::io::Error::other)?.join("runtime");
    // -I: ignore the user's PYTHON* variables and site-packages. -B: never write into the signed bundle.
    let mut command = Command::new(runtime.join("python/bin/python3.14"));
    command.args(["-I", "-B", "-m", "alpine_server"]).env("PATH", tool_path(&runtime));
    Ok(command)
}

/// An app opened from Finder gets launchd's bare PATH, without Homebrew, nvm and the like, so the agent's commands
/// would not find the user's tools. Take PATH from the user's login shell, and add the runtime's `uv` last for the
/// toolbox.
fn tool_path(runtime: &Path) -> String {
    let path = login_shell_path().or_else(|| std::env::var("PATH").ok()).unwrap_or_default();
    format!("{path}:{}", runtime.join("bin").display())
}

fn login_shell_path() -> Option<String> {
    const MARK: &str = "__ALPINE_PATH__";
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut child = Command::new(shell)
        .args(["-ilc", &format!("printf '{MARK}%s{MARK}' \"$PATH\"")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (send, receive) = mpsc::channel();
    thread::spawn(move || {
        let mut out = String::new();
        let _ = std::io::Read::read_to_string(&mut stdout, &mut out);
        let _ = send.send(out);
    });
    // A slow or interactive shell config must not hold up the app.
    let out = receive.recv_timeout(Duration::from_secs(5)).ok();
    let _ = child.kill();
    let _ = child.wait();
    let path = out?.split(MARK).nth(1)?.to_string();
    (!path.is_empty()).then_some(path)
}

#[tauri::command]
pub fn server_send(line: String, server: State<'_, Server>) -> Result<(), String> {
    let mut stdin = server.stdin.lock().map_err(|e| e.to_string())?;
    writeln!(stdin, "{line}").and_then(|()| stdin.flush()).map_err(|e| e.to_string())
}
