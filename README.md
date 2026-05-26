# Zoo

`Zoo` is the local web UI for `CubOS`. It edits YAML configs, visualizes deck state, controls gantry motion, and triggers protocol execution through CubOS.

See also:

- `docs/repo-overview.md`
- `../docs/architecture/system-overview.md`
- `../docs/reference/api-contracts.md`

## Dependency Model

- Zoo imports `CubOS` as an installed package.
- Zoo should stay a thin layer over CubOS loaders, schemas, registries, and motion logic.
- The checked-in dependency currently points at a Git branch in `pyproject.toml`. Confirm branch strategy before changing it.
- Zoo uses CubOS' current three-config runtime surface: gantry, deck, and protocol. Mounted instruments are edited and saved inside gantry YAML.

## Local Config Storage

- Zoo reads and writes YAML configs from `configs/` by default.
- The active directory is exposed through `/api/settings` as `config_dir`.
- Operators can point Zoo at another config directory through the settings UI or API.
- Gantry YAMLs are read back through CubOS validation before Zoo returns or saves them; missing current fields must be filled and saved in the gantry editor.
- Protocol YAML `positions` mappings are preserved by the protocol editor save path.
- The protocol Validate button runs full CubOS setup validation for the selected gantry, deck, and protocol files. The older `/api/protocol/validate` endpoint remains a command-schema check only.
- Protocol runs are blocked while a gantry calibration warning is active. Connect and calibration remain available so first-time users can program the controller and clear the warning.
- Manual absolute `Move To` commands are checked against the loaded gantry `working_volume` before Zoo sends motion to CubOS.

## Gantry Calibration

- The Gantry Control panel includes a `Calibrate` wizard after a gantry YAML is loaded.
- The wizard is a serial, one-way workflow. Single-instrument: prepare/home with soft limits disabled, jog to set XY origin (soft limits restored on confirm), jog to the calibration block to capture Z from live WPos, then re-home to measure X/Y bounds and save. Multi-instrument: prepare/home, jog XY origin, re-home to capture XY bounds and move to deck center, jog the lowest instrument to the block to set Z, record each remaining instrument at the same point, then save.
- Calibration preserves `cnc.factory_z_travel_mm` as the out-of-box Z travel safety bound. Zoo uses `cnc.calibration_block_height_mm`, the recorded home-to-block travel, and the final homed readback to write `working_volume.z_min`, `working_volume.z_max`, and GRBL `max_travel_z`.
- `working_volume` remains the usable deck/WPos range. GRBL `max_travel_*` fields are controller soft-limit spans and include the configured homing pull-off reserve (`grbl_settings.homing_pull_off`, GRBL `$27`). For example, homed WPos `Z=91` with `$27=10` saves `working_volume.z_max=91` and `grbl_settings.max_travel_z=101`.
- During calibration Zoo sets `$10=0` for WPos status reporting and writes the machine's configured `$27` before homing. This avoids mixing GRBL MPos/WCO reporting with deck-origin WPos math.
- Multi-instrument gantries add a tool-recording step that writes instrument `offset_x`, `offset_y`, and `depth` values from a shared block point.
- The multi-instrument path automatically re-homes after XY origining, captures XY travel bounds, moves to deck center, and retracts Z after each tool record while controls are locked.
- If a calibration jog or automatic blocking retract triggers a GRBL alarm, the wizard stops jog repeats, locks calibration controls, tells the operator a limit was hit, and calls CubOS limit recovery to soft-reset/unlock and pull off opposite the failed jog. Once recovery succeeds, Zoo clears the lock and reports that calibration can continue.
- Calibration routes stay thin over CubOS `Gantry` methods for work-coordinate assignment, GRBL soft-limit programming, and limit recovery; Zoo does not send raw serial commands directly.
- Disconnect reports a failure if Zoo cannot restore calibration-disabled soft limits before closing the controller connection.

## Run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cd frontend
npm ci
cd ..
python -m zoo
```

Defaults:

- host: `127.0.0.1`
- port: `8742`
- browser auto-open: enabled

## Test And Build

- Backend tests: `pytest tests/`
- Frontend lint: `cd frontend && npm run lint`
- Frontend tests: `cd frontend && npm run test`
- Frontend build: `cd frontend && npm run build`

## Windows Operator Installer

The Windows installer builder lives in `installer/windows/`. It clones Zoo
`main` and CubOS `main`, builds the frontend, prepares an offline wheelhouse,
and emits an Inno Setup installer that installs an app-local Python runtime.

Build it on a Windows packaging machine with Git, Python 3.11, Node.js, and
Inno Setup 6:

```powershell
powershell -ExecutionPolicy Bypass -File .\installer\windows\build-installer.ps1
```

## Notes

- If `frontend/dist/` is missing, `python -m zoo` builds it automatically.
- Gantry operations, including calibration, are hardware-touching and should be treated as high risk.
- `frontend/README.md` is still the stock Vite template and is not authoritative documentation.
