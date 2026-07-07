# 2026-07-06 — POST /api/protocol/run-bundle (PiCub station contract in Zoo)

Ported the PiCub_protocol_sender station-worker `/run-protocol` contract into
Zoo so operators can keep YAMLs on their own machine and send them to a
Zoo-running station (e.g. the `cub.local` Raspberry Pi appliance) per run,
without writing into the shared config library.

## What was added

- `zoo/services/bundle_runs.py` — `BundleRunDir` (per-run artifact dir:
  gantry/deck/protocol YAML + meta.json + result.json/error.txt),
  `sanitize_run_id` (traversal-safe), `run_bundle_mock` (CubOS
  `setup_protocol(gantry=None, mock_mode=True)` offline execution),
  `to_jsonable` (CubOS result serialization). Ported from
  `PiCub_protocol_sender/station_worker/{runs,worker,jsonify}.py`.
- `POST /api/protocol/run-bundle` in `zoo/routers/protocol.py` — stages the
  bundle, then real runs go through `gantry_router.run_protocol_on_session`
  (persistent session, same as `/run`, same `begin_run`/`end_run` 409 gate);
  `mock_mode` executes offline. Result JSON (incl. per-step `results`) is
  returned and stored in the run dir.
- `GET /api/protocol/bundle-runs/{run_id}` — audit/replay lookup.
- `ZooSettings.bundle_run_dir` (+ `bundle_runs_dir` property, env
  `ZOO_BUNDLE_RUN_DIR`); defaults to `bundle_runs/` next to the active config
  dir (`/var/lib/cub/bundle_runs` on the Pi appliance).

## Contract differences vs PiCub station worker

- No per-station instrument/command allow-list and no gantry/deck sha256
  pinning (CubOS setup validation still applies). Revisit if bundle runs are
  exposed beyond the trusted LAN.
- Real runs REQUIRE the gantry to be connected via Zoo first (persistent
  session), instead of PiCub's connect-per-run; this respects Zoo's
  calibration-warning and session-safety gates.
- `run_id` is sanitized the same way, but a run_id that reduces to `.`/`..`
  becomes `run` and traversal cannot escape the bundle dir (tested).

## Tests

`tests/test_bundle_runs.py` — 8 tests: offline end-to-end execution of the
CubOS `configs/sim/pipette_tip_transfer` bundle (skips if the sibling CubOS
checkout is absent), session routing/labels for real runs (monkeypatched),
busy-gate 409, invalid-YAML 400 + error.txt, traversal safety, field
requirements, 404 lookup. Full backend suite: 199 passed, 1 pre-existing skip.
