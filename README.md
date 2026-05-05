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

## Notes

- If `frontend/dist/` is missing, `python -m zoo` builds it automatically.
- Gantry operations are hardware-touching and should be treated as high risk.
- `frontend/README.md` is still the stock Vite template and is not authoritative documentation.
