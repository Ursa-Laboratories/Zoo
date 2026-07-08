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
}

export default function TipRackRenderer({
  config,
  positions,
  svgWidth,
  svgHeight,
  machineXRange,
  machineYRange,
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
        fill="rgba(52,211,153,0.08)"
        stroke="#31405f"
        strokeWidth={1.25}
        rx={3}
      />
      <text x={rect.x + 4} y={rect.y - 4} fill="#b0bdd4" fontSize={10} fontWeight={500} stroke="#0a101f" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
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
          <circle key={tipId} cx={sx} cy={sy} r={2.5} fill="#34d399" opacity={0.65}>
            <title>
              {tipId}: ({position.x}, {position.y}, {position.z})
            </title>
          </circle>
        );
      })}
    </g>
  );
}
