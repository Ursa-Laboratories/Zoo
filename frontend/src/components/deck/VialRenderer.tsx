import type { VialConfig } from "../../types";
import { machineToSvg, mmToSvgPixels } from "../../utils/coordinates";

interface Props {
  label: string;
  config: VialConfig;
  svgWidth: number;
  svgHeight: number;
  machineXRange: [number, number];
  machineYRange: [number, number];
}

export default function VialRenderer({
  label,
  config,
  svgWidth,
  svgHeight,
  machineXRange,
  machineYRange,
}: Props) {
  const { sx, sy } = machineToSvg(
    config.location.x,
    config.location.y,
    svgWidth,
    svgHeight,
    machineXRange,
    machineYRange
  );
  const r = Math.max(2, mmToSvgPixels(config.diameter * 0.5, svgWidth, svgHeight, machineXRange, machineYRange));

  return (
    <g>
      <circle cx={sx} cy={sy} r={r} fill="rgba(245,158,11,0.12)" stroke="#f59e0b" strokeWidth={1.5}>
        <title>
          {label}: ({config.location.x}, {config.location.y}, {config.location.z})
        </title>
      </circle>
      <text x={sx} y={sy - r - 3} fill="#fcd34d" fontSize={9} textAnchor="middle" fontWeight={500} stroke="#0a101f" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
        {config.name}
      </text>
    </g>
  );
}
