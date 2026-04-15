import type { VialConfig } from "../../types";
import { machineToSvg } from "../../utils/coordinates";

interface Props {
  label: string;
  config: VialConfig;
  svgWidth: number;
  svgHeight: number;
  machineXRange: [number, number];
  machineYRange: [number, number];
  testIdPrefix?: string;
}

export default function VialRenderer({
  label,
  config,
  svgWidth,
  svgHeight,
  machineXRange,
  machineYRange,
  testIdPrefix = "vial",
}: Props) {
  const { sx, sy } = machineToSvg(
    config.location.x,
    config.location.y,
    svgWidth,
    svgHeight,
    machineXRange,
    machineYRange
  );
  const r = Math.max(6, config.diameter_mm * 0.5);

  return (
    <g>
      <circle
        cx={sx}
        cy={sy}
        r={r}
        fill="#fef3c7"
        fillOpacity={0.4}
        stroke="#d97706"
        strokeWidth={1.5}
        data-testid={`${testIdPrefix}-target-${label}`}
      >
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
