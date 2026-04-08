# Zoo — CubOS Frontend

Zoo is a web UI (FastAPI + React) for configuring and controlling CubOS. It is **not** a standalone system — it is a thin frontend layer over CubOS.

## Architecture Rules

- **Never break CubOS abstractions.** Zoo must use CubOS's public classes and methods (e.g. `Gantry`, `Gantry.move_to`, `Gantry.get_coordinates`, `load_deck_from_yaml`, `BoardYamlSchema`) — never send raw serial/GRBL commands, never reimplement driver logic, never bypass CubOS to talk to hardware directly.
- **Never recreate CubOS functionality.** If CubOS already provides it (YAML schema validation, well position calculation, movement, protocol execution, deck resolution, instrument control), use it. Don't duplicate or rewrite it in Zoo.
- **Zoo routers are thin.** They write YAML from user input, read it back via CubOS loaders/schemas, and return the results. Business logic and validation belong in CubOS, not in Zoo.
- **Zoo models are API response shapes only.** They describe what the REST API returns (e.g. `GantryPosition`, `DeckResponse`). They must not duplicate CubOS's Pydantic schemas or validation logic.
- **CubOS is imported via sys.path** pointing at `{cubos_path}/src`. The path is configured via `ZOO_CUBOS_PATH` env var (default: local `zoo/CubOS`). `ZOO_PANDA_CORE_PATH` is accepted only as a legacy compatibility alias.

## How Config Tabs Work

Each config tab (Deck, Board, Gantry) follows the same pattern:
1. **Frontend** collects user input via form fields
2. **PUT** sends the raw config dict as JSON → Zoo writes it as YAML to `CubOS/configs/`
3. **GET** reads YAML → validates/loads via CubOS loaders → returns structured JSON
4. CubOS's loaders handle all validation and derived data (e.g. well position calculation)

## Project Structure

```
zoo/
  app.py              # FastAPI app factory
  config.py           # ZooSettings (pydantic-settings)
  models/             # API response shapes only (gantry, protocol)
  routers/            # Thin FastAPI routers (deck, board, gantry, protocol, raw)
  services/           # yaml_io helper
frontend/
  src/
    api/client.ts     # API client functions
    types/index.ts    # TypeScript types describing CubOS YAML shapes
    hooks/            # TanStack Query hooks
    components/       # React components
```

## Frontend

- React + TypeScript + Vite
- TanStack Query for server state
- Inline styles (no CSS framework)
- `npm run build` from `frontend/` — output goes to `frontend/dist/`, served by FastAPI

## Commands

- **Frontend build:** `cd frontend && npm run build`
- **Run server:** `python -m zoo` (or `uvicorn zoo.app:create_app --factory`)
- **Backend tests:** `pytest tests/`
