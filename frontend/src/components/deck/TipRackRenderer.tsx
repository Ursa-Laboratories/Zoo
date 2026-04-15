import type { TipRackConfig, WellPosition } from "../../types";
import { machineToSvg } from "../../utils/coordinates";
import { toSvgRect } from "./renderUtils";

interface Props {
  config: TipRackConfig;
  positions: Record<string, WellPosition>;
  svgWidth: number;
  svgHeight: number;
  machineXRange: [number, number];
  machineYRange: [number, number];
  testIdPrefix?: string;
}

export default function TipRackRenderer({
  config,
  positions,
  svgWidth,
  svgHeight,
  machineXRange,
  machineYRange,
  testIdPrefix = "tip",
}: Props) {
  const tips = Object.values(positions);
  if (tips.length === 0) {
    return null;
  }

  const pitch = 4.5;
  const xs = tips.map((tip) => tip.x);
  const ys = tips.map((tip) => tip.y);
  const rect = toSvgRect(
    Math.min(...xs) - pitch,
    Math.min(...ys) - pitch,
    Math.max(...xs) + pitch,
    Math.max(...ys) + pitch,
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
        fill="#dcfce7"
        fillOpacity={0.35}
        stroke="#16a34a"
        strokeWidth={1.5}
        rx={3}
      />
      <text x={rect.x + 4} y={rect.y - 4} fill="#15803d" fontSize={10} fontWeight={500}>
        {config.name}
      </text>
      {Object.entries(positions).map(([tipId, position]) => {
        const { sx, sy } = machineToSvg(
          position.x,
          position.y,
          svgWidth,
          svgHeight,
          machineXRange,
          machineYRange,
        );
        return (
          <circle
            key={tipId}
            cx={sx}
            cy={sy}
            r={2.5}
            fill="#16a34a"
            opacity={0.65}
            data-testid={`${testIdPrefix}-target-${tipId}`}
          >
            <title>
              {tipId}: ({position.x}, {position.y}, {position.z})
            </title>
          </circle>
        );
      })}
    </g>
  );
}
