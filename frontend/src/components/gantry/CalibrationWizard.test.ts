import { describe, expect, it } from "vitest";
import { buildCalibratedConfig, getTheoreticalZRange } from "./calibrationMath";
import type { GantryConfig } from "../../types";

function gantryConfig(): GantryConfig {
  return {
    serial_port: "/dev/ttyUSB0",
    gantry_type: "cub_xl",
    cnc: {
      homing_strategy: "standard",
      total_z_range: 110,
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

describe("getTheoreticalZRange", () => {
  it("returns rounded total_z_range from config", () => {
    expect(getTheoreticalZRange(gantryConfig())).toBe(110);
  });

  it("throws when total_z_range is missing", () => {
    const config = gantryConfig();
    delete (config.cnc as Record<string, unknown>).total_z_range;
    expect(() => getTheoreticalZRange(config)).toThrow("cnc.total_z_range");
  });

  it("throws when total_z_range is zero", () => {
    const config = gantryConfig();
    config.cnc.total_z_range = 0;
    expect(() => getTheoreticalZRange(config)).toThrow("cnc.total_z_range");
  });

  it("throws when total_z_range is negative", () => {
    const config = gantryConfig();
    config.cnc.total_z_range = -50;
    expect(() => getTheoreticalZRange(config)).toThrow("cnc.total_z_range");
  });
});

describe("buildCalibratedConfig", () => {
  it("preserves seeded theoretical z range for calibrated bounds and soft limits", () => {
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

    expect(calibrated.cnc.total_z_range).toBe(110);
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
});
