//! Renderer configuration.
//!
//! WebKitGTK's DMA-BUF renderer negotiates GBM buffer modifiers through Mesa.
//! With the NVIDIA proprietary driver those modifiers are not accepted and
//! allocation fails with `Failed to create GBM buffer ...: Invalid argument`,
//! leaving a blank white window while the process appears healthy.
//!
//! Mesa-side workarounds (`MESA_LOADER_DRIVER_OVERRIDE`, `GBM_BACKEND`,
//! `LIBGL_ALWAYS_SOFTWARE`) do not help — the negotiation happens below them.
//! Switching off the DMA-BUF renderer does, and a markdown viewer gains
//! essentially nothing from that path: it exists for video and heavy canvas
//! compositing. So it is off by default, with an explicit opt-in.

/// Environment variable WebKitGTK honours to disable its DMA-BUF renderer.
pub const DISABLE_DMABUF_VAR: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";

/// Opt a machine in to the accelerated DMA-BUF path.
pub const ACCELERATED_FLAG: &str = "--accelerated";

/// Environment-based equivalent of [`ACCELERATED_FLAG`].
pub const ACCELERATED_VAR: &str = "DOCDECK_ACCELERATED";

/// Decides whether the DMA-BUF renderer should be switched off.
///
/// Kept free of side effects so the precedence rules can be unit tested.
pub fn should_disable_dmabuf(
    argv: &[String],
    dmabuf_var_already_set: bool,
    accelerated_var_set: bool,
) -> bool {
    // Never override an explicit choice the user already made in their shell.
    if dmabuf_var_already_set {
        return false;
    }
    if accelerated_var_set {
        return false;
    }
    !argv.iter().any(|arg| arg == ACCELERATED_FLAG)
}

/// Applies the decision to the current process.
///
/// Must run before the first window is created, because WebKitGTK latches these
/// settings while it initialises.
pub fn configure(argv: &[String]) {
    let should_disable = should_disable_dmabuf(
        argv,
        std::env::var_os(DISABLE_DMABUF_VAR).is_some(),
        std::env::var_os(ACCELERATED_VAR).is_some(),
    );

    if should_disable {
        std::env::set_var(DISABLE_DMABUF_VAR, "1");
    }
}
