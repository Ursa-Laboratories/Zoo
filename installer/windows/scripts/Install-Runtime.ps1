param(
    [string]$InstallDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Python = Join-Path $InstallDir "Python\python.exe"
$Wheelhouse = Join-Path $InstallDir "wheelhouse"
$Requirements = Join-Path $InstallDir "requirements\runtime-requirements.txt"
$Marker = Join-Path $InstallDir "runtime-installed.txt"

if (-not (Test-Path $Python)) {
    throw "Python runtime not found at $Python"
}

if (-not (Test-Path $Wheelhouse)) {
    throw "Wheelhouse not found at $Wheelhouse"
}

if (-not (Test-Path $Requirements)) {
    throw "Runtime requirements file not found at $Requirements"
}

& $Python -m pip install --no-index --find-links $Wheelhouse -r $Requirements
if ($LASTEXITCODE -ne 0) {
    throw "Dependency installation failed with exit code $LASTEXITCODE"
}

& $Python -m pip install --no-index --find-links $Wheelhouse --no-deps cubos zoo
if ($LASTEXITCODE -ne 0) {
    throw "Zoo/CubOS wheel installation failed with exit code $LASTEXITCODE"
}

& $Python -m pip check
if ($LASTEXITCODE -ne 0) {
    throw "pip check failed with exit code $LASTEXITCODE"
}

& $Python -c "import zoo, gantry, deck, protocol_engine; print('Zoo runtime import check passed')"
if ($LASTEXITCODE -ne 0) {
    throw "Runtime import check failed with exit code $LASTEXITCODE"
}

"Installed $(Get-Date -Format o)" | Set-Content -Path $Marker -Encoding UTF8
