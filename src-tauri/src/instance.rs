//! Per-user runtime instance record.
//!
//! The record lets the installer identify the running app, recover the launch
//! arguments and working directory, and stop it through the `--quit` control
//! flag. It is metadata about the process, never document content, and lives
//! outside the watch configuration so the read-only guarantees for documents
//! and preferences stay intact.

use std::env;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// Current record schema version. Unknown versions are rejected by readers.
pub const RECORD_VERSION: u32 = 1;

/// Upper bound for a record, matching the installer contract.
pub const MAX_RECORD_BYTES: u64 = 64 * 1024;

/// Lifecycle control flag. It must never be classified as a document or folder.
pub const QUIT_FLAG: &str = "--quit";

/// The app's published description of its running process.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstanceRecord {
    pub version: u32,
    pub pid: u32,
    pub exe: String,
    pub argv: Vec<String>,
    pub cwd: String,
    #[serde(rename = "startedAt")]
    pub started_at: i64,
}

/// Whether the command line asks a running instance to exit.
pub fn wants_quit(args: &[String]) -> bool {
    args.iter().skip(1).any(|arg| arg == QUIT_FLAG)
}

/// Resolves the record path from already-read environment values.
///
/// Precedence matches the installer: a non-empty `XDG_RUNTIME_DIR`, then
/// `HOME` (`.local/state`), then `LOCALAPPDATA` for Windows installations that
/// do not set a home directory.
pub fn resolve_record_path(
    xdg_runtime_dir: Option<&Path>,
    home: Option<&Path>,
    local_app_data: Option<&Path>,
) -> Option<PathBuf> {
    let base = if let Some(dir) = non_empty(xdg_runtime_dir) {
        dir.join("docdeck")
    } else if let Some(home) = non_empty(home) {
        home.join(".local").join("state").join("docdeck")
    } else {
        let dir = non_empty(local_app_data)?;
        dir.join("docdeck")
    };
    Some(base.join("instance.json"))
}

/// Resolves the record path for the current process environment.
pub fn record_path() -> Option<PathBuf> {
    let xdg_runtime_dir = env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from);
    let home = env::var_os("HOME").map(PathBuf::from);
    let local_app_data = env::var_os("LOCALAPPDATA").map(PathBuf::from);
    resolve_record_path(
        xdg_runtime_dir.as_deref(),
        home.as_deref(),
        local_app_data.as_deref(),
    )
}

fn non_empty(path: Option<&Path>) -> Option<&Path> {
    path.filter(|path| !path.as_os_str().is_empty())
}

/// Captures this process's metadata. Returns `None` only when the executable or
/// working directory cannot be determined.
pub fn capture() -> Option<InstanceRecord> {
    let exe = env::current_exe().ok()?;
    let cwd = env::current_dir().ok()?;
    let argv: Vec<String> = env::args_os()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();

    Some(InstanceRecord {
        version: RECORD_VERSION,
        pid: std::process::id(),
        exe: exe.to_string_lossy().into_owned(),
        argv,
        cwd: cwd.to_string_lossy().into_owned(),
        started_at: now_millis(),
    })
}

/// Reads, bounds, parses, and validates a record.
pub fn read_record(path: &Path) -> Result<InstanceRecord, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("cannot stat {}: {error}", path.display()))?;
    if metadata.len() > MAX_RECORD_BYTES {
        return Err(format!(
            "instance record {} exceeds {MAX_RECORD_BYTES} bytes",
            path.display()
        ));
    }

    let bytes = fs::read(path)
        .map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    if bytes.len() as u64 > MAX_RECORD_BYTES {
        return Err(format!(
            "instance record {} exceeds {MAX_RECORD_BYTES} bytes",
            path.display()
        ));
    }

    let record: InstanceRecord = serde_json::from_slice(&bytes)
        .map_err(|error| format!("cannot parse {}: {error}", path.display()))?;
    validate_record(&record)?;
    Ok(record)
}

/// Checks every field the installer relies on. It deliberately does not check
/// liveness, ownership, or executable identity; those need the process table.
pub fn validate_record(record: &InstanceRecord) -> Result<(), String> {
    if record.version != RECORD_VERSION {
        return Err(format!("unsupported instance record version {}", record.version));
    }
    if record.pid == 0 {
        return Err("instance record has pid 0".to_string());
    }
    if record.exe.is_empty() || !Path::new(&record.exe).is_absolute() {
        return Err("instance record has a non-absolute executable path".to_string());
    }
    if record.cwd.is_empty() || !Path::new(&record.cwd).is_absolute() {
        return Err("instance record has a non-absolute working directory".to_string());
    }
    if record.argv.is_empty() {
        return Err("instance record has an empty argument vector".to_string());
    }
    Ok(())
}

/// Writes the record atomically with `0600` permissions inside a `0700`
/// directory. A partially written record is never observable.
pub fn write_record(record: &InstanceRecord, path: &Path) -> io::Result<()> {
    validate_record(record).map_err(io::Error::other)?;

    let directory = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "record path has no parent"))?;
    create_private_directory(directory)?;

    let bytes = serde_json::to_vec(record).map_err(io::Error::other)?;
    if bytes.len() as u64 > MAX_RECORD_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "instance record exceeds 64 KiB",
        ));
    }

    let temporary = directory.join(format!(
        ".instance.{}.{}.tmp",
        std::process::id(),
        now_millis()
    ));

    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    let mut file = options.open(&temporary)?;
    if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    drop(file);

    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

/// Removes the record only when it still describes `pid`. An exiting old
/// instance must never delete a successor's record.
pub fn remove_record_if_owned(path: &Path, pid: u32) -> io::Result<bool> {
    match read_record(path) {
        Ok(record) if record.pid == pid => match fs::remove_file(path) {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error),
        },
        Ok(_) => Ok(false),
        Err(_) => Ok(false),
    }
}

/// Removes a record file unconditionally, for stale-record recovery.
pub fn remove_record_file(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

/// Whether a process is alive. `EPERM` means it exists but belongs to another
/// user; the installer does not target those, but they are alive.
#[cfg(unix)]
pub fn is_process_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    if result == 0 {
        return true;
    }
    io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(unix))]
pub fn is_process_alive(pid: u32) -> bool {
    pid > 0
}

fn create_private_directory(directory: &Path) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(directory)
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}
