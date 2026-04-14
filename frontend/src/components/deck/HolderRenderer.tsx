import type { Coordinate3D, GeometryResponse } from "../../types";
import { toSvgRect, getBoundsCenter, getPositionBounds } from "./renderUtils";

interface Props {
  label: string;
  geometry: GeometryResponse | null;
  anchor: Coordinate3D | null;
  childPositions: Coordinate3D[];
  svgWidth: number;
  svgHeight: number;
  machineXRange: [number, number];
  machineYRange: [number, number];
}

export default function HolderRenderer({
  label,
  geometry,
  anchor,
  childPositions,
  svgWidth,
  svgHeight,
  machineXRange,
  machineYRange,
}: Props) {
  if (!geometry) {
    return null;
  }

  const bounds = getPositionBounds(childPositions);
  const center = bounds
    ? getBoundsCenter(bounds)
    : anchor
      ? { x: anchor.x, y: anchor.y }
      : null;

  if (!center) {
    return null;
  }

  const length = geometry.length_mm ?? 20;
  const width = geometry.width_mm ?? 20;
  const rect = toSvgRect(
    center.x - length * 0.5,
    center.y - width * 0.5,
    center.x + length * 0.5,
    center.y + width * 0.5,
    svgWidth,
    svgHeight,
    machineXRange,
    machineYRange,
  );

  return (
    <g>
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        fill="#e5e7eb"
        fillOpacity={0.2}
        stroke="#6b7280"
        strokeWidth={1.5}
        strokeDasharray="6 3"
        rx={4}
      />
      <text x={rect.x + 4} y={rect.y - 4} fill="#4b5563" fontSize={10} fontWeight={500}>
        {label}
      </text>
    </g>
  );
}
