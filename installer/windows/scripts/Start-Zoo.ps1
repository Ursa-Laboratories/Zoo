param(
    [string]$InstallDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Python = Join-Path $InstallDir "Python\python.exe"
$ZooDir = Join-Path $InstallDir "app\Zoo"
$CubOSConfigDir = Join-Path $InstallDir "app\CubOS\configs"
$UserRoot = Join-Path $env:LOCALAPPDATA "UrsaLabs\Zoo"
$ConfigDir = if ($env:ZOO_CONFIG_DIR) { $env:ZOO_CONFIG_DIR } else { Join-Path $UserRoot "configs" }
$LogDir = Join-Path $UserRoot "logs"

if (-not (Test-Path $Python)) {
    throw "Python runtime not found at $Python"
}

if (-not (Test-Path $ZooDir)) {
    throw "Zoo source directory not found at $ZooDir"
}

$FrontendDist = Join-Path $ZooDir "frontend\dist"
if (-not (Test-Path $FrontendDist)) {
    throw "Zoo frontend build not found at $FrontendDist. Rebuild the installer so Node.js is not needed on the operator machine."
}

New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$ExistingConfig = Get-ChildItem -Path $ConfigDir -Recurse -Filter "*.yaml" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $ExistingConfig -and (Test-Path $CubOSConfigDir)) {
    Copy-Item -Path (Join-Path $CubOSConfigDir "*") -Destination $ConfigDir -Recurse -Force
}

$env:ZOO_CONFIG_DIR = $ConfigDir
$env:ZOO_HOST = "127.0.0.1"
$env:ZOO_PORT = "8742"
$env:ZOO_OPEN_BROWSER = "true"
$env:PYTHONUTF8 = "1"

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogPath = Join-Path $LogDir "zoo-$Timestamp.log"

"Starting Zoo at http://127.0.0.1:8742" | Tee-Object -FilePath $LogPath
"Config directory: $ConfigDir" | Tee-Object -FilePath $LogPath -Append
"Install directory: $InstallDir" | Tee-Object -FilePath $LogPath -Append

Push-Location $ZooDir
try {
    & $Python -m zoo *>> $LogPath
    $ExitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}

if ($ExitCode -ne 0) {
    Write-Host "Zoo exited with code $ExitCode. Log: $LogPath"
    Read-Host "Press Enter to close"
}

exit $ExitCode
