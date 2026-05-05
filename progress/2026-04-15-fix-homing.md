# fix-homing: respect gantry yaml homing_strategy

Status: complete

## Goal
Gantry YAMLs uploaded via Zoo UI with `cnc.homing_strategy: standard` were
still doing XY-only homing. The POST `/api/gantry/home` route was hardcoded
to call an XY-only method instead of delegating to CubOS.

## Findings
- `zoo/routers/gantry.py:84` called `_gantry.home_xy()` unconditionally.
- CubOS's current `Gantry.home()` owns homing behavior. Older strategy names
  from this note are retired and are no longer part of Zoo's active config
  surface.
- `zoo/models/gantry.py:20-23` already models `cnc.homing_strategy`, and
  `connect()` passes the full YAML dict into `Gantry(config=config)`, so
  the strategy reaches the dispatcher correctly.
- Per `CLAUDE.md` ("Never recreate CubOS functionality"), Zoo must not
  re-implement the dispatch; the router should just call `Gantry.home()`.

## Files
- `zoo/routers/gantry.py` — call `_gantry.home()`; update docstring.
- `tests/test_gantry_router.py` — new; asserts the route delegates to
  `Gantry.home()` and does not call `home_xy`.

## Verification
- `python -m py_compile` / `ast.parse` confirms the router and the new test
  parse cleanly.
- Running `pytest tests/` fails collection for ALL router tests with
  `ModuleNotFoundError: No module named 'board'` — the venv still has the
  pre-migration `panda-core` editable install rather than `cubos`. This is
  a pre-existing environment issue (see `progress/2026-04-08-cubos-package-migration.md`)
  and is not caused by this change. Rebuild the venv (`pip install -e .`
  or re-sync requirements) to exercise the tests end to end.

## Next Steps
- Re-sync the venv so `cubos` replaces `panda-core`; then run
  `pytest tests/test_gantry_router.py` to confirm green.
- Consider a hardware smoke test with a YAML that sets
  `cnc.homing_strategy: standard` to confirm full homing (Z first, then XY).
