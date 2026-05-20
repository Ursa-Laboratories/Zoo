import type { GantryPosition } from "../../types";
import { machineToSvg } from "../../utils/coordinates";

interface Props {
  position: GantryPosition;
  svgWidth: number;
  svgHeight: number;
  machineXRange: [number, number];
  machineYRange: [number, number];
}

export default function GantryMarker({
  position,
  svgWidth,
  svgHeight,
  machineXRange,
  machineYRange,
}: Props) {
  if (!position.connected) return null;

  const posX = position.work_x ?? position.x;
  const posY = position.work_y ?? position.y;
  const { sx, sy } = machineToSvg(
    posX,
    posY,
    svgWidth,
    svgHeight,
    machineXRange,
    machineYRange
  );
  const arm = 12;
  const labelY = Math.max(10, sy - 2);

  return (
    <g>
      <line x1={sx - arm} y1={sy} x2={sx + arm} y2={sy} stroke="#dc2626" strokeWidth={1.5} />
      <line x1={sx} y1={sy - arm} x2={sx} y2={sy + arm} stroke="#dc2626" strokeWidth={1.5} />
      <circle cx={sx} cy={sy} r={4} fill="#dc2626" opacity={0.8} />
      <text x={sx + arm + 2} y={labelY} fill="#dc2626" fontSize={8} fontWeight={600}>
        HEAD
      </text>
    </g>
  );
}
