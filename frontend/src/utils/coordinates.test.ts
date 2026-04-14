import { describe, expect, it } from "vitest";
import { SVG_PADDING, machineToSvg } from "./coordinates";

describe("machineToSvg", () => {
  it("maps the machine origin to the bottom-left plotting origin", () => {
    const { sx, sy } = machineToSvg(0, 0, 600, 420, [0, 400], [0, 300]);

    expect(sx).toBe(SVG_PADDING);
    expect(sy).toBe(420 - SVG_PADDING);
  });

  it("maps larger machine y values toward the top of the plot", () => {
    const bottom = machineToSvg(0, 0, 600, 420, [0, 400], [0, 300]);
    const top = machineToSvg(0, 300, 600, 420, [0, 400], [0, 300]);

    expect(top.sy).toBeLessThan(bottom.sy);
    expect(top.sy).toBe(SVG_PADDING);
  });
});
