# Gantry Safety Hardening

## Summary

- Kept connect/calibration available when GRBL settings differ from the selected gantry YAML, so first-time controller setup can still enter the calibration flow.
- Blocked protocol runs while a gantry calibration warning is active.
- Added working-volume checks before manual absolute `Move To` commands start motion.
- Made blocking jog/retract alarm failures use the same recoverable alarm response as interactive jogs.
- Made disconnect report soft-limit restore failures instead of silently returning success.

## Verification

- Backend router tests should cover the new hardening paths in `tests/test_gantry_router.py` and `tests/test_protocol_router.py`.
- Frontend manual move guard is covered in `frontend/src/components/gantry/GantryPositionWidget.test.tsx`.
