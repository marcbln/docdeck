#!/usr/bin/env bash
#
# Build docdeck in release mode and install it into a directory on your PATH.
#
# Runs `tauri build --no-bundle`, so it compiles the frontend (tsc + vite) and
# the Rust binary but skips the platform-specific bundling (AppImage/.deb/.msi).
# The result is a single self-contained executable — which is what you want for
# a private project you run straight from your shell.
#
# Usage:
#   ./scripts/install.sh              # install to ~/.local/bin
#   ./scripts/install.sh --prefix DIR # install elsewhere (e.g. /usr/local/bin)
#   ./scripts/install.sh --symlink    # symlink instead of copying (live rebuilds)
#   ./scripts/install.sh --no-build   # reinstall a binary from `npm run tauri build`
#   ./scripts/install.sh --no-desktop # skip the Markdown desktop association (Linux)
#   ./scripts/install.sh --default    # also make docdeck the default Markdown handler
#   ./scripts/install.sh --restart    # restart a running installed instance without prompting
#   ./scripts/install.sh --no-restart # never signal a running instance
#   ./scripts/install.sh -n           # never prompt; print manual-restart guidance
#
# After a successful build and install, a running docdeck instance is detected
# through its runtime record. On a terminal the installer asks before stopping
# it; without a terminal it never blocks and prints how to restart manually.
#
# Environment:
#   PREFIX   install prefix (default: ~/.local/bin)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# shellcheck source=lib/restart.sh
source "$SCRIPT_DIR/lib/restart.sh"

usage() {
  sed -n '/^# Build docdeck/,/^#   PREFIX/p' "$0" | sed 's/^# \{0,1\}//'
}

MODE="copy"
BUILD=1
DESKTOP=1
MAKE_DEFAULT=0
RESTART_FORCE=0
RESTART_FORBID=0
NO_INTERACTION=0
PREFIX="${PREFIX:-$HOME/.local/bin}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --symlink)  MODE="symlink" ;;
    --copy)     MODE="copy" ;;
    --no-build) BUILD=0 ;;
    --no-desktop) DESKTOP=0 ;;
    --default)  MAKE_DEFAULT=1 ;;
    --restart)  RESTART_FORCE=1 ;;
    --no-restart) RESTART_FORBID=1 ;;
    -n|--no-interaction) NO_INTERACTION=1 ;;
    --prefix)   shift; PREFIX="$1" ;;
    --prefix=*) PREFIX="${1#*=}" ;;
    -h|--help)  usage; exit 0 ;;
    *)          printf 'unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

if [[ $RESTART_FORCE -eq 1 && $RESTART_FORBID -eq 1 ]]; then
  printf 'error: --restart and --no-restart are mutually exclusive\n' >&2
  exit 2
fi

if [[ $RESTART_FORCE -eq 1 ]]; then
  RESTART_CHOICE="restart"
elif [[ $RESTART_FORBID -eq 1 ]]; then
  RESTART_CHOICE="decline"
else
  RESTART_CHOICE="auto"
fi
RESTART_NO_INTERACTION="$NO_INTERACTION"

cd "$SCRIPT_DIR/.."

APP_NAME="docdeck"
BIN_SRC="src-tauri/target/release/$APP_NAME"

command -v npm >/dev/null || { printf 'error: npm not found\n' >&2; exit 1; }
command -v cargo >/dev/null || { printf 'error: cargo not found\n' >&2; exit 1; }

# `tauri` is a devDependency, so `npm run tauri` only works once node_modules
# exists. Install on demand instead of failing with "tauri: command not found".
if [[ ! -x node_modules/.bin/tauri ]]; then
  printf '==> Installing npm dependencies...\n'
  npm install
fi

if [[ $BUILD -eq 1 ]]; then
  printf '==> Building %s (release)...\n' "$APP_NAME"
  npm run tauri build -- --no-bundle
else
  printf '==> Skipping build, reusing existing release binary\n'
fi

[[ -x "$BIN_SRC" ]] || {
  printf 'error: %s not found — run without --no-build\n' "$BIN_SRC" >&2
  exit 1
}

mkdir -p "$PREFIX"
BIN_DST="$PREFIX/$APP_NAME"

# `install(1)` replaces a symlink with a real file atomically, so a previous
# symlink-based install does not turn into a symlink-to-a-symlink.
if [[ "$MODE" == "symlink" ]]; then
  rm -f "$BIN_DST"
  ln -s "$(readlink -f "$BIN_SRC")" "$BIN_DST"
  printf '==> Symlinked %s -> %s\n' "$BIN_DST" "$(readlink -f "$BIN_SRC")"
else
  install -m 0755 "$BIN_SRC" "$BIN_DST.tmp"
  mv -f "$BIN_DST.tmp" "$BIN_DST"
  printf '==> Installed %s\n' "$BIN_DST"
fi

BIN_DST_ABS="$(cd "$(dirname "$BIN_DST")" && pwd)/$(basename "$BIN_DST")"

case ":$PATH:" in
  *":$PREFIX:"*) ;;
  *)
    printf '\nwarning: %s is not in your PATH. Add this to ~/.zshrc:\n' "$PREFIX"
    printf '  export PATH="%s:$PATH"\n' "$PREFIX"
    ;;
esac

# Register docdeck as an "Open With" handler for Markdown files. The entry goes
# into the per-user data directory, so this works without root even when the
# binary itself was installed to /usr/local/bin.
if [[ $DESKTOP -eq 1 && "$(uname -s)" == "Linux" ]]; then
  DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
  APPS_DIR="$DATA_HOME/applications"
  ICON_HOME="$DATA_HOME/icons/hicolor"

  BIN_EXEC="$(cd "$(dirname "$BIN_DST")" && pwd)/$(basename "$BIN_DST")"

  mkdir -p "$APPS_DIR"
  install_icon() {
    local size="$1" source="$2"
    [[ -f "$source" ]] || return 0
    mkdir -p "$ICON_HOME/${size}x${size}/apps"
    install -m 0644 "$source" "$ICON_HOME/${size}x${size}/apps/docdeck.png"
  }
  install_icon 32 src-tauri/icons/32x32.png
  install_icon 128 src-tauri/icons/128x128.png
  install_icon 256 src-tauri/icons/128x128@2x.png
  install_icon 512 src-tauri/icons/icon.png

  DESKTOP_FILE="$APPS_DIR/docdeck.desktop"
  cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=docdeck
Comment=Tabbed Markdown viewer with live reload
Exec="$BIN_EXEC" %F
Icon=docdeck
Terminal=false
Categories=Utility;TextEditor;
MimeType=text/markdown;text/x-markdown;
StartupNotify=true
EOF
  chmod 0644 "$DESKTOP_FILE"

  # Rebuild the caches. Without this a desktop keeps using a stale icon theme
  # cache (generic icon) and may not notice the new desktop entry.
  command -v gtk-update-icon-cache >/dev/null &&
    gtk-update-icon-cache -f -t "$ICON_HOME" >/dev/null 2>&1 || true
  if command -v kbuildsycoca6 >/dev/null; then
    kbuildsycoca6 >/dev/null 2>&1 || true
  elif command -v kbuildsycoca5 >/dev/null; then
    kbuildsycoca5 >/dev/null 2>&1 || true
  fi

  command -v update-desktop-database >/dev/null &&
    update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
  printf '==> Registered Markdown handler: %s\n' "$DESKTOP_FILE"

  if [[ $MAKE_DEFAULT -eq 1 ]]; then
    if command -v xdg-mime >/dev/null; then
      xdg-mime default docdeck.desktop text/markdown text/x-markdown
      printf '==> Set docdeck as the default Markdown handler\n'
    else
      printf 'warning: xdg-mime not found; pick the default in your file manager\n' >&2
    fi
  fi
fi

# Only touch a running process after both the build and the install succeeded.
if ! restart_after_install "$BIN_DST_ABS" "$MODE"; then
  exit 1
fi

# Read the version from the manifest — the binary has no --version flag and
# invoking it would open a window.
APP_VERSION="$(sed -n 's/^version = "\(.*\)"/\1/p' src-tauri/Cargo.toml | head -1)"
printf '\ndocdeck %s installed. Run `%s README.md`\n' "${APP_VERSION:-unknown}" "$APP_NAME"