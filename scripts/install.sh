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
#   ./scripts/install.sh --no-build   # reinstall an existing release binary
#
# Environment:
#   PREFIX   install prefix (default: ~/.local/bin)

set -euo pipefail

MODE="copy"
BUILD=1
PREFIX="${PREFIX:-$HOME/.local/bin}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --symlink)  MODE="symlink" ;;
    --copy)     MODE="copy" ;;
    --no-build) BUILD=0 ;;
    --prefix)   shift; PREFIX="$1" ;;
    --prefix=*) PREFIX="${1#*=}" ;;
    -h|--help)  sed -n '3,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)          printf 'unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

cd "$(dirname "$0")/.."

APP_NAME="docdeck"
BIN_SRC="src-tauri/target/release/$APP_NAME"

command -v npm >/dev/null || { printf 'error: npm not found\n' >&2; exit 1; }
command -v cargo >/dev/null || { printf 'error: cargo not found\n' >&2; exit 1; }

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

# Read the version from the manifest — the binary has no --version flag and
# invoking it would open a window.
APP_VERSION="$(sed -n 's/^version = "\(.*\)"/\1/p' src-tauri/Cargo.toml | head -1)"
printf '\ndocdeck %s installed. Run `%s README.md`\n' "${APP_VERSION:-unknown}" "$APP_NAME"