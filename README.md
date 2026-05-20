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

## Gantry Calibration

- The Gantry Control panel includes a `Calibrate` wizard after a gantry YAML is loaded.
- Gantry Control also has an `Advanced` mode for connected-controller recovery and inspection: read live GRBL settings, send one numeric GRBL setting through CubOS, clear alarms, reset + unlock, feed hold, and jog cancel.
- The wizard is a serial, one-way workflow. Single-instrument: prepare/home with soft limits disabled, jog to set XY origin (soft limits restored on confirm), jog to the calibration block to capture Z from live WPos, then re-home to measure X/Y bounds and save. Multi-instrument: prepare/home, jog XY origin, re-home to capture XY bounds and move to deck center, jog the lowest instrument to the block to set Z, record each remaining instrument at the same point, then save.
- Calibration preserves the input gantry YAML's seeded `cnc.total_z_range`; Zoo uses that calculated Z range for `working_volume.z_max` and GRBL `max_travel_z` instead of rewriting the range from homed readback.
- Multi-instrument gantries add a tool-recording step that writes instrument `offset_x`, `offset_y`, and `depth` values from a shared block point.
- The multi-instrument path automatically re-homes after XY origining, captures XY travel bounds, moves to deck center, and retracts Z after each tool record while controls are locked.
- If a calibration jog triggers a GRBL alarm, the wizard stops jog repeats, disables jog controls, and prompts the operator to unlock before jogging away from the limit.
- Calibration routes stay thin over CubOS `Gantry` methods for work-coordinate assignment and GRBL soft-limit programming; Zoo does not send raw serial commands directly.

## Protocol Editing

- The protocol editor builds step fields from CubOS command schemas and uses the loaded deck and gantry config to offer dropdowns for plates, instruments, deck positions, and measurement methods.
- ASMI indentation steps expose first-class method options, including `force_limit`, `step_size`, `baseline_samples`, and `measure_with_return`, which are saved into `method_kwargs`.

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
