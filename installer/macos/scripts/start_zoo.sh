#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOURCES_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
USER_ROOT="${ZOO_USER_ROOT:-$HOME/Library/Application Support/UrsaLabs/Zoo}"
LOG_DIR="${ZOO_LOG_DIR:-$HOME/Library/Logs/UrsaLabs/Zoo}"
DATA_DIR="$USER_ROOT/data"
DATA_DB_PATH="$DATA_DIR/panda_data.db"
CONFIG_DIR="${ZOO_CONFIG_DIR:-$USER_ROOT/configs}"
ZOO_HOST_VALUE="${ZOO_HOST:-127.0.0.1}"
ZOO_PORT_VALUE="${ZOO_PORT:-8742}"
ZOO_OPEN_BROWSER_VALUE="${ZOO_OPEN_BROWSER:-true}"
RUNTIME_DIR="$USER_ROOT/runtime"
VENV_PYTHON="$RUNTIME_DIR/venv/bin/python"
RUNTIME_MARKER="$RUNTIME_DIR/runtime-installed.txt"
DRIVER_GROUPS_FILE="$RUNTIME_DIR/driver-groups.txt"
DEFAULT_DRIVER_GROUPS_FILE="$RESOURCES_DIR/default-driver-groups.txt"
INSTALL_RUNTIME_SCRIPT="$RESOURCES_DIR/scripts/install_runtime.sh"
BUILD_INFO="$RESOURCES_DIR/build-info.json"
ZOO_DIR="$RESOURCES_DIR/app/Zoo"
CUBOS_CONFIG_DIR="$RESOURCES_DIR/app/CubOS/configs"

mkdir -p "$LOG_DIR" "$DATA_DIR" "$CONFIG_DIR" "$RUNTIME_DIR"
TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
LOG_PATH="$LOG_DIR/zoo-launch-$TIMESTAMP.log"
touch "$LOG_PATH"

log() {
  printf '%s %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*" | tee -a "$LOG_PATH"
}

show_failure() {
  local message="$1"
  log "ERROR: $message"
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display dialog \"Zoo failed to start. $message Log written to: $LOG_PATH\" buttons {\"OK\"} default button \"OK\" with icon stop" >/dev/null 2>&1 || true
  fi
}

get_build_info_sha() {
  if [[ -f "$BUILD_INFO" ]]; then
    shasum -a 256 "$BUILD_INFO" | awk '{print $1}'
  else
    printf ''
  fi
}

get_installed_driver_groups() {
  if [[ -f "$DRIVER_GROUPS_FILE" ]]; then
    local value
    value="$(head -n 1 "$DRIVER_GROUPS_FILE" || true)"
    if [[ -n "$value" ]]; then
      printf '%s' "$value"
      return
    fi
  fi

  if [[ -f "$RUNTIME_MARKER" ]]; then
    local marker_value
    marker_value="$(grep '^DriverGroups=' "$RUNTIME_MARKER" | head -n 1 | cut -d= -f2- || true)"
    if [[ -n "$marker_value" && "$marker_value" != "none" ]]; then
      printf '%s' "$marker_value"
      return
    fi
  fi

  if [[ -f "$DEFAULT_DRIVER_GROUPS_FILE" ]]; then
    head -n 1 "$DEFAULT_DRIVER_GROUPS_FILE" || true
  fi
}

needs_runtime_install() {
  if [[ ! -f "$RUNTIME_MARKER" || ! -x "$VENV_PYTHON" ]]; then
    return 0
  fi

  local build_info_sha
  build_info_sha="$(get_build_info_sha)"
  if [[ -n "$build_info_sha" ]] && ! grep -Fq "BuildInfoSha=$build_info_sha" "$RUNTIME_MARKER"; then
    return 0
  fi

  return 1
}

main() {
  log "Starting Zoo launcher"
  log "Resources directory: $RESOURCES_DIR"
  log "Config directory: $CONFIG_DIR"
  log "Data database path: $DATA_DB_PATH"
  log "Runtime Python: $VENV_PYTHON"

  if [[ ! -d "$ZOO_DIR" ]]; then
    show_failure "Zoo source directory not found at $ZOO_DIR."
    exit 1
  fi

  if [[ ! -d "$ZOO_DIR/frontend/dist" ]]; then
    show_failure "Zoo frontend build not found at $ZOO_DIR/frontend/dist. Rebuild the DMG so Node.js is not needed on the operator machine."
    exit 1
  fi

  if needs_runtime_install; then
    log "Zoo runtime packages need installation"
    local driver_groups
    driver_groups="$(get_installed_driver_groups)"
    "$INSTALL_RUNTIME_SCRIPT" --resources-dir "$RESOURCES_DIR" --driver-groups "$driver_groups" --log-path "$LOG_PATH"
  fi

  local existing_config
  existing_config="$(find "$CONFIG_DIR" -type f -name '*.yaml' -print -quit 2>/dev/null || true)"
  if [[ -z "$existing_config" && -d "$CUBOS_CONFIG_DIR" ]]; then
    log "Seeding config directory from $CUBOS_CONFIG_DIR"
    cp -R "$CUBOS_CONFIG_DIR"/. "$CONFIG_DIR"/
  fi

  export ZOO_CONFIG_DIR="$CONFIG_DIR"
  export CUBOS_DATA_DB_PATH="$DATA_DB_PATH"
  export ZOO_DATA_DB_PATH="$DATA_DB_PATH"
  export ZOO_HOST="$ZOO_HOST_VALUE"
  export ZOO_PORT="$ZOO_PORT_VALUE"
  export ZOO_OPEN_BROWSER="$ZOO_OPEN_BROWSER_VALUE"
  export PYTHONUTF8="1"
  export PYTHONNOUSERSITE="1"

  log "Launching Zoo at http://$ZOO_HOST_VALUE:$ZOO_PORT_VALUE"
  cd "$ZOO_DIR"
  "$VENV_PYTHON" -m zoo 2>&1 | tee -a "$LOG_PATH"
  local status="${PIPESTATUS[0]}"
  if [[ "$status" -ne 0 ]]; then
    show_failure "python -m zoo exited with code $status."
  fi
  exit "$status"
}

main "$@"
