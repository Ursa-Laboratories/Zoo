# Zoo

Web-based visualization and configuration UI for CubOS.

## CubOS dependency

Zoo installs CubOS directly from Git:

`cubos @ git+https://github.com/Ursa-Laboratories/CubOS.git@main`

Zoo should import CubOS from the installed package, not from a local CubOS checkout.

## Local config storage

Zoo reads and writes YAML configs from the repo-local `configs/` directory by default.
The active path is exposed through `/api/settings` as `config_dir`, and the UI lets you choose a different config directory with a browse button.

## Development

- Backend tests: `pytest tests/`
- Frontend tests: `cd frontend && npm test`
- Frontend build: `cd frontend && npm run build`
