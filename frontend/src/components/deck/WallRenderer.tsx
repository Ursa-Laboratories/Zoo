import type { WallConfig } from "../../types";
import { machineToSvg } from "../../utils/coordinates";

interface Props {
  label: string;
  config: WallConfig;
  svgWidth: number;
  svgHeight: number;
  machineXRange: [number, number];
  machineYRange: [number, number];
}

export default function WallRenderer({
  label,
  config,
  svgWidth,
  svgHeight,
  machineXRange,
  machineYRange,
}: Props) {
  const { sx: x1, sy: y1 } = machineToSvg(
    config.corner_1.x, config.corner_1.y,
    svgWidth, svgHeight, machineXRange, machineYRange,
  );
  const { sx: x2, sy: y2 } = machineToSvg(
    config.corner_2.x, config.corner_2.y,
    svgWidth, svgHeight, machineXRange, machineYRange,
  );

  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  const midX = x + w / 2;
  const midY = y + h / 2;

  return (
    <g>
      <rect
        x={x} y={y} width={w} height={h}
        fill="#ef4444" fillOpacity={0.15}
        stroke="#ef4444" strokeWidth={1.5}
        strokeDasharray="4 2"
      >
        <title>
          {label}: ({config.corner_1.x}, {config.corner_1.y}, {config.corner_1.z}) to ({config.corner_2.x}, {config.corner_2.y}, {config.corner_2.z})
        </title>
      </rect>
      <text x={midX} y={midY + 3} fill="#ef4444" fontSize={8} textAnchor="middle" fontWeight={500}>
        {config.name}
      </text>
    </g>
  );
}
