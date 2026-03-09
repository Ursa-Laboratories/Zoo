/**
 * User-space coord -> SVG coord transform.
 *
 * User-space coordinates are positive (X: 0 to 300, Y: 0 to 200).
 * SVG origin (0,0) is top-left.
 * X increases left-to-right, Y increases top-to-bottom (matching SVG).
 */

export const SVG_PADDING = 20;

export function machineToSvg(
  mx: number,
  my: number,
  svgWidth: number,
  svgHeight: number,
  machineXRange: [number, number],
  machineYRange: [number, number]
): { sx: number; sy: number } {
  const mxSpan = machineXRange[1] - machineXRange[0];
  const mySpan = machineYRange[1] - machineYRange[0];
  const drawW = svgWidth - 2 * SVG_PADDING;
  const drawH = svgHeight - 2 * SVG_PADDING;

  // Linear map: machineXRange[0] (0) → left, machineXRange[1] (300) → right
  const sx = SVG_PADDING + ((mx - machineXRange[0]) / mxSpan) * drawW;
  // Linear map: machineYRange[0] (0) → top, machineYRange[1] (200) → bottom
  const sy = SVG_PADDING + ((my - machineYRange[0]) / mySpan) * drawH;

  return { sx, sy };
}
