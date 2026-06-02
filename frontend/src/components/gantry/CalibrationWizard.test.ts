import { describe, expect, it } from "vitest";
import {
  buildCalibratedConfig,
  calculateSingleInstrumentZCalibration,
  calculateSingleInstrumentZRange,
  getCalibrationBlockHeight,
  getCalculatedZRange,
  getConfiguredHomingPullOff,
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

  it("accepts total_z_range from older CubOS gantry payloads", () => {
    const config = gantryConfig();
    delete (config.cnc as unknown as Record<string, unknown>).factory_z_travel_mm;
    config.cnc.total_z_range = 87;
    expect(getFactoryZTravel(config)).toBe(87);
    expect(getCalculatedZRange(config)).toBe(87);
  });

  it("accepts total_z_height from older CubOS gantry payloads", () => {
    const config = gantryConfig();
    delete (config.cnc as unknown as Record<string, unknown>).factory_z_travel_mm;
    delete (config.cnc as unknown as Record<string, unknown>).total_z_range;
    config.cnc.total_z_height = 88.1234;
    expect(getFactoryZTravel(config)).toBe(88.123);
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

  it("requires an explicit homing pull-off for client-computed soft limits", () => {
    const config = gantryConfig();
    expect(() => getConfiguredHomingPullOff(config)).toThrow("grbl_settings.homing_pull_off");
    config.grbl_settings = { ...config.grbl_settings, homing_pull_off: 10 };
    expect(getConfiguredHomingPullOff(config)).toBe(10);
  });

  it("rejects invalid homing pull-off values", () => {
    const config = gantryConfig();
    config.grbl_settings = { homing_pull_off: -1 };
    expect(() => getConfiguredHomingPullOff(config)).toThrow("non-negative finite number");
    config.grbl_settings = { homing_pull_off: Number.NaN };
    expect(() => getConfiguredHomingPullOff(config)).toThrow("non-negative finite number");
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

  it("estimates zMax from travel when homedZ is omitted", () => {
    const result = calculateSingleInstrumentZCalibration({
      homeZ: 110,
      blockTouchZ: 60,
      blockHeight: 35,
      factoryZTravel: 110,
    });
    // homeToBlockTravel = 110 - 60 = 50; estimated zMax = 50 + 35 = 85
    expect(result.homeToBlockTravel).toBe(50);
    expect(result.zMax).toBe(85);
    expect(result.zMin).toBe(0);
    expect(result.maxTravelZ).toBe(85);
  });

  it("throws when blockTouchZ is at or above homeZ", () => {
    expect(() => calculateSingleInstrumentZCalibration({
      homeZ: 50,
      blockTouchZ: 55,
      blockHeight: 35,
      factoryZTravel: 110,
    })).toThrow("Block touch Z must be below");
  });

  it("throws when blockTouchZ equals homeZ", () => {
    expect(() => calculateSingleInstrumentZCalibration({
      homeZ: 110,
      blockTouchZ: 110,
      blockHeight: 35,
      factoryZTravel: 110,
    })).toThrow("Block touch Z must be below");
  });

  it("throws when home-to-block travel exceeds factory Z travel", () => {
    expect(() => calculateSingleInstrumentZCalibration({
      homeZ: 110,
      blockTouchZ: 0,
      blockHeight: 35,
      factoryZTravel: 80,
    })).toThrow("exceeds the configured factory Z travel");
  });

  it("throws when any input is non-finite", () => {
    expect(() => calculateSingleInstrumentZCalibration({
      homeZ: NaN,
      blockTouchZ: 60,
      blockHeight: 35,
      factoryZTravel: 110,
    })).toThrow("must be a finite number");

    expect(() => calculateSingleInstrumentZCalibration({
      homeZ: 110,
      blockTouchZ: Infinity,
      blockHeight: 35,
      factoryZTravel: 110,
    })).toThrow("must be a finite number");
  });

  it("throws when blockHeight is zero or negative", () => {
    expect(() => calculateSingleInstrumentZCalibration({
      homeZ: 110,
      blockTouchZ: 60,
      blockHeight: 0,
      factoryZTravel: 110,
    })).toThrow("Calibration block height must be positive");

    expect(() => calculateSingleInstrumentZCalibration({
      homeZ: 110,
      blockTouchZ: 60,
      blockHeight: -5,
      factoryZTravel: 110,
    })).toThrow("Calibration block height must be positive");
  });

  it("throws when factoryZTravel is zero or negative", () => {
    expect(() => calculateSingleInstrumentZCalibration({
      homeZ: 110,
      blockTouchZ: 60,
      blockHeight: 35,
      factoryZTravel: 0,
    })).toThrow("Factory Z travel must be positive");
  });

  it("throws when the calibrated travel span is non-positive", () => {
    expect(() => calculateSingleInstrumentZCalibration({
      homeZ: 10,
      blockTouchZ: 5,
      blockHeight: 1,
      factoryZTravel: 5,
      homedZ: 0,
    })).toThrow("Calibrated Z travel span must be positive");
  });

  it("calculates a legacy single-instrument z range", () => {
    expect(calculateSingleInstrumentZRange({
      homeZ: 110,
      blockTouchZ: 60.1234,
      blockHeight: 35,
    })).toBe(84.877);
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

  it("saves controller max travel separately from usable working volume", () => {
    const calibrated = buildCalibratedConfig({
      config: gantryConfig(),
      measuredVolume: { x: 386, y: 250.5, z: 91 },
      zMin: 0,
      zMax: 91,
      maxTravel: { x: 396, y: 260.5, z: 101 },
      isMulti: false,
      instruments: ["asmi"],
      instrumentPositions: {},
      referenceInstrument: "asmi",
      lowestInstrument: "asmi",
    });

    expect(calibrated.working_volume).toEqual({
      x_min: 0,
      x_max: 386,
      y_min: 0,
      y_max: 250.5,
      z_min: 0,
      z_max: 91,
    });
    expect(calibrated.grbl_settings?.max_travel_x).toBe(396);
    expect(calibrated.grbl_settings?.max_travel_y).toBe(260.5);
    expect(calibrated.grbl_settings?.max_travel_z).toBe(101);
  });

  it("computes multi-instrument offsets from captured positions", () => {
    const config = gantryConfig();
    config.instruments = {
      reference: { type: "asmi", vendor: "vernier", offset_x: 0, offset_y: 0, depth: 0 },
      probe: { type: "asmi", vendor: "vernier", offset_x: 0, offset_y: 0, depth: 0 },
      missing_in_config: { type: "asmi", vendor: "vernier", offset_x: 0, offset_y: 0, depth: 0 },
    };

    const calibrated = buildCalibratedConfig({
      config,
      measuredVolume: { x: 300, y: 200, z: 90 },
      zMin: 0,
      zMax: 90,
      maxTravel: { x: 310, y: 210, z: 100 },
      isMulti: true,
      instruments: ["reference", "probe", "unknown"],
      instrumentPositions: {
        reference: { x: 100, y: 100, z: 35 },
        probe: { x: 98.1234, y: 101.9876, z: 40.5555 },
        missing_in_config: { x: 1, y: 2, z: 3 },
      },
      referenceInstrument: "reference",
      lowestInstrument: "reference",
    });

    expect(calibrated.instruments.reference).toMatchObject({ offset_x: 0, offset_y: 0, depth: 0 });
    expect(calibrated.instruments.probe).toMatchObject({
      offset_x: 1.877,
      offset_y: -1.988,
      depth: 5.556,
    });
  });

  it("requires captured multi-instrument reference positions", () => {
    expect(() => buildCalibratedConfig({
      config: gantryConfig(),
      measuredVolume: { x: 300, y: 200, z: 90 },
      zMin: 0,
      zMax: 90,
      maxTravel: { x: 310, y: 210, z: 100 },
      isMulti: true,
      instruments: ["asmi"],
      instrumentPositions: {},
      referenceInstrument: "asmi",
      lowestInstrument: "asmi",
    })).toThrow("Reference and lowest instrument positions are required");
  });

  it("throws if captured multi-instrument offsets are not finite", () => {
    expect(() => buildCalibratedConfig({
      config: gantryConfig(),
      measuredVolume: { x: 300, y: 200, z: 90 },
      zMin: 0,
      zMax: 90,
      maxTravel: { x: 310, y: 210, z: 100 },
      isMulti: true,
      instruments: ["asmi"],
      instrumentPositions: {
        asmi: { x: Number.NaN, y: 100, z: 35 },
      },
      referenceInstrument: "asmi",
      lowestInstrument: "asmi",
    })).toThrow("asmi offset_x is not a valid number");
  });
});
