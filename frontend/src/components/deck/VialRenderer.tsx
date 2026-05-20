import type { VialConfig } from "../../types";
import { machineToSvg } from "../../utils/coordinates";

interface Props {
  label: string;
  config: VialConfig;
  svgWidth: number;
  svgHeight: number;
  machineXRange: [number, number];
  machineYRange: [number, number];
}

type LegacyVialConfig = VialConfig & {
  diameter?: number;
};

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
  const vialConfig = config as LegacyVialConfig;
  const diameter = finiteNumber(vialConfig.diameter_mm ?? vialConfig.diameter, 0);
  const r = Math.max(6, diameter * 0.5);

  return (
    <g>
      <circle cx={sx} cy={sy} r={r} fill="#fef3c7" fillOpacity={0.4} stroke="#d97706" strokeWidth={1.5}>
        <title>
          {label}: ({config.location.x}, {config.location.y}, {config.location.z})
        </title>
      </circle>
      <text x={sx} y={sy - r - 3} fill="#d97706" fontSize={9} textAnchor="middle" fontWeight={500}>
        {config.name}
      </text>
    </g>
  );
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
