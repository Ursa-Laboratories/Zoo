import re
import shutil
import subprocess
from pathlib import Path
import tomllib

import pytest


ROOT = Path(__file__).resolve().parents[1]
WINDOWS_INSTALLER = ROOT / "installer" / "windows"


def _extract_ini_section(text: str, section: str) -> str:
    lines = text.splitlines()
    start = None
    for index, line in enumerate(lines):
        if line.strip() == f"[{section}]":
            start = index + 1
            break
    if start is None:
        return ""
    end = start
    while end < len(lines) and not lines[end].strip().startswith("["):
        end += 1
    return "\n".join(lines[start:end])


def test_windows_runtime_uses_venv_and_installs_zoo_and_cubos() -> None:
    install_runtime = (WINDOWS_INSTALLER / "scripts" / "Install-Runtime.ps1").read_text()
    start_zoo = (WINDOWS_INSTALLER / "scripts" / "Start-Zoo.ps1").read_text()

    assert 'Join-Path $InstallDir "venv"' in install_runtime
    assert 'Join-Path $VenvDir "Scripts\\python.exe"' in install_runtime
    assert 'Invoke-LoggedNative $Python @("-m", "venv", $VenvDir)' in install_runtime
    assert '"--upgrade", "pip"' not in install_runtime
    assert '"cubos", "zoo"' in install_runtime

    assert 'Join-Path $InstallDir "venv\\Scripts\\python.exe"' in start_zoo
    assert "& $RuntimePython -m zoo" in start_zoo


def test_windows_installer_offers_asmi_as_optional_public_driver() -> None:
    iss = (WINDOWS_INSTALLER / "Zoo.iss").read_text()
    build_script = (WINDOWS_INSTALLER / "build-installer.ps1").read_text()
    install_runtime = (WINDOWS_INSTALLER / "scripts" / "Install-Runtime.ps1").read_text()
    runtime_requirements = (WINDOWS_INSTALLER / "runtime-requirements.txt").read_text()
    asmi_requirements = (
        WINDOWS_INSTALLER / "requirements" / "drivers" / "asmi.txt"
    ).read_text()

    assert "ASMI Go Direct driver support" in iss
    asmi_task_line = next(line for line in iss.splitlines() if 'Name: "asmi"' in line)
    assert "unchecked" not in asmi_task_line.lower()

    # Inno Setup task hierarchy is positional: a task at indent level N becomes
    # a child of the nearest preceding level-(N-1) task. Any backslash in a
    # [Tasks] name would (re-)introduce accidental parenting like the ASMI
    # default-selection bug this suite is guarding against.
    tasks_section = _extract_ini_section(iss, "Tasks")
    assert tasks_section
    task_names = re.findall(r'Name:\s*"([^"]+)"', tasks_section)
    assert task_names
    assert all("\\" not in name for name in task_names)

    assert "GetDriverGroups" in iss
    assert "WizardIsTaskSelected('asmi')" in iss
    assert "godirect" not in runtime_requirements.lower()
    assert "godirect>=1.2.1" in asmi_requirements
    assert "$DriverRequirementsDir" in build_script
    assert "requirements\\drivers" in build_script
    assert "$SelectedDriverGroups" in install_runtime


def test_godirect_is_not_a_core_zoo_dependency() -> None:
    project = tomllib.loads((ROOT / "pyproject.toml").read_text())

    dependencies = "\n".join(project["project"]["dependencies"]).lower()
    optional = project["project"]["optional-dependencies"]

    assert "godirect" not in dependencies
    assert optional["asmi"] == ["godirect>=1.2.1"]


@pytest.mark.skipif(
    shutil.which("pwsh") is None, reason="pwsh is not available on PATH"
)
def test_windows_installer_powershell_scripts_are_syntactically_valid() -> None:
    script_paths = sorted(WINDOWS_INSTALLER.glob("**/*.ps1"))
    assert script_paths, "expected at least one .ps1 script under installer/windows"

    for script_path in script_paths:
        escaped_path = str(script_path).replace("'", "''")
        parse_command = (
            "$errors = $null; "
            "[System.Management.Automation.Language.Parser]::ParseFile("
            f"'{escaped_path}', [ref]$null, [ref]$errors) | Out-Null; "
            "if ($errors.Count -gt 0) { "
            "$errors | ForEach-Object { Write-Error $_.Message }; exit 1 "
            "} else { exit 0 }"
        )
        result = subprocess.run(
            ["pwsh", "-NoProfile", "-NonInteractive", "-Command", parse_command],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, (
            f"{script_path} failed PowerShell parse validation: "
            f"{result.stderr or result.stdout}"
        )
