#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOURCES_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DRIVER_GROUPS=""
LOG_PATH=""

usage() {
  cat <<'USAGE'
Usage: install_runtime.sh [options]

Options:
  --resources-dir PATH   Zoo.app Contents/Resources directory.
  --driver-groups LIST   Comma-separated public driver groups to install.
  --log-path PATH        Append logs to this file.
  -h, --help             Show this help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --resources-dir)
      RESOURCES_DIR="$(cd "$2" && pwd)"
      shift 2
      ;;
    --driver-groups)
      DRIVER_GROUPS="$2"
      shift 2
      ;;
    --log-path)
      LOG_PATH="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

USER_ROOT="${ZOO_USER_ROOT:-$HOME/Library/Application Support/UrsaLabs/Zoo}"
LOG_DIR="${ZOO_LOG_DIR:-$HOME/Library/Logs/UrsaLabs/Zoo}"
RUNTIME_DIR="$USER_ROOT/runtime"
VENV_DIR="$RUNTIME_DIR/venv"
VENV_PYTHON="$VENV_DIR/bin/python"
PYTHON="$RESOURCES_DIR/python/bin/python3"
WHEELHOUSE="$RESOURCES_DIR/wheelhouse"
REQUIREMENTS="$RESOURCES_DIR/requirements/runtime-requirements.txt"
DRIVER_REQUIREMENTS_DIR="$RESOURCES_DIR/requirements/drivers"
DEFAULT_DRIVER_GROUPS_FILE="$RESOURCES_DIR/default-driver-groups.txt"
BUILD_INFO="$RESOURCES_DIR/build-info.json"
MARKER="$RUNTIME_DIR/runtime-installed.txt"
DRIVER_GROUPS_FILE="$RUNTIME_DIR/driver-groups.txt"

mkdir -p "$LOG_DIR" "$RUNTIME_DIR"
if [[ -z "$LOG_PATH" ]]; then
  TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
  LOG_PATH="$LOG_DIR/zoo-install-runtime-$TIMESTAMP.log"
fi
touch "$LOG_PATH"

log() {
  printf '%s %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*" | tee -a "$LOG_PATH"
}

run_logged() {
  log "> $*"
  "$@" 2>&1 | tee -a "$LOG_PATH"
  local status="${PIPESTATUS[0]}"
  if [[ "$status" -ne 0 ]]; then
    log "ERROR: $* failed with exit code $status"
    exit "$status"
  fi
}

normalize_driver_groups() {
  local raw="$1"
  local groups=()
  local item
  IFS=',' read -r -a parts <<< "$raw"
  for item in "${parts[@]}"; do
    item="$(printf '%s' "$item" | tr '[:upper:]' '[:lower:]' | xargs)"
    if [[ -n "$item" && "$item" != "none" ]]; then
      groups+=("$item")
    fi
  done
  if [[ "${#groups[@]}" -eq 0 ]]; then
    printf ''
  else
    local IFS=','
    printf '%s' "${groups[*]}"
  fi
}

if [[ -z "$DRIVER_GROUPS" && -f "$DEFAULT_DRIVER_GROUPS_FILE" ]]; then
  DRIVER_GROUPS="$(head -n 1 "$DEFAULT_DRIVER_GROUPS_FILE" || true)"
fi
SELECTED_DRIVER_GROUPS="$(normalize_driver_groups "$DRIVER_GROUPS")"

if [[ ! -x "$PYTHON" ]]; then
  log "ERROR: private Python runtime not found at $PYTHON"
  exit 1
fi
if [[ ! -d "$WHEELHOUSE" ]]; then
  log "ERROR: wheelhouse not found at $WHEELHOUSE"
  exit 1
fi
if [[ ! -f "$REQUIREMENTS" ]]; then
  log "ERROR: runtime requirements file not found at $REQUIREMENTS"
  exit 1
fi

BUILD_INFO_SHA=""
if [[ -f "$BUILD_INFO" ]]; then
  BUILD_INFO_SHA="$(shasum -a 256 "$BUILD_INFO" | awk '{print $1}')"
fi

log "Installing Zoo runtime"
log "Resources directory: $RESOURCES_DIR"
log "Runtime virtual environment: $VENV_DIR"
log "Wheelhouse: $WHEELHOUSE"
log "Requirements: $REQUIREMENTS"
log "Selected public driver groups: ${SELECTED_DRIVER_GROUPS:-none}"

if [[ -d "$VENV_DIR" && -f "$VENV_DIR/pyvenv.cfg" ]] && ! grep -Fq "$RESOURCES_DIR/python" "$VENV_DIR/pyvenv.cfg"; then
  log "Existing virtual environment points at a different app runtime; recreating it"
  rm -rf "$VENV_DIR"
fi

if [[ ! -x "$VENV_PYTHON" ]]; then
  log "Creating runtime virtual environment"
  rm -rf "$VENV_DIR"
  run_logged "$PYTHON" -m venv "$VENV_DIR"
fi

run_logged "$VENV_PYTHON" -m pip install --no-index --find-links "$WHEELHOUSE" -r "$REQUIREMENTS"

if [[ -n "$SELECTED_DRIVER_GROUPS" ]]; then
  IFS=',' read -r -a DRIVER_GROUP_ARRAY <<< "$SELECTED_DRIVER_GROUPS"
  for driver_group in "${DRIVER_GROUP_ARRAY[@]}"; do
    DRIVER_REQUIREMENTS="$DRIVER_REQUIREMENTS_DIR/$driver_group.txt"
    if [[ ! -f "$DRIVER_REQUIREMENTS" ]]; then
      log "ERROR: no public driver requirements file found for '$driver_group' at $DRIVER_REQUIREMENTS"
      exit 1
    fi
    log "Installing public driver group '$driver_group'"
    run_logged "$VENV_PYTHON" -m pip install --no-index --find-links "$WHEELHOUSE" -r "$DRIVER_REQUIREMENTS"
  done
fi

run_logged "$VENV_PYTHON" -m pip install --no-index --find-links "$WHEELHOUSE" --no-deps --force-reinstall cubos zoo
run_logged "$VENV_PYTHON" -m pip check
run_logged "$VENV_PYTHON" -c "import zoo, gantry, deck, protocol_engine; print('Zoo runtime import check passed')"

{
  printf 'Installed %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  printf 'Python=%s\n' "$VENV_PYTHON"
  printf 'DriverGroups=%s\n' "${SELECTED_DRIVER_GROUPS:-none}"
  printf 'BuildInfoSha=%s\n' "$BUILD_INFO_SHA"
} > "$MARKER"
printf '%s\n' "$SELECTED_DRIVER_GROUPS" > "$DRIVER_GROUPS_FILE"

log "Runtime install complete"
