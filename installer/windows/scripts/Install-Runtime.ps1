param(
    [string]$InstallDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$UserRoot = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "UrsaLabs\Zoo"
$LogDir = Join-Path $UserRoot "logs"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogPath = Join-Path $LogDir "zoo-install-runtime-$Timestamp.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log {
    param([string]$Message)

    $Line = "$(Get-Date -Format o) $Message"
    $Line | Tee-Object -FilePath $LogPath -Append
}

function Invoke-LoggedNative {
    param(
        [string]$FilePath,
        [string[]]$Arguments
    )

    Write-Log "> $FilePath $($Arguments -join ' ')"
    & $FilePath @Arguments 2>&1 | Tee-Object -FilePath $LogPath -Append
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

$Python = Join-Path $InstallDir "Python\python.exe"
$Wheelhouse = Join-Path $InstallDir "wheelhouse"
$Requirements = Join-Path $InstallDir "requirements\runtime-requirements.txt"
$Marker = Join-Path $InstallDir "runtime-installed.txt"

try {
    Write-Log "Installing Zoo runtime"
    Write-Log "Install directory: $InstallDir"
    Write-Log "Expected Python: $Python"
    Write-Log "Wheelhouse: $Wheelhouse"
    Write-Log "Requirements: $Requirements"

    if (-not (Test-Path $Python)) {
        throw "Python runtime not found at $Python"
    }

    if (-not (Test-Path $Wheelhouse)) {
        throw "Wheelhouse not found at $Wheelhouse"
    }

    if (-not (Test-Path $Requirements)) {
        throw "Runtime requirements file not found at $Requirements"
    }

    Invoke-LoggedNative $Python @("-m", "pip", "install", "--no-index", "--find-links", $Wheelhouse, "-r", $Requirements)
    Invoke-LoggedNative $Python @("-m", "pip", "install", "--no-index", "--find-links", $Wheelhouse, "--no-deps", "cubos", "zoo-backend")
    Invoke-LoggedNative $Python @("-m", "pip", "check")
    Invoke-LoggedNative $Python @("-c", "import zoo, gantry, deck, protocol_engine; print('Zoo runtime import check passed')")

    "Installed $(Get-Date -Format o)" | Set-Content -Path $Marker -Encoding UTF8
    Write-Log "Runtime install complete"
    exit 0
}
catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    if ($_.ScriptStackTrace) {
        Write-Log $_.ScriptStackTrace
    }
    exit 1
}
