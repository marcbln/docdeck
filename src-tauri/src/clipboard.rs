//! File-reference clipboard support.
//!
//! Copying a file for pasting into a file manager or an upload control means
//! writing a `text/uri-list` entry, not plain text. WebKitGTK cannot set that
//! target through the async Clipboard API, so the write happens in Rust.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

/// Copies `path` as a file reference for the OS clipboard.
///
/// The path is canonicalized first so a relative or symlinked argument still
/// yields a `file://` URI that the receiving application can resolve.
#[tauri::command]
pub fn copy_file_reference(path: String) -> Result<(), String> {
    let canonical = Path::new(&path)
        .canonicalize()
        .map_err(|error| format!("cannot resolve path: {error}"))?;

    write_file_reference(&canonical)
}

/// Builds a `file://` URI from a path.
///
/// Characters outside the URI unreserved set are percent-encoded; `/` stays
/// literal so the hierarchy survives. On Unix a leading `/` therefore produces
/// the usual `file:///home/...` form.
pub fn file_uri(path: &Path) -> String {
    #[cfg(windows)]
    {
        let raw = path.to_string_lossy().replace('\\', "/");
        let raw = raw.strip_prefix("//?/").unwrap_or(&raw);
        format!("file:///{}", encode_path(raw))
    }
    #[cfg(not(windows))]
    {
        format!("file://{}", encode_path(&path.to_string_lossy()))
    }
}

/// Percent-encodes everything except RFC 3986 unreserved characters and `/`.
pub(crate) fn encode_path(raw: &str) -> String {
    use std::fmt::Write as _;

    let mut encoded = String::with_capacity(raw.len());
    for byte in raw.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
                encoded.push(byte as char);
            }
            _ => {
                // Writing to a `String` cannot fail.
                let _ = write!(encoded, "%{byte:02X}");
            }
        }
    }
    encoded
}

#[cfg(all(unix, not(target_os = "macos")))]
fn write_file_reference(path: &Path) -> Result<(), String> {
    let uri = file_uri(path);
    let xclip: (&str, &[&str]) = (
        "xclip",
        &["-selection", "clipboard", "-t", "text/uri-list"],
    );
    let wl_copy: (&str, &[&str]) = ("wl-copy", &["--type", "text/uri-list"]);

    // Prefer the tool that matches the running display server, but fall back to
    // the other one: `wl-copy` can be installed on an X11 session and vice
    // versa, and a broken first choice must not hide a working second one.
    let candidates = if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        [wl_copy, xclip]
    } else {
        [xclip, wl_copy]
    };

    let mut failures = Vec::new();
    for (program, args) in candidates {
        match run_filter(program, args, &uri) {
            Ok(()) => return Ok(()),
            Err(error) => failures.push(error),
        }
    }

    Err(format!(
        "no working clipboard tool; install xclip or wl-clipboard ({})",
        failures.join("; ")
    ))
}

#[cfg(target_os = "macos")]
fn write_file_reference(path: &Path) -> Result<(), String> {
    let path = path.to_string_lossy();
    run_filter(
        "osascript",
        &[
            "-e",
            "on run argv",
            "-e",
            "set the clipboard to (POSIX file (item 1 of argv))",
            "-e",
            "end run",
            path.as_ref(),
        ],
        "",
    )
}

#[cfg(windows)]
fn write_file_reference(path: &Path) -> Result<(), String> {
    let escaped = path.to_string_lossy().replace('\'', "''");
    let script = format!("Set-Clipboard -Path '{escaped}'");
    run_filter(
        "powershell",
        &["-NoProfile", "-NonInteractive", "-Command", &script],
        "",
    )
}

/// Feeds `input` to `program` on stdin and fails on a non-zero exit.
fn run_filter(program: &str, args: &[&str], input: &str) -> Result<(), String> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("{program}: {error}"))?;

    let written = child
        .stdin
        .take()
        .ok_or_else(|| format!("{program}: stdin unavailable"))
        .and_then(|mut stdin| {
            stdin
                .write_all(input.as_bytes())
                .map_err(|error| format!("{program}: {error}"))
        });
    if let Err(error) = written {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("{program}: {error}"))?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let detail = stderr.trim();
    if detail.is_empty() {
        Err(format!("{program} exited with {}", output.status))
    } else {
        Err(format!("{program}: {detail}"))
    }
}
