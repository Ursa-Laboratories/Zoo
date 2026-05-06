# Digital Sim Viewer Integration

Status: complete

## Goal
- Add Digital Sim protocol simulation and 3D viewing to Zoo while keeping Top/2D as the default viewer.
- Let operators choose Live vs Simulation positions and Simulation vs Hardware protocol runs.

## Findings
- Zoo already has the live top-view deck renderer and `/api/gantry/position` polling.
- Digital Sim's exporter is loader-backed and emits a `digital-twin.v1` bundle with protocol timeline, path, labware AABBs, and warnings.
- Simulation export is a Zoo route adapter over selected gantry/deck/protocol YAML paths and does not command hardware.
- Live 3D viewing is adapted from Zoo's existing live deck/gantry endpoint data; protocol execution on hardware remains through the existing CubOS-backed run path.

## Files
- `zoo/routers/simulation.py`
- `zoo/services/digital_twin/*`
- `frontend/src/components/viewer/*`
- `frontend/src/App.tsx`
- `frontend/src/api/client.ts`
- `frontend/src/types/index.ts`
- `frontend/src/components/editor/ProtocolEditor.tsx`
- `tests/test_simulation_router.py`
- `frontend/src/App.test.tsx`
- `README.md`
- `docs/repo-overview.md`

## Verification
- `git diff --check` passed.
- `.venv/bin/python -m py_compile zoo/routers/simulation.py zoo/services/digital_twin/exporter.py zoo/services/digital_twin/geometry.py zoo/services/digital_twin/motion.py tests/test_simulation_router.py` passed.
- `node -e "JSON.parse(...)"` for `frontend/package.json` and `frontend/package-lock.json` passed.
- Installed local CubOS into Zoo's venv for testing with `.venv/bin/python -m pip install -e /home/achan/.openclaw/workspace/Ursa-CubOS`; installed missing venv dependency `pydantic-settings`.
- `.venv/bin/python -m pytest tests/test_simulation_router.py tests/test_protocol_router.py` passed: 13 tests.
- `cd frontend && npm ci --ignore-scripts` passed: added 262 packages; npm audit reported existing 8 vulnerabilities (3 moderate, 5 high).
- `cd frontend && npm run lint` passed.
- `cd frontend && npm run test -- --run` passed: 3 files, 12 tests.
- `cd frontend && npm run build` passed; Vite emitted a non-fatal chunk-size warning for the 770.75 kB JS bundle.

## Notes
- `.codex` remained untracked and untouched.
- `pip install -e .` is currently blocked by hatch metadata direct-reference handling for the CubOS Git dependency; direct dependency installs plus the local CubOS editable install were enough to run the backend tests.
