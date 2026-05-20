param(
    [string]$InstallDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$UserRoot = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "UrsaLabs\Zoo"
$LogDir = Join-Path $UserRoot "logs"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogPath = Join-Path $LogDir "zoo-launch-$Timestamp.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log {
    param([string]$Message)

    $Line = "$(Get-Date -Format o) $Message"
    $Line | Tee-Object -FilePath $LogPath -Append
}

function Show-Failure {
    param([string]$Message)

    Write-Host ""
    Write-Host "Zoo failed to start." -ForegroundColor Red
    Write-Host $Message -ForegroundColor Red
    Write-Host "Log written to: $LogPath"
    Read-Host "Press Enter to close"
}

$Python = Join-Path $InstallDir "Python\python.exe"
$ZooDir = Join-Path $InstallDir "app\Zoo"
$CubOSConfigDir = Join-Path $InstallDir "app\CubOS\configs"
$ConfigDir = if ($env:ZOO_CONFIG_DIR) { $env:ZOO_CONFIG_DIR } else { Join-Path $UserRoot "configs" }

try {
    Write-Log "Starting Zoo launcher"
    Write-Log "Install directory: $InstallDir"
    Write-Log "Expected Python: $Python"
    Write-Log "Zoo source directory: $ZooDir"
    Write-Log "Config directory: $ConfigDir"

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

    $ExistingConfig = Get-ChildItem -Path $ConfigDir -Recurse -Filter "*.yaml" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $ExistingConfig -and (Test-Path $CubOSConfigDir)) {
        Write-Log "Seeding config directory from $CubOSConfigDir"
        Copy-Item -Path (Join-Path $CubOSConfigDir "*") -Destination $ConfigDir -Recurse -Force
    }

    $env:ZOO_CONFIG_DIR = $ConfigDir
    $env:ZOO_HOST = "127.0.0.1"
    $env:ZOO_PORT = "8742"
    $env:ZOO_OPEN_BROWSER = "true"
    $env:PYTHONUTF8 = "1"

    Write-Log "Launching Zoo at http://127.0.0.1:8742"

    Push-Location $ZooDir
    try {
        & $Python -m zoo 2>&1 | Tee-Object -FilePath $LogPath -Append
        $ExitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }

    if ($ExitCode -ne 0) {
        throw "python -m zoo exited with code $ExitCode"
    }

    exit 0
}
catch {
    $Message = $_.Exception.Message
    Write-Log "ERROR: $Message"
    if ($_.ScriptStackTrace) {
        Write-Log $_.ScriptStackTrace
    }
    Show-Failure $Message
    exit 1
}
