/**
 * User-space coord -> SVG coord transform.
 *
 * User-space coordinates are positive with a bottom-left machine origin.
 * SVG origin (0,0) is top-left, so Y must be inverted for display.
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
  // Invert Y so machineYRange[0] is bottom and machineYRange[1] is top.
  const sy = SVG_PADDING + (1 - (my - machineYRange[0]) / mySpan) * drawH;

  return { sx, sy };
}
