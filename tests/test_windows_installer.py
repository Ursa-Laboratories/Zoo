from pathlib import Path
import tomllib


ROOT = Path(__file__).resolve().parents[1]
WINDOWS_INSTALLER = ROOT / "installer" / "windows"


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

    assert "drivers\\asmi" in iss
    assert "ASMI Go Direct driver support" in iss
    asmi_task_line = next(line for line in iss.splitlines() if 'Name: "drivers\\asmi"' in line)
    assert "unchecked" not in asmi_task_line.lower()
    assert "GetDriverGroups" in iss
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
