import { describe, expect, it } from "vitest";
import {
  buildCalibratedConfig,
  calculateSingleInstrumentZCalibration,
  getCalibrationBlockHeight,
  getFactoryZTravel,
} from "./calibrationMath";
import type { GantryConfig } from "../../types";

function gantryConfig(): GantryConfig {
  return {
    serial_port: "/dev/ttyUSB0",
    gantry_type: "cub_xl",
    cnc: {
      homing_strategy: "standard",
      factory_z_travel_mm: 110,
      calibration_block_height_mm: 35,
      y_axis_motion: "head",
      safe_z: 120,
    },
    working_volume: {
      x_min: 0,
      x_max: 300,
      y_min: 0,
      y_max: 200,
      z_min: 0,
      z_max: 80,
    },
    grbl_settings: {
      max_travel_z: 80,
    },
    instruments: {
      asmi: {
        type: "asmi",
        vendor: "vernier",
        offset_x: 0,
        offset_y: 0,
        depth: 0,
      },
    },
  };
}

describe("factory Z calibration inputs", () => {
  it("returns rounded factory_z_travel_mm from config", () => {
    expect(getFactoryZTravel(gantryConfig())).toBe(110);
    expect(getCalibrationBlockHeight(gantryConfig())).toBe(35);
  });

  it("throws when factory_z_travel_mm is missing", () => {
    const config = gantryConfig();
    delete (config.cnc as unknown as Record<string, unknown>).factory_z_travel_mm;
    expect(() => getFactoryZTravel(config)).toThrow("cnc.factory_z_travel_mm");
  });

  it("throws when factory_z_travel_mm is zero", () => {
    const config = gantryConfig();
    config.cnc.factory_z_travel_mm = 0;
    expect(() => getFactoryZTravel(config)).toThrow("cnc.factory_z_travel_mm");
  });

  it("throws when factory_z_travel_mm is negative", () => {
    const config = gantryConfig();
    config.cnc.factory_z_travel_mm = -50;
    expect(() => getFactoryZTravel(config)).toThrow("cnc.factory_z_travel_mm");
  });

  it("throws when calibration_block_height_mm is missing", () => {
    const config = gantryConfig();
    delete (config.cnc as unknown as Record<string, unknown>).calibration_block_height_mm;
    expect(() => getCalibrationBlockHeight(config)).toThrow("cnc.calibration_block_height_mm");
  });
});

describe("calculateSingleInstrumentZCalibration", () => {
  it("handles scenario A where the instrument reaches deck bottom", () => {
    expect(calculateSingleInstrumentZCalibration({
      homeZ: 110,
      blockTouchZ: 60,
      blockHeight: 35,
      factoryZTravel: 110,
      homedZ: 85,
    })).toMatchObject({
      homeToBlockTravel: 50,
      remainingBelowBlock: 60,
      canReachDeckBottom: true,
      zMin: 0,
      zMax: 85,
      maxTravelZ: 85,
    });
  });

  it("handles scenario B where the instrument cannot reach deck bottom", () => {
    expect(calculateSingleInstrumentZCalibration({
      homeZ: 110,
      blockTouchZ: 10,
      blockHeight: 35,
      factoryZTravel: 110,
      homedZ: 135,
    })).toMatchObject({
      homeToBlockTravel: 100,
      remainingBelowBlock: 10,
      canReachDeckBottom: false,
      zMin: 25,
      zMax: 135,
      maxTravelZ: 110,
    });
  });
});

describe("buildCalibratedConfig", () => {
  it("preserves factory Z travel while saving calibrated bounds and soft limits", () => {
    const calibrated = buildCalibratedConfig({
      config: gantryConfig(),
      measuredVolume: { x: 398.5, y: 299.25, z: 96.75 },
      zMin: 0,
      zMax: 110,
      maxTravel: { x: 398.5, y: 299.25, z: 110 },
      isMulti: false,
      instruments: ["asmi"],
      instrumentPositions: {},
      referenceInstrument: "asmi",
      lowestInstrument: "asmi",
    });

    expect(calibrated.cnc.factory_z_travel_mm).toBe(110);
    expect(calibrated.cnc.safe_z).toBe(110);
    expect(calibrated.working_volume).toEqual({
      x_min: 0,
      x_max: 398.5,
      y_min: 0,
      y_max: 299.25,
      z_min: 0,
      z_max: 110,
    });
    expect(calibrated.grbl_settings?.max_travel_z).toBe(110);
  });

  it("does not update stale factory_z_travel_mm from calibrated max travel", () => {
    const config = gantryConfig();
    config.cnc.factory_z_travel_mm = 87;

    const calibrated = buildCalibratedConfig({
      config,
      measuredVolume: { x: 398.5, y: 299.25, z: 91.5 },
      zMin: 0,
      zMax: 91.5,
      maxTravel: { x: 398.5, y: 299.25, z: 91.5 },
      isMulti: false,
      instruments: ["asmi"],
      instrumentPositions: {},
      referenceInstrument: "asmi",
      lowestInstrument: "asmi",
    });

    expect(calibrated.cnc.factory_z_travel_mm).toBe(87);
    expect(calibrated.working_volume.z_max).toBe(91.5);
    expect(calibrated.grbl_settings?.max_travel_z).toBe(91.5);
  });
});
