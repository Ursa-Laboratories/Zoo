import type { GantryConfig } from "../../types";

type CapturedPosition = {
  x: number;
  y: number;
  z: number;
};

export type ZCalibrationResult = {
  blockHeight: number;
  factoryZTravel: number;
  homeZ: number;
  blockTouchZ: number;
  homeToBlockTravel: number;
  remainingBelowBlock: number;
  canReachDeckBottom: boolean;
  zMin: number;
  zMax: number;
  maxTravelZ: number;
};

export function getFactoryZTravel(config: GantryConfig): number {
  const value = Number(config.cnc.factory_z_travel_mm ?? config.cnc.total_z_range ?? config.cnc.total_z_height);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Gantry config must seed cnc.factory_z_travel_mm before calibration.");
  }
  return roundMm(value);
}

export function getCalibrationBlockHeight(config: GantryConfig): number {
  const value = Number(config.cnc.calibration_block_height_mm);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Gantry config must define cnc.calibration_block_height_mm before block calibration.");
  }
  return roundMm(value);
}

export function getCalculatedZRange(config: GantryConfig): number {
  return getFactoryZTravel(config);
}

export function getConfiguredHomingPullOff(config: GantryConfig): number {
  const raw = config.grbl_settings?.homing_pull_off;
  if (raw == null) {
    throw new Error(
      "grbl_settings.homing_pull_off is not set. Add a non-negative value to the gantry YAML and save before calibrating.",
    );
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `grbl_settings.homing_pull_off must be a non-negative finite number (got ${raw}). Fix the gantry YAML and save.`,
    );
  }
  return roundMm(value);
}

export function calculateSingleInstrumentZCalibration({
  homeZ,
  blockTouchZ,
  blockHeight,
  factoryZTravel,
  homedZ,
}: {
  homeZ: number;
  blockTouchZ: number;
  blockHeight: number;
  factoryZTravel: number;
  homedZ?: number;
}): ZCalibrationResult {
  for (const [label, value] of [
    ["home Z", homeZ],
    ["block touch Z", blockTouchZ],
    ["block height", blockHeight],
    ["factory Z travel", factoryZTravel],
  ] as const) {
    if (!Number.isFinite(value)) {
      throw new Error(`${label} must be a finite number.`);
    }
  }
  if (blockHeight <= 0) {
    throw new Error("Calibration block height must be positive.");
  }
  if (factoryZTravel <= 0) {
    throw new Error("Factory Z travel must be positive.");
  }
  const travelFromHomeToBlock = roundMm(homeZ - blockTouchZ);
  if (travelFromHomeToBlock <= 0) {
    throw new Error("Block touch Z must be below the homed Z position.");
  }
  if (travelFromHomeToBlock > roundMm(factoryZTravel + 0.001)) {
    throw new Error("Home-to-block travel exceeds the configured factory Z travel.");
  }
  const remainingBelowBlock = roundMm(factoryZTravel - travelFromHomeToBlock);
  const canReachDeckBottom = remainingBelowBlock + 0.001 >= blockHeight;
  const zMin = canReachDeckBottom ? 0 : roundMm(blockHeight - remainingBelowBlock);
  const zMax = roundMm(homedZ ?? travelFromHomeToBlock + blockHeight);
  const maxTravelZ = roundMm(zMax - zMin);
  if (maxTravelZ <= 0) {
    throw new Error("Calibrated Z travel span must be positive.");
  }
  return {
    blockHeight: roundMm(blockHeight),
    factoryZTravel: roundMm(factoryZTravel),
    homeZ: roundMm(homeZ),
    blockTouchZ: roundMm(blockTouchZ),
    homeToBlockTravel: travelFromHomeToBlock,
    remainingBelowBlock,
    canReachDeckBottom,
    zMin,
    zMax,
    maxTravelZ,
  };
}

export function calculateSingleInstrumentZRange({
  homeZ,
  blockTouchZ,
  blockHeight,
}: {
  homeZ: number;
  blockTouchZ: number;
  blockHeight: number;
}): number {
  return roundMm(homeZ - blockTouchZ + blockHeight);
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
