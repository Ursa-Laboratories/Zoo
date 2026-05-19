import type { GantryConfig } from "../../types";

type CapturedPosition = {
  x: number;
  y: number;
  z: number;
};

export function getCalculatedZRange(config: GantryConfig): number {
  const value = Number(config.cnc.total_z_range);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Gantry config must seed cnc.total_z_range before calibration.");
  }
  return roundMm(value);
}

export function buildCalibratedConfig({
  config,
  measuredVolume,
  zMin,
  zMax,
  maxTravel,
  isMulti,
  instruments,
  instrumentPositions,
  referenceInstrument,
  lowestInstrument,
}: {
  config: GantryConfig;
  measuredVolume: CapturedPosition;
  zMin: number;
  zMax: number;
  maxTravel: CapturedPosition;
  isMulti: boolean;
  instruments: string[];
  instrumentPositions: Record<string, CapturedPosition>;
  referenceInstrument: string;
  lowestInstrument: string;
}): GantryConfig {
  const next = structuredClone(config);
  next.working_volume = {
    x_min: 0,
    x_max: roundMm(measuredVolume.x),
    y_min: 0,
    y_max: roundMm(measuredVolume.y),
    z_min: roundMm(zMin),
    z_max: roundMm(zMax),
  };
  if (next.cnc.safe_z != null) {
    next.cnc.safe_z = Math.min(Math.max(roundMm(next.cnc.safe_z), roundMm(zMin)), roundMm(zMax));
  }
  next.grbl_settings = {
    ...(next.grbl_settings ?? {}),
    status_report: 0,
    soft_limits: true,
    homing_enable: true,
    max_travel_x: maxTravel.x,
    max_travel_y: maxTravel.y,
    max_travel_z: maxTravel.z,
  };

  if (isMulti) {
    const reference = instrumentPositions[referenceInstrument];
    const lowest = instrumentPositions[lowestInstrument];
    if (!reference || !lowest) {
      throw new Error("Reference and lowest instrument positions are required.");
    }
    for (const name of instruments) {
      const coords = instrumentPositions[name];
      if (!coords || !next.instruments[name]) continue;
      next.instruments[name] = {
        ...next.instruments[name],
        offset_x: roundMm(requireFinite(reference.x - coords.x, `${name} offset_x`)),
        offset_y: roundMm(requireFinite(reference.y - coords.y, `${name} offset_y`)),
        depth: roundMm(requireFinite(coords.z - lowest.z, `${name} depth`)),
      };
    }
  }

  return next;
}

function roundMm(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} is not a valid number (${value}); captured position data may be incomplete.`);
  }
  return value;
}
