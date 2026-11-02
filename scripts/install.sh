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
#
# Environment:
#   PREFIX   install prefix (default: ~/.local/bin)

set -euo pipefail

MODE="copy"
BUILD=1
DESKTOP=1
MAKE_DEFAULT=0
PREFIX="${PREFIX:-$HOME/.local/bin}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --symlink)  MODE="symlink" ;;
    --copy)     MODE="copy" ;;
    --no-build) BUILD=0 ;;
    --no-desktop) DESKTOP=0 ;;
    --default)  MAKE_DEFAULT=1 ;;
    --prefix)   shift; PREFIX="$1" ;;
    --prefix=*) PREFIX="${1#*=}" ;;
    -h|--help)  sed -n '3,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)          printf 'unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

cd "$(dirname "$0")/.."

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
  if [[ -f src-tauri/icons/128x128@2x.png ]]; then
    mkdir -p "$ICON_HOME/256x256/apps"
    install -m 0644 src-tauri/icons/128x128@2x.png "$ICON_HOME/256x256/apps/docdeck.png"
  fi
  if [[ -f src-tauri/icons/128x128.png ]]; then
    mkdir -p "$ICON_HOME/128x128/apps"
    install -m 0644 src-tauri/icons/128x128.png "$ICON_HOME/128x128/apps/docdeck.png"
  fi

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

# Read the version from the manifest — the binary has no --version flag and
# invoking it would open a window.
APP_VERSION="$(sed -n 's/^version = "\(.*\)"/\1/p' src-tauri/Cargo.toml | head -1)"
printf '\ndocdeck %s installed. Run `%s README.md`\n' "${APP_VERSION:-unknown}" "$APP_NAME"