#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ZOO_REPO_URL="https://github.com/Ursa-Laboratories/Zoo.git"
CUBOS_REPO_URL="https://github.com/Ursa-Laboratories/CubOS.git"
BRANCH="main"
ZOO_SOURCE_DIR=""
CUBOS_SOURCE_DIR=""
BUILD_PYTHON="python3"
APP_VERSION="0.1.0"
BUILD_ROOT="$SCRIPT_DIR/build"
PYTHON_MINOR="3.11"
PYTHON_STANDALONE_RELEASE="latest"
PYTHON_STANDALONE_TARGET=""
PYTHON_STANDALONE_URL=""
DRIVER_GROUPS="asmi"
SIGN_IDENTITY=""
NOTARY_PROFILE=""

usage() {
  cat <<'USAGE'
Usage: build-dmg.sh [options]

Build a self-contained macOS Zoo.app DMG.

Options:
  --zoo-repo-url URL                 Zoo git repository URL.
  --cubos-repo-url URL               CubOS git repository URL.
  --branch NAME                      Branch to clone for Zoo and CubOS.
  --zoo-source-dir PATH              Use an existing Zoo checkout instead of cloning Zoo.
  --cubos-source-dir PATH            Use an existing CubOS checkout instead of cloning CubOS.
  --build-python PATH                Python 3 used for helper steps before private Python is extracted.
  --app-version VERSION              App version embedded in Info.plist and output name.
  --build-root PATH                  Working directory for build, stage, dist, downloads.
  --python-minor VERSION             CPython minor line from python-build-standalone.
  --python-standalone-release TAG    python-build-standalone release tag, or "latest".
  --python-standalone-target TARGET  Asset target, e.g. aarch64-apple-darwin.
  --python-standalone-url URL        Explicit Python standalone tarball URL.
  --driver-groups LIST               Default comma-separated public driver groups. Use "none" for none.
  --sign-identity IDENTITY           Optional Developer ID Application signing identity.
  --notary-profile PROFILE           Optional notarytool keychain profile; requires signing.
  -h, --help                         Show this help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --zoo-repo-url)
      ZOO_REPO_URL="$2"
      shift 2
      ;;
    --cubos-repo-url)
      CUBOS_REPO_URL="$2"
      shift 2
      ;;
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    --zoo-source-dir)
      ZOO_SOURCE_DIR="$(cd "$2" && pwd)"
      shift 2
      ;;
    --cubos-source-dir)
      CUBOS_SOURCE_DIR="$(cd "$2" && pwd)"
      shift 2
      ;;
    --build-python)
      BUILD_PYTHON="$2"
      shift 2
      ;;
    --app-version)
      APP_VERSION="$2"
      shift 2
      ;;
    --build-root)
      BUILD_ROOT="$2"
      shift 2
      ;;
    --python-minor)
      PYTHON_MINOR="$2"
      shift 2
      ;;
    --python-standalone-release)
      PYTHON_STANDALONE_RELEASE="$2"
      shift 2
      ;;
    --python-standalone-target)
      PYTHON_STANDALONE_TARGET="$2"
      shift 2
      ;;
    --python-standalone-url)
      PYTHON_STANDALONE_URL="$2"
      shift 2
      ;;
    --driver-groups)
      DRIVER_GROUPS="$2"
      shift 2
      ;;
    --sign-identity)
      SIGN_IDENTITY="$2"
      shift 2
      ;;
    --notary-profile)
      NOTARY_PROFILE="$2"
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

invoke_checked() {
  echo "> $*"
  "$@"
}

detect_python_target() {
  case "$(uname -m)" in
    arm64)
      printf 'aarch64-apple-darwin'
      ;;
    x86_64)
      printf 'x86_64-apple-darwin'
      ;;
    *)
      echo "Unsupported macOS architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

verify_package_python() {
  "$1" - "$PYTHON_MINOR" <<'PY'
import sys

expected = sys.argv[1]
actual = f"{sys.version_info.major}.{sys.version_info.minor}"
if actual != expected:
    raise SystemExit(
        f"Package Python must be {expected} so downloaded wheels match the embedded runtime; got {actual}."
    )
PY
}

resolve_python_standalone_url() {
  if [[ -n "$PYTHON_STANDALONE_URL" ]]; then
    printf '%s' "$PYTHON_STANDALONE_URL"
    return
  fi

  "$BUILD_PYTHON" - "$PYTHON_MINOR" "$PYTHON_STANDALONE_RELEASE" "$PYTHON_STANDALONE_TARGET" <<'PY'
import json
import sys
import urllib.request

python_minor, release, target = sys.argv[1:4]
base_url = "https://api.github.com/repos/astral-sh/python-build-standalone/releases"
release_url = f"{base_url}/latest" if release == "latest" else f"{base_url}/tags/{release}"

with urllib.request.urlopen(release_url, timeout=60) as response:
    payload = json.load(response)

prefix = f"cpython-{python_minor}."
needle = f"-{target}-install_only.tar.gz"
candidates = [
    asset
    for asset in payload.get("assets", [])
    if asset.get("name", "").startswith(prefix)
    and asset.get("name", "").endswith(needle)
]
if not candidates:
    available = "\n".join(asset.get("name", "") for asset in payload.get("assets", [])[:40])
    raise SystemExit(
        f"No python-build-standalone asset matched {prefix}*{needle} in {payload.get('tag_name')}. "
        f"First assets were:\n{available}"
    )

candidates.sort(key=lambda asset: asset["name"])
selected = candidates[-1]
print(selected["browser_download_url"])
print(f"Selected Python standalone asset: {selected['name']}", file=sys.stderr)
PY
}

copy_source_tree() {
  local source="$1"
  local destination="$2"
  mkdir -p "$destination"
  invoke_checked rsync -a --delete \
    --exclude .git \
    --exclude .venv \
    --exclude venv \
    --exclude node_modules \
    --exclude .pytest_cache \
    --exclude .omx \
    --exclude build \
    --exclude __pycache__ \
    --exclude '*.pyc' \
    "$source"/ "$destination"/
}

json_string() {
  "$BUILD_PYTHON" - "$1" <<'PY'
import json
import sys

print(json.dumps(sys.argv[1]))
PY
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "build-dmg.sh must run on macOS because it uses hdiutil and macOS wheels." >&2
  exit 1
fi

if [[ -z "$PYTHON_STANDALONE_TARGET" ]]; then
  PYTHON_STANDALONE_TARGET="$(detect_python_target)"
fi
HOST_PYTHON_STANDALONE_TARGET="$(detect_python_target)"
if [[ "$PYTHON_STANDALONE_TARGET" != "$HOST_PYTHON_STANDALONE_TARGET" ]]; then
  echo "Cross-architecture DMG builds are not supported; build on $PYTHON_STANDALONE_TARGET hardware or use the host target $HOST_PYTHON_STANDALONE_TARGET." >&2
  exit 1
fi

BUILD_ROOT="$(mkdir -p "$BUILD_ROOT" && cd "$BUILD_ROOT" && pwd)"
WORK="$BUILD_ROOT/work"
STAGE="$BUILD_ROOT/stage"
DIST="$BUILD_ROOT/dist"
DOWNLOADS="$BUILD_ROOT/downloads"
ZOO_CLONE="$WORK/Zoo"
CUBOS_CLONE="$WORK/CubOS"
APP_BUNDLE="$STAGE/Zoo.app"
CONTENTS_DIR="$APP_BUNDLE/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
WHEELHOUSE="$RESOURCES_DIR/wheelhouse"
REQUIREMENTS_DIR="$RESOURCES_DIR/requirements"
RUNTIME_REQUIREMENTS="$SCRIPT_DIR/runtime-requirements.txt"
DRIVER_REQUIREMENTS_DIR="$SCRIPT_DIR/requirements/drivers"
OUTPUT_NAME="Zoo-macOS-$PYTHON_STANDALONE_TARGET-$APP_VERSION.dmg"
DMG_PATH="$DIST/$OUTPUT_NAME"
VOLUME_NAME="Zoo $APP_VERSION"

rm -rf "$WORK" "$STAGE"
mkdir -p "$WORK" "$STAGE" "$DIST" "$DOWNLOADS" "$MACOS_DIR" "$RESOURCES_DIR" "$WHEELHOUSE" "$REQUIREMENTS_DIR"

if [[ -n "$CUBOS_SOURCE_DIR" ]]; then
  CUBOS_SOURCE="$CUBOS_SOURCE_DIR"
else
  invoke_checked git clone --depth 1 --branch "$BRANCH" "$CUBOS_REPO_URL" "$CUBOS_CLONE"
  CUBOS_SOURCE="$CUBOS_CLONE"
fi

if [[ -n "$ZOO_SOURCE_DIR" ]]; then
  ZOO_SOURCE="$ZOO_SOURCE_DIR"
else
  invoke_checked git clone --depth 1 --branch "$BRANCH" "$ZOO_REPO_URL" "$ZOO_CLONE"
  ZOO_SOURCE="$ZOO_CLONE"
fi

ZOO_COMMIT="$(git -C "$ZOO_SOURCE" rev-parse HEAD)"
CUBOS_COMMIT="$(git -C "$CUBOS_SOURCE" rev-parse HEAD)"
ZOO_BRANCH="$(git -C "$ZOO_SOURCE" rev-parse --abbrev-ref HEAD)"
CUBOS_BRANCH="$(git -C "$CUBOS_SOURCE" rev-parse --abbrev-ref HEAD)"

if [[ -z "$ZOO_SOURCE_DIR" && "$ZOO_BRANCH" != "$BRANCH" ]]; then
  echo "Zoo clone is on $ZOO_BRANCH, expected $BRANCH" >&2
  exit 1
fi
if [[ -z "$CUBOS_SOURCE_DIR" && "$CUBOS_BRANCH" != "$BRANCH" ]]; then
  echo "CubOS clone is on $CUBOS_BRANCH, expected $BRANCH" >&2
  exit 1
fi

pushd "$ZOO_SOURCE/frontend" >/dev/null
invoke_checked npm ci
invoke_checked npm run build
popd >/dev/null

PYTHON_URL="$(resolve_python_standalone_url)"
PYTHON_ARCHIVE="$DOWNLOADS/$(basename "$PYTHON_URL")"
if [[ ! -f "$PYTHON_ARCHIVE" ]]; then
  invoke_checked curl -L --fail "$PYTHON_URL" -o "$PYTHON_ARCHIVE"
fi

PYTHON_EXTRACT="$WORK/python-standalone"
rm -rf "$PYTHON_EXTRACT"
mkdir -p "$PYTHON_EXTRACT"
invoke_checked tar -xzf "$PYTHON_ARCHIVE" -C "$PYTHON_EXTRACT"
if [[ -x "$PYTHON_EXTRACT/python/install/bin/python3" ]]; then
  PYTHON_INSTALL_DIR="$PYTHON_EXTRACT/python/install"
elif [[ -x "$PYTHON_EXTRACT/python/bin/python3" ]]; then
  PYTHON_INSTALL_DIR="$PYTHON_EXTRACT/python"
else
  echo "Extracted Python standalone archive did not contain python/bin/python3 or python/install/bin/python3" >&2
  exit 1
fi
invoke_checked ditto "$PYTHON_INSTALL_DIR" "$RESOURCES_DIR/python"
PACKAGE_PYTHON="$RESOURCES_DIR/python/bin/python3"
verify_package_python "$PACKAGE_PYTHON"

invoke_checked "$PACKAGE_PYTHON" -m ensurepip --upgrade
invoke_checked "$PACKAGE_PYTHON" -m pip install --upgrade pip build wheel
invoke_checked "$PACKAGE_PYTHON" -m pip download --only-binary :all: --dest "$WHEELHOUSE" -r "$RUNTIME_REQUIREMENTS"
for driver_requirements in "$DRIVER_REQUIREMENTS_DIR"/*.txt; do
  invoke_checked "$PACKAGE_PYTHON" -m pip download --only-binary :all: --dest "$WHEELHOUSE" -r "$driver_requirements"
done
invoke_checked "$PACKAGE_PYTHON" -m pip wheel --no-deps --wheel-dir "$WHEELHOUSE" "$CUBOS_SOURCE"
invoke_checked "$PACKAGE_PYTHON" -m pip wheel --no-deps --wheel-dir "$WHEELHOUSE" "$ZOO_SOURCE"

copy_source_tree "$ZOO_SOURCE" "$RESOURCES_DIR/app/Zoo"
copy_source_tree "$CUBOS_SOURCE" "$RESOURCES_DIR/app/CubOS"
copy_source_tree "$SCRIPT_DIR/scripts" "$RESOURCES_DIR/scripts"
chmod +x "$RESOURCES_DIR/scripts/"*.sh

cp "$RUNTIME_REQUIREMENTS" "$REQUIREMENTS_DIR/runtime-requirements.txt"
mkdir -p "$REQUIREMENTS_DIR/drivers"
cp "$DRIVER_REQUIREMENTS_DIR"/*.txt "$REQUIREMENTS_DIR/drivers/"
printf '%s\n' "$DRIVER_GROUPS" > "$RESOURCES_DIR/default-driver-groups.txt"

sed "s/__APP_VERSION__/$APP_VERSION/g" "$SCRIPT_DIR/Info.plist.in" > "$CONTENTS_DIR/Info.plist"

cat > "$MACOS_DIR/Zoo" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
MACOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOURCES_DIR="$(cd "$MACOS_DIR/../Resources" && pwd)"
exec "$RESOURCES_DIR/scripts/start_zoo.sh"
SH
chmod +x "$MACOS_DIR/Zoo"

BUILD_INFO_PATH="$RESOURCES_DIR/build-info.json"
"$PACKAGE_PYTHON" - "$BUILD_INFO_PATH" \
  "$ZOO_REPO_URL" "$ZOO_BRANCH" "$ZOO_COMMIT" \
  "$CUBOS_REPO_URL" "$CUBOS_BRANCH" "$CUBOS_COMMIT" \
  "$PYTHON_MINOR" "$PYTHON_STANDALONE_RELEASE" "$PYTHON_STANDALONE_TARGET" "$PYTHON_URL" \
  "$APP_VERSION" "$DRIVER_GROUPS" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

(
    output,
    zoo_repo,
    zoo_branch,
    zoo_commit,
    cubos_repo,
    cubos_branch,
    cubos_commit,
    python_minor,
    python_standalone_release,
    python_standalone_target,
    python_standalone_url,
    app_version,
    driver_groups,
) = sys.argv[1:]

payload = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "zoo_repo": zoo_repo,
    "zoo_branch": zoo_branch,
    "zoo_commit": zoo_commit,
    "cubos_repo": cubos_repo,
    "cubos_branch": cubos_branch,
    "cubos_commit": cubos_commit,
    "python_minor": python_minor,
    "python_standalone_release": python_standalone_release,
    "python_standalone_target": python_standalone_target,
    "python_standalone_url": python_standalone_url,
    "app_version": app_version,
    "driver_groups": driver_groups,
}
Path(output).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY

if [[ -n "$SIGN_IDENTITY" ]]; then
  invoke_checked codesign --force --deep --options runtime --sign "$SIGN_IDENTITY" "$APP_BUNDLE"
fi

DMG_ROOT="$STAGE/dmg-root"
rm -rf "$DMG_ROOT"
mkdir -p "$DMG_ROOT"
invoke_checked ditto "$APP_BUNDLE" "$DMG_ROOT/Zoo.app"
ln -s /Applications "$DMG_ROOT/Applications"
cat > "$DMG_ROOT/Export Zoo Diagnostics.command" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
DMG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_BUNDLE="/Applications/Zoo.app"
if [[ ! -d "$APP_BUNDLE" ]]; then
  APP_BUNDLE="$DMG_DIR/Zoo.app"
fi
exec "$APP_BUNDLE/Contents/Resources/scripts/export_diagnostics.sh"
SH
chmod +x "$DMG_ROOT/Export Zoo Diagnostics.command"

rm -f "$DMG_PATH"
invoke_checked hdiutil create -volname "$VOLUME_NAME" -srcfolder "$DMG_ROOT" -ov -format UDZO "$DMG_PATH"

if [[ -n "$SIGN_IDENTITY" ]]; then
  invoke_checked codesign --force --sign "$SIGN_IDENTITY" "$DMG_PATH"
fi

if [[ -n "$NOTARY_PROFILE" ]]; then
  if [[ -z "$SIGN_IDENTITY" ]]; then
    echo "--notary-profile requires --sign-identity" >&2
    exit 1
  fi
  invoke_checked xcrun notarytool submit "$DMG_PATH" --keychain-profile "$NOTARY_PROFILE" --wait
  invoke_checked xcrun stapler staple "$DMG_PATH"
fi

echo "Zoo macOS DMG written to $DMG_PATH"
