param(
    [string]$InstallDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string[]]$DriverGroups = @()
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
$VenvDir = Join-Path $InstallDir "venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$Wheelhouse = Join-Path $InstallDir "wheelhouse"
$Requirements = Join-Path $InstallDir "requirements\runtime-requirements.txt"
$DriverRequirementsDir = Join-Path $InstallDir "requirements\drivers"
$Marker = Join-Path $InstallDir "runtime-installed.txt"
$SelectedDriverGroups = @(
    $DriverGroups |
        ForEach-Object { $_ -split "," } |
        Where-Object { $_ -and $_.Trim() } |
        ForEach-Object { $_.Trim().ToLowerInvariant() } |
        Select-Object -Unique
)

try {
    Write-Log "Installing Zoo runtime"
    Write-Log "Install directory: $InstallDir"
    Write-Log "Expected Python: $Python"
    Write-Log "Runtime virtual environment: $VenvDir"
    Write-Log "Wheelhouse: $Wheelhouse"
    Write-Log "Requirements: $Requirements"
    Write-Log "Selected public driver groups: $(if ($SelectedDriverGroups.Count) { $SelectedDriverGroups -join ', ' } else { 'none' })"

    if (-not (Test-Path $Python)) {
        throw "Python runtime not found at $Python"
    }

    if (-not (Test-Path $Wheelhouse)) {
        throw "Wheelhouse not found at $Wheelhouse"
    }

    if (-not (Test-Path $Requirements)) {
        throw "Runtime requirements file not found at $Requirements"
    }

    if (-not (Test-Path $VenvPython)) {
        Write-Log "Creating runtime virtual environment"
        Invoke-LoggedNative $Python @("-m", "venv", $VenvDir)
    }

    if (-not (Test-Path $VenvPython)) {
        throw "Virtual environment creation completed but python.exe was not found at $VenvPython"
    }

    Invoke-LoggedNative $VenvPython @("-m", "pip", "install", "--no-index", "--find-links", $Wheelhouse, "-r", $Requirements)

    foreach ($DriverGroup in $SelectedDriverGroups) {
        $DriverRequirements = Join-Path $DriverRequirementsDir "$DriverGroup.txt"
        if (-not (Test-Path $DriverRequirements)) {
            throw "No public driver requirements file found for '$DriverGroup' at $DriverRequirements"
        }
        Write-Log "Installing public driver group '$DriverGroup'"
        Invoke-LoggedNative $VenvPython @("-m", "pip", "install", "--no-index", "--find-links", $Wheelhouse, "-r", $DriverRequirements)
    }

    Invoke-LoggedNative $VenvPython @("-m", "pip", "install", "--no-index", "--find-links", $Wheelhouse, "--no-deps", "cubos", "zoo")
    Invoke-LoggedNative $VenvPython @("-m", "pip", "check")
    Invoke-LoggedNative $VenvPython @("-c", "import zoo, gantry, deck, protocol_engine; print('Zoo runtime import check passed')")

    @(
        "Installed $(Get-Date -Format o)",
        "Python=$VenvPython",
        "DriverGroups=$(if ($SelectedDriverGroups.Count) { $SelectedDriverGroups -join ',' } else { 'none' })"
    ) | Set-Content -Path $Marker -Encoding UTF8
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
