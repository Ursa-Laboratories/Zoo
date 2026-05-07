# Zoo Repo Overview

## Purpose

`Zoo` is a local web UI for `CubOS`. It edits YAML configs, visualizes live or simulated deck state, controls gantry motion, and triggers protocol execution through CubOS APIs and classes.

## Key Directories

| Path | Purpose |
| --- | --- |
| `zoo/app.py` | FastAPI app factory |
| `zoo/__main__.py` | Startup entrypoint |
| `zoo/config.py` | `ZOO_*` settings and config-directory handling |
| `zoo/routers/` | REST endpoints for gantry, deck, protocol, raw, settings |
| `zoo/services/` | YAML file helpers and the copied Digital Sim exporter core |
| `frontend/src/` | React + TypeScript application |
| `configs/` | Default local config store, empty by default in this checkout |
| `tests/` | Backend tests |

## Main Entrypoints

- `python -m zoo`
- `uvicorn zoo.app:create_app --factory`
- `cd frontend && npm run dev`

## Viewer Model

- The right-side viewer defaults to Live + Top, preserving the previous Zoo SVG top view.
- Simulation mode calls `/api/simulation/digital-twin`, which resolves the selected gantry/deck/protocol filenames and delegates loading and motion expansion to CubOS-backed Digital Sim exporter code.
- 3D mode uses Three.js inside Zoo's frontend with a Digital Sim-style viewport/sidebar layout for path sampling, current pose, protocol timeline, and warnings. It preserves CubOS deck-frame semantics by mapping CubOS `(x, y, z)` into Three.js `(x, z, -y)`.
- Protocol execution has two explicit targets: Simulation builds the Digital Sim timeline/path and does not touch hardware; Hardware uses the existing `/api/protocol/run` endpoint with the connected gantry.

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

## Dependencies On Other Repos Or Services

- Depends on `CubOS` from Git in `pyproject.toml`
- Requires Node.js for frontend development and build
- Talks directly to local gantry hardware through CubOS when operators use motion endpoints
- Simulation export is local and file-backed; it does not connect to hardware

## Known Pitfalls

- The repo currently has an empty default `configs/` directory; first-time users need to populate or redirect it.
- `python -m zoo` may build the frontend automatically if `frontend/dist/` is absent.
- The shared gantry instance is process-local and serial access is deliberately locked.
- `raw` endpoints bypass schema-aware editing and can write malformed YAML if used carelessly.
- The checked-in frontend README is a template and not authoritative project documentation.
- CubOS staging no longer uses a separate mounted-instrument config in Zoo; instruments belong in gantry YAML.
- The simulation route must stay a thin adapter over CubOS/Digital Sim logic. Do not add a second validation or hardware-control path in Zoo.
