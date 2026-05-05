# Zoo Agent Guide

Zoo is a thin UI layer over CubOS.


## Retrieval-Led Agent Index

Before coding, prefer repo source/docs over model memory. Use `docs/agent-index.md` as the compact routing map for where to look before touching backend routes, CubOS integration, frontend config editors, coordinate display, tests, or docs.

Key rule: Zoo stays a thin layer over CubOS. Read the relevant source/docs from the index instead of relying on optional skill invocation or remembered semantics.

## Core Rules

- Do not duplicate CubOS validation, protocol, or hardware logic here.
- Routers should stay thin and rely on CubOS loaders, schemas, registries, and runtime classes.
- Frontend types should model API payloads, not become a second source of truth for CubOS semantics.
- Keep hardware-touching behavior explicit. Gantry routes can home, jog, move, unlock, and run protocols.

## Key Paths

- `zoo/app.py`
- `zoo/__main__.py`
- `zoo/config.py`
- `zoo/routers/`
- `zoo/services/`
- `frontend/src/api/`
- `frontend/src/components/`
- `frontend/src/hooks/`
- `tests/`

## Runtime Model

1. Frontend collects config edits.
2. Zoo writes YAML to the active config directory.
3. Zoo reads the same files back through CubOS loaders or schemas.
4. Derived results are returned to the UI.

## Commands

```bash
pytest tests/
cd frontend && npm run lint
cd frontend && npm run test
cd frontend && npm run build
python -m zoo
```

## Coordinate Convention

Zoo follows CubOS' deck-origin frame directly: front-left-bottom origin, +X right, +Y back, +Z up. Do not negate X/Y in the frontend. Jog controls send CubOS-relative deltas as-is: left=-X, right=+X, up=+Y, down=-Y, X=+Z, Z=-Z.

## Local State

- Default config directory: `configs/`
- Settings are exposed through `/api/settings`
- Frontend build output lives in `frontend/dist/`

## Documentation Contract

Keep these files updated when behavior changes:

- `README.md`
- `docs/repo-overview.md`
- `../docs/*` for cross-repo effects
