# Windows operator installer

## Goal

Build a Windows installer path for nontechnical Zoo operators that targets Zoo
`main` and CubOS `main`.

## Current State

- Zoo package metadata now points its CubOS dependency at
  `https://github.com/Ursa-Laboratories/CubOS.git@main`.
- `installer/windows/` contains a Windows packaging pipeline:
  - clones Zoo and CubOS `main`
  - builds `frontend/dist`
  - prepares an offline wheelhouse
  - bundles a private Python 3.11 installer
  - emits an Inno Setup installer
  - installs Start Menu shortcuts for launch, configs, logs, and diagnostics
- `.github/workflows/windows-installer.yml` builds the installer on
  `windows-latest` and uploads the `.exe` as a workflow artifact.
- The runtime launcher seeds `%LOCALAPPDATA%\UrsaLabs\Zoo\configs` from bundled
  CubOS configs on first launch and writes logs to
  `%LOCALAPPDATA%\UrsaLabs\Zoo\logs`.

## Remaining Validation

- Build the installer on Windows with Inno Setup 6.
- Install it on a clean Windows VM without Python, Node.js, or Git on `PATH`.
- Smoke-test Zoo UI startup at `http://127.0.0.1:8742`.
- Hardware validation remains separate and should be done only with normal lab
  clearance.
