# Protocol stop button

Issue: Ursa-Laboratories/CubOS#185 (implemented in Zoo)

## Changed
- Added `POST /api/protocol/stop` to request a CubOS feed-hold stop for the connected gantry.
- The stop endpoint can issue the stop request even while `/api/protocol/run` holds the serial lock for the active protocol run.
- Added a Stop button to the protocol editor while a run is active, with `Stopping...` feedback.
- Added backend and frontend tests for the stop path.

## Verification
- Focused backend tests: `17 passed in 1.64s`.
- Full backend tests: `107 passed, 1 failed in 7.64s`; failure was `tests/test_settings_router.py::test_browse_directory_returns_selected_config_dir` because the Python environment lacks `tkinter`.
- Frontend build: passed; Vite built production assets in 1.97s.
- Frontend tests: `14 passed / 106 tests`.
- `git diff --check`: passed.
