#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOURCES_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
USER_ROOT="${ZOO_USER_ROOT:-$HOME/Library/Application Support/UrsaLabs/Zoo}"
LOG_DIR="${ZOO_LOG_DIR:-$HOME/Library/Logs/UrsaLabs/Zoo}"
CONFIG_DIR="${ZOO_CONFIG_DIR:-$USER_ROOT/configs}"
RUNTIME_DIR="$USER_ROOT/runtime"
RUNTIME_MARKER="$RUNTIME_DIR/runtime-installed.txt"
RUNTIME_PYTHON="$RUNTIME_DIR/venv/bin/python"
TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
WORK_DIR="${TMPDIR:-/tmp}/Zoo-Diagnostics-$TIMESTAMP"
OUTPUT_ZIP="$HOME/Desktop/Zoo-Diagnostics-$TIMESTAMP.zip"

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

if [[ -f "$RESOURCES_DIR/build-info.json" ]]; then
  cp "$RESOURCES_DIR/build-info.json" "$WORK_DIR/build-info.json"
fi
if [[ -d "$CONFIG_DIR" ]]; then
  cp -R "$CONFIG_DIR" "$WORK_DIR/configs"
fi
if [[ -d "$LOG_DIR" ]]; then
  cp -R "$LOG_DIR" "$WORK_DIR/logs"
fi

RUNTIME_REPORT="$WORK_DIR/runtime.txt"
{
  printf 'Generated: %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  printf 'ResourcesDir: %s\n' "$RESOURCES_DIR"
  printf 'UserRoot: %s\n' "$USER_ROOT"
  printf 'ConfigDir: %s\n' "$CONFIG_DIR"
  printf 'LogDir: %s\n' "$LOG_DIR"
} > "$RUNTIME_REPORT"

if [[ -f "$RUNTIME_MARKER" ]]; then
  {
    printf '\nruntime-installed.txt\n'
    cat "$RUNTIME_MARKER"
  } >> "$RUNTIME_REPORT"
fi

if [[ -x "$RUNTIME_PYTHON" ]]; then
  {
    printf '\npython --version\n'
    "$RUNTIME_PYTHON" --version 2>&1 || true
    printf '\npip freeze\n'
    "$RUNTIME_PYTHON" -m pip freeze 2>&1 || true
    printf '\nimport check\n'
    "$RUNTIME_PYTHON" -c "import sys, zoo, gantry, deck, protocol_engine; print(sys.executable); print(zoo.__file__); print(gantry.__file__)" 2>&1 || true
  } >> "$RUNTIME_REPORT"
else
  printf '\nRuntime virtual environment python not found at %s\n' "$RUNTIME_PYTHON" >> "$RUNTIME_REPORT"
fi

rm -f "$OUTPUT_ZIP"
(cd "$WORK_DIR" && zip -qr "$OUTPUT_ZIP" .)
rm -rf "$WORK_DIR"

if command -v osascript >/dev/null 2>&1; then
  osascript -e "display dialog \"Diagnostics exported to $OUTPUT_ZIP\" buttons {\"OK\"} default button \"OK\"" >/dev/null 2>&1 || true
fi

printf 'Diagnostics exported to %s\n' "$OUTPUT_ZIP"
