//! Leave the launching terminal's session so closing that terminal or exiting
//! the shell does not send docdeck a `SIGHUP`.
//!
//! Zed's CLI uses the same sequence (`boot_background` in `crates/cli/src/main.rs`):
//! fork, call `setsid()` in the child, and detach stdio before continuing.
//! Release builds detach only when started from a terminal; debug builds and
//! `DOCDECK_FOREGROUND=1` stay attached so `tauri dev` and Ctrl-C work normally.

pub const FOREGROUND_ENV: &str = "DOCDECK_FOREGROUND";

pub fn detach_from_terminal() {
    if !should_detach(
        cfg!(debug_assertions),
        std::env::var_os(FOREGROUND_ENV).is_some(),
        terminal_attached(),
    ) {
        return;
    }

    #[cfg(unix)]
    unsafe {
        match libc::fork() {
            -1 => eprintln!(
                "[docdeck] could not fork to detach from the terminal: {}",
                std::io::Error::last_os_error()
            ),
            0 => {
                if libc::setsid() == -1 {
                    eprintln!(
                        "[docdeck] could not setsid, ignoring SIGHUP instead: {}",
                        std::io::Error::last_os_error()
                    );
                    libc::signal(libc::SIGHUP, libc::SIG_IGN);
                }
                if let Err(err) = redirect_stdio_to_devnull() {
                    eprintln!("[docdeck] could not detach stdio: {err}");
                }
            }
            _ => std::process::exit(0),
        }
    }
}

fn should_detach(debug_build: bool, foreground_env: bool, terminal_attached: bool) -> bool {
    !debug_build && !foreground_env && terminal_attached
}

#[cfg(unix)]
fn terminal_attached() -> bool {
    unsafe { libc::isatty(libc::STDIN_FILENO) == 1 || libc::isatty(libc::STDERR_FILENO) == 1 }
}

#[cfg(not(unix))]
fn terminal_attached() -> bool {
    false
}

#[cfg(unix)]
fn redirect_stdio_to_devnull() -> std::io::Result<()> {
    use std::os::fd::AsRawFd;

    let devnull = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open("/dev/null")?;
    for fd in [libc::STDIN_FILENO, libc::STDOUT_FILENO, libc::STDERR_FILENO] {
        if unsafe { libc::dup2(devnull.as_raw_fd(), fd) } == -1 {
            return Err(std::io::Error::last_os_error());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::should_detach;

    #[test]
    fn detaches_only_release_builds_from_a_terminal() {
        assert!(should_detach(false, false, true));
        assert!(!should_detach(true, false, true));
        assert!(!should_detach(false, true, true));
        assert!(!should_detach(false, false, false));
    }
}
