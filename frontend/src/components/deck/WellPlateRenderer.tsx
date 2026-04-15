import type { WellPlateConfig, WellPosition } from "../../types";
import { machineToSvg } from "../../utils/coordinates";

interface Props {
  config: WellPlateConfig;
  wells: Record<string, WellPosition>;
  svgWidth: number;
  svgHeight: number;
  machineXRange: [number, number];
  machineYRange: [number, number];
  testIdPrefix?: string;
}

export default function WellPlateRenderer({
  config,
  wells,
  svgWidth,
  svgHeight,
  machineXRange,
  machineYRange,
  testIdPrefix = "well",
}: Props) {
  const wellRadius = 3;
  const wellEntries = Object.values(wells);
  if (wellEntries.length === 0) return null;

  // Derive bounding box from actual well positions (handles any orientation).
  const pitch = Math.max(Math.abs(config.x_offset_mm), Math.abs(config.y_offset_mm), 9);
  const pad = pitch * 0.5;
  const xs = wellEntries.map((w) => w.x);
  const ys = wellEntries.map((w) => w.y);
  const topLeft = machineToSvg(
    Math.min(...xs) - pad, Math.max(...ys) + pad,
    svgWidth, svgHeight, machineXRange, machineYRange
  );
  const bottomRight = machineToSvg(
    Math.max(...xs) + pad, Math.min(...ys) - pad,
    svgWidth, svgHeight, machineXRange, machineYRange
  );

  const rectX = Math.min(topLeft.sx, bottomRight.sx);
  const rectY = Math.min(topLeft.sy, bottomRight.sy);
  const rectW = Math.abs(bottomRight.sx - topLeft.sx);
  const rectH = Math.abs(bottomRight.sy - topLeft.sy);

  return (
    <g>
      <rect
        x={rectX}
        y={rectY}
        width={rectW}
        height={rectH}
        fill="#dbeafe"
        fillOpacity={0.3}
        stroke="#2563eb"
        strokeWidth={1.5}
        rx={3}
      />
      <text x={rectX + 4} y={rectY - 4} fill="#2563eb" fontSize={10} fontWeight={500}>
        {config.name || "Well Plate"}
      </text>
      {Object.entries(wells).map(([id, pos]) => {
        const { sx, sy } = machineToSvg(
          pos.x,
          pos.y,
          svgWidth,
          svgHeight,
          machineXRange,
          machineYRange
        );
        return (
          <circle
            key={id}
            cx={sx}
            cy={sy}
            r={wellRadius}
            fill="#2563eb"
            opacity={0.5}
            data-testid={`${testIdPrefix}-target-${id}`}
          >
            <title>
              {id}: ({pos.x}, {pos.y}, {pos.z})
            </title>
          </circle>
        );
      })}
    </g>
  );
}
