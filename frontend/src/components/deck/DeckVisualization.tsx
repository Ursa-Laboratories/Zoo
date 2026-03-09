import React from "react";
import type { BoardResponse, DeckResponse, GantryPosition } from "../../types";
import { SVG_PADDING } from "../../utils/coordinates";
import GantryMarker from "./GantryMarker";
import InstrumentRenderer from "./InstrumentRenderer";
import VialRenderer from "./VialRenderer";
import WellPlateRenderer from "./WellPlateRenderer";

interface Props {
  deck: DeckResponse | null;
  board: BoardResponse | null;
  gantryPosition: GantryPosition | null;
  machineXRange?: [number, number];
  machineYRange?: [number, number];
  yAxisMotion?: "head" | "bed";
}

const SVG_W = 600;
const SVG_H = 420;

function CoordinateGrid({
  svgWidth,
  svgHeight,
  machineXRange,
  machineYRange,
}: {
  svgWidth: number;
  svgHeight: number;
  machineXRange: [number, number];
  machineYRange: [number, number];
}) {
  const drawW = svgWidth - 2 * SVG_PADDING;
  const drawH = svgHeight - 2 * SVG_PADDING;
  const xSpan = machineXRange[1] - machineXRange[0];
  const ySpan = machineYRange[1] - machineYRange[0];
  const step = 50;

  const lines: React.ReactElement[] = [];
  for (let v = 0; v <= xSpan; v += step) {
    const x = SVG_PADDING + (v / xSpan) * drawW;
    lines.push(
      <line key={`vx${v}`} x1={x} y1={SVG_PADDING} x2={x} y2={SVG_PADDING + drawH} stroke="#e0e0e0" strokeWidth={0.5} />
    );
    lines.push(
      <text key={`lx${v}`} x={x} y={SVG_PADDING + drawH + 14} fill="#999" fontSize={9} textAnchor="middle">
        {machineXRange[0] + v}
      </text>
    );
  }
  for (let v = 0; v <= ySpan; v += step) {
    const y = SVG_PADDING + (v / ySpan) * drawH;
    lines.push(
      <line key={`vy${v}`} x1={SVG_PADDING} y1={y} x2={SVG_PADDING + drawW} y2={y} stroke="#e0e0e0" strokeWidth={0.5} />
    );
    lines.push(
      <text key={`ly${v}`} x={SVG_PADDING - 4} y={y + 3} fill="#999" fontSize={9} textAnchor="end">
        {machineYRange[0] + v}
      </text>
    );
  }

  return <g>{lines}</g>;
}

export default function DeckVisualization({
  deck,
  board,
  gantryPosition,
  machineXRange = [0, 300],
  machineYRange = [0, 200],
  yAxisMotion = "head",
}: Props) {
  const isBedMode = yAxisMotion === "bed";

  // In bed mode, compute SVG pixel offset for the deck based on gantry Y.
  // The bed moves opposite to the head: when gantry reports Y=50, the bed
  // has shifted 50mm from its home, so we translate the deck group.
  let deckTranslateY = 0;
  if (isBedMode && gantryPosition?.connected) {
    const gantryY = gantryPosition.work_y ?? gantryPosition.y ?? 0;
    const drawH = SVG_H - 2 * SVG_PADDING;
    const ySpan = machineYRange[1] - machineYRange[0];
    deckTranslateY = (gantryY / ySpan) * drawH;
  }

  // In bed mode, the gantry marker only moves in X (Y is fixed at 0).
  const markerPosition: GantryPosition | null = isBedMode && gantryPosition
    ? { ...gantryPosition, work_y: 0, y: 0 }
    : gantryPosition;

  return (
    <svg
      width={SVG_W}
      height={SVG_H}
      style={{ background: "#f8f9fa", borderRadius: 8, border: "1px solid #e0e0e0", width: "100%" }}
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
    >
      <CoordinateGrid
        svgWidth={SVG_W}
        svgHeight={SVG_H}
        machineXRange={machineXRange}
        machineYRange={machineYRange}
      />

      {isBedMode && (
        <text x={SVG_W - SVG_PADDING} y={SVG_PADDING - 4} fill="#888" fontSize={9} textAnchor="end">
          bed moves Y
        </text>
      )}

      {/* Deck group — shifts in Y when in bed mode */}
      <g transform={isBedMode ? `translate(0, ${deckTranslateY})` : undefined}>
        {deck?.labware.map((item) => {
          if (item.config.type === "well_plate") {
            return (
              <WellPlateRenderer
                key={item.key}
                config={item.config}
                wells={item.wells ?? {}}
                svgWidth={SVG_W}
                svgHeight={SVG_H}
                machineXRange={machineXRange}
                machineYRange={machineYRange}
              />
            );
          }
          if (item.config.type === "vial") {
            return (
              <VialRenderer
                key={item.key}
                label={item.key}
                config={item.config}
                svgWidth={SVG_W}
                svgHeight={SVG_H}
                machineXRange={machineXRange}
                machineYRange={machineYRange}
              />
            );
          }
          return null;
        })}
      </g>

      {board &&
        Object.entries(board.instruments).map(([key, inst]) => (
          <InstrumentRenderer
            key={key}
            label={key}
            instrument={inst}
            gantryPosition={gantryPosition}
            svgWidth={SVG_W}
            svgHeight={SVG_H}
            machineXRange={machineXRange}
            machineYRange={machineYRange}
          />
        ))}

      {markerPosition && (
        <GantryMarker
          position={markerPosition}
          svgWidth={SVG_W}
          svgHeight={SVG_H}
          machineXRange={machineXRange}
          machineYRange={machineYRange}
        />
      )}
    </svg>
  );
}
