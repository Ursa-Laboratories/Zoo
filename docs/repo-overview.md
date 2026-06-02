# Zoo Repo Overview

## Purpose

`Zoo` is a local web UI for `CubOS`. It edits YAML configs, visualizes deck state, controls gantry motion, and triggers protocol execution through CubOS APIs and classes.
Protocol editing exposes top-level `positions` mappings in a separate Named
Positions panel and saves them with the step list. The protocol Validate button
calls CubOS offline setup validation for the selected gantry, deck, and
protocol files rather than only checking command schemas.
Malformed config YAML is surfaced as a load error, and hardware controls stay
disabled until the selected gantry file loads through CubOS validation. Deck
and gantry save paths validate the converted CubOS YAML before overwriting the
target file.
Protocol runs are blocked while Zoo has an active gantry calibration warning;
operators can still connect and calibrate so new controllers can be brought into
the expected GRBL state.

The gantry control surface also exposes a calibration wizard that turns CubOS'
`setup/calibrate_gantry.py` flow into a guided UI. Operators still use CubOS
movement semantics through Zoo jog/home/connect endpoints; the wizard saves the
calibrated YAML through the same schema-validated gantry config path.
The gantry control surface includes an Advanced mode for live-controller
recovery and inspection through CubOS `Gantry` methods: read GRBL settings,
send one numeric GRBL setting, clear alarms, reset + unlock, feed hold, and
jog cancel.
The wizard is intentionally serial: after the operator selects the reference
and lowest instrument, Zoo runs the blocking controller-prep/home steps, locks
controls during automatic home/center/retract moves, and only exposes the next
operator action when the current step completes.

The protocol editor derives operator choices from the loaded deck, gantry, and
protocol file: plate fields use available well plates, instrument fields use
mounted instruments, position fields use deck targets plus top-level protocol
positions, and measurement method fields use instrument-aware options. ASMI
indentation method options expose force limit, step size, baseline samples, and
measure-with-return controls.
Protocol execution is gated on the gantry position poll reporting an active
connection.

## Key Directories

| Path | Purpose |
| --- | --- |
| `zoo/app.py` | Backend FastAPI app factory; import path stays `zoo` |
| `zoo/__main__.py` | Backend startup entrypoint for `python -m zoo` |
| `zoo/config.py` | Backend `ZOO_*` settings and config-directory handling |
| `zoo/routers/` | Backend REST endpoints for gantry, deck, protocol, raw, settings |
| `zoo/services/` | Backend YAML file helpers |
| `frontend/src/` | `zoo-frontend` React + TypeScript application |
| `frontend/src/components/gantry/` | Gantry jog/readout controls and calibration wizard |
| `configs/` | Default local config store, empty by default in this checkout |
| `tests/` | Backend tests |

## Main Entrypoints

- `python -m zoo`
- `uvicorn zoo.app:create_app --factory`
- `cd frontend && npm run dev`

## How To Run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cd frontend
npm ci
cd ..
python -m zoo
```

## How To Test

Backend:

```bash
pytest tests/
```

Frontend:

```bash
cd frontend
npm run lint
npm run test
npm run build
```

## Lint And Format

- Frontend lint command exists: `npm run lint`
- No backend formatter or linter configuration was confirmed in the first pass

## Deployment Or Release Role

- Local operator-facing UI
- Depends on the published or installable `CubOS` package
- Python distribution name: `zoo-backend`
- Frontend package name: `zoo-frontend`
- `installer/windows/` builds a Windows operator installer from Zoo `main` and
  CubOS `main`; the generated installer includes a private Python runtime,
  prebuilt frontend assets, an offline wheelhouse, Start Menu shortcuts, config
  seeding, logs, and diagnostic export.

## Dependencies On Other Repos Or Services

- Depends on `CubOS` from Git in `pyproject.toml`
- Requires Node.js for frontend development and build
- Deck editing and visualization use CubOS' current deck YAML field names (`length`, `width`, `height`, `x_offset`, `y_offset`, `diameter`).
- Talks directly to local gantry hardware through CubOS when operators use motion endpoints
- Manual absolute `Move To` commands are validated against the connected gantry's loaded `working_volume` before Zoo starts motion.
- Gantry calibration delegates work-coordinate, soft-limit, and limit-recovery operations to CubOS `Gantry`/recovery methods; Zoo only sequences the operator UI and YAML save. During XY origining, Zoo may temporarily disable stale soft limits and restores them on cancel, single-instrument XY completion, disconnect, or successful soft-limit programming. Zoo preserves `cnc.factory_z_travel_mm` as the out-of-box safety bound, reads `cnc.calibration_block_height_mm`, and writes calibrated Z bounds from home-to-block travel plus the final homed readback. `working_volume` is the usable deck/WPos range; saved GRBL `max_travel_*` values are controller soft-limit spans that include the `$27` homing pull-off reserve. Calibration sets `$10=0` for WPos reports and writes the machine's configured `homing_pull_off` before homing so MPos/WCO reporting does not leak into deck-origin math. If an interactive calibration jog or automatic blocking retract trips a GRBL alarm, Zoo stops repeated jogs, locks calibration controls, tells the operator a limit was hit, and calls CubOS limit recovery before allowing calibration to continue. Disconnect surfaces soft-limit restore failures instead of silently reporting success.
- Advanced gantry recovery endpoints still route through CubOS `Gantry`; Zoo does not expose arbitrary raw serial command entry.

## Known Pitfalls

- The repo currently has an empty default `configs/` directory; first-time users need to populate or redirect it.
- `python -m zoo` may build the frontend automatically if `frontend/dist/` is absent.
- The shared gantry instance is process-local and serial access is deliberately locked.
- `raw` endpoints bypass schema-aware editing and can write malformed YAML if used carelessly.
- The checked-in frontend README is a template and not authoritative project documentation.
- Current CubOS configs no longer use a separate mounted-instrument config in Zoo; instruments belong in gantry YAML.
- Calibration can write a new gantry YAML and optionally program live GRBL soft-limit settings, so it should not be exercised without hardware clearance and an E-stop within reach.
