import { describe, expect, it } from "vitest";
import { translateDeckTargetForInstrument } from "./gantryTargets";

describe("translateDeckTargetForInstrument", () => {
  it("applies deck-based Z target math for instrument motion", () => {
    expect(
      translateDeckTargetForInstrument(
        { x: 100, y: 120, z: 45 },
        {
          type: "pipette",
          offset_x: 0,
          offset_y: 0,
          depth: 3,
          safe_approach_height: 8,
          measurement_height: 1.5,
        },
      ),
    ).toEqual({
      gantryHeadZ: 42,
      approachZ: 53,
      actionZ: 46.5,
    });
  });
});
