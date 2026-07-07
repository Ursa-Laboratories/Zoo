import plistlib
import shutil
import subprocess
from pathlib import Path
import tomllib

import pytest


ROOT = Path(__file__).resolve().parents[1]
MACOS_INSTALLER = ROOT / "installer" / "macos"
WINDOWS_INSTALLER = ROOT / "installer" / "windows"


def test_macos_runtime_uses_private_python_venv_and_installs_zoo_and_cubos() -> None:
    install_runtime = (MACOS_INSTALLER / "scripts" / "install_runtime.sh").read_text()
    start_zoo = (MACOS_INSTALLER / "scripts" / "start_zoo.sh").read_text()

    assert 'PYTHON="$RESOURCES_DIR/python/bin/python3"' in install_runtime
    assert 'VENV_DIR="$RUNTIME_DIR/venv"' in install_runtime
    assert 'run_logged "$PYTHON" -m venv "$VENV_DIR"' in install_runtime
    assert "--no-index --find-links" in install_runtime
    assert "--force-reinstall cubos zoo" in install_runtime
    assert "pip check" in install_runtime
    assert "import zoo, gantry, deck, protocol_engine" in install_runtime

    assert 'VENV_PYTHON="$RUNTIME_DIR/venv/bin/python"' in start_zoo
    assert '"$VENV_PYTHON" -m zoo' in start_zoo
    assert "BuildInfoSha=" in start_zoo


def test_macos_launcher_uses_operator_state_dirs_and_supported_env() -> None:
    start_zoo = (MACOS_INSTALLER / "scripts" / "start_zoo.sh").read_text()

    assert "Library/Application Support/UrsaLabs/Zoo" in start_zoo
    assert "Library/Logs/UrsaLabs/Zoo" in start_zoo
    assert 'CONFIG_DIR="${ZOO_CONFIG_DIR:-$USER_ROOT/configs}"' in start_zoo
    assert 'DATA_DB_PATH="$DATA_DIR/panda_data.db"' in start_zoo
    assert 'export ZOO_CONFIG_DIR="$CONFIG_DIR"' in start_zoo
    assert 'export CUBOS_DATA_DB_PATH="$DATA_DB_PATH"' in start_zoo
    assert 'export ZOO_DATA_DB_PATH="$DATA_DB_PATH"' in start_zoo
    assert 'ZOO_HOST_VALUE="${ZOO_HOST:-127.0.0.1}"' in start_zoo
    assert 'ZOO_PORT_VALUE="${ZOO_PORT:-8742}"' in start_zoo
    assert 'ZOO_OPEN_BROWSER_VALUE="${ZOO_OPEN_BROWSER:-true}"' in start_zoo
    assert 'export ZOO_HOST="$ZOO_HOST_VALUE"' in start_zoo
    assert 'export ZOO_PORT="$ZOO_PORT_VALUE"' in start_zoo
    assert 'export ZOO_OPEN_BROWSER="$ZOO_OPEN_BROWSER_VALUE"' in start_zoo
    assert 'cp -R "$CUBOS_CONFIG_DIR"/. "$CONFIG_DIR"/' in start_zoo


def test_macos_dmg_builder_packages_app_bundle_offline_payload_and_dmg() -> None:
    build_script = (MACOS_INSTALLER / "build-dmg.sh").read_text()

    assert "build-dmg.sh must run on macOS" in build_script
    assert "astral-sh/python-build-standalone" in build_script
    assert "aarch64-apple-darwin" in build_script
    assert "x86_64-apple-darwin" in build_script
    assert "Package Python must be" in build_script
    assert "Cross-architecture DMG builds are not supported" in build_script
    assert 'APP_BUNDLE="$STAGE/Zoo.app"' in build_script
    assert 'MACOS_DIR="$CONTENTS_DIR/MacOS"' in build_script
    assert 'RESOURCES_DIR="$CONTENTS_DIR/Resources"' in build_script
    assert "npm run build" in build_script
    assert "pip download --only-binary :all:" in build_script
    assert "pip wheel --no-deps" in build_script
    assert "python/install/bin/python3" in build_script
    assert "python/bin/python3" in build_script
    assert 'PACKAGE_PYTHON="$RESOURCES_DIR/python/bin/python3"' in build_script
    assert "hdiutil create" in build_script
    assert "Export Zoo Diagnostics.command" in build_script
    assert "codesign --force --deep --options runtime" in build_script
    assert "notarytool submit" in build_script


def test_macos_installer_offers_asmi_public_driver_by_default() -> None:
    runtime_requirements = (MACOS_INSTALLER / "runtime-requirements.txt").read_text()
    asmi_requirements = (
        MACOS_INSTALLER / "requirements" / "drivers" / "asmi.txt"
    ).read_text()
    default_driver_groups = (MACOS_INSTALLER / "default-driver-groups.txt").read_text()
    build_script = (MACOS_INSTALLER / "build-dmg.sh").read_text()
    install_runtime = (MACOS_INSTALLER / "scripts" / "install_runtime.sh").read_text()
    project = tomllib.loads((ROOT / "pyproject.toml").read_text())

    assert default_driver_groups.strip() == "asmi"
    assert "godirect" not in runtime_requirements.lower()
    assert "godirect>=1.2.1" in asmi_requirements
    assert 'DRIVER_GROUPS="asmi"' in build_script
    assert "requirements/drivers" in build_script
    assert "DEFAULT_DRIVER_GROUPS_FILE" in install_runtime
    assert project["project"]["optional-dependencies"]["asmi"] == ["godirect>=1.2.1"]


def test_macos_runtime_requirements_match_windows_runtime_requirements() -> None:
    macos_requirements = (MACOS_INSTALLER / "runtime-requirements.txt").read_text()
    windows_requirements = (WINDOWS_INSTALLER / "runtime-requirements.txt").read_text()

    assert macos_requirements == windows_requirements


def test_macos_info_plist_template_is_valid() -> None:
    plist_text = (MACOS_INSTALLER / "Info.plist.in").read_text().replace(
        "__APP_VERSION__", "0.1.0"
    )
    payload = plistlib.loads(plist_text.encode())

    assert payload["CFBundleExecutable"] == "Zoo"
    assert payload["CFBundleIdentifier"] == "com.ursalabs.zoo"
    assert payload["CFBundlePackageType"] == "APPL"


@pytest.mark.skipif(shutil.which("bash") is None, reason="bash is not available on PATH")
def test_macos_installer_shell_scripts_are_syntactically_valid() -> None:
    script_paths = sorted(MACOS_INSTALLER.glob("**/*.sh"))
    assert script_paths, "expected at least one .sh script under installer/macos"

    for script_path in script_paths:
        result = subprocess.run(
            ["bash", "-n", str(script_path)],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, (
            f"{script_path} failed bash syntax validation: "
            f"{result.stderr or result.stdout}"
        )
