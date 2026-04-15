import type { Coordinate3D, InstrumentConfig } from "../types";

export interface GantryTargetTranslation {
  gantryHeadZ: number;
  approachZ: number;
  actionZ: number;
}

export function translateDeckTargetForInstrument(
  target: Coordinate3D,
  instrument: InstrumentConfig,
): GantryTargetTranslation {
  const depth = toNumber(instrument.depth);
  const safeApproachHeight = toNumber(instrument.safe_approach_height);
  const measurementHeight = toNumber(instrument.measurement_height);

  return {
    gantryHeadZ: target.z - depth,
    approachZ: target.z + safeApproachHeight,
    actionZ: target.z + measurementHeight,
  };
}

function toNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
}
