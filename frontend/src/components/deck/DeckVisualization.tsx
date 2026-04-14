import React from "react";
import type { BoardResponse, DeckResponse, GantryPosition } from "../../types";
import { SVG_PADDING } from "../../utils/coordinates";
import GantryMarker from "./GantryMarker";
import HolderRenderer from "./HolderRenderer";
import InstrumentRenderer from "./InstrumentRenderer";
import TipRackRenderer from "./TipRackRenderer";
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
    const y = SVG_PADDING + drawH - (v / ySpan) * drawH;
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
    deckTranslateY = -(gantryY / ySpan) * drawH;
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
          if (item.config.type === "tip_rack") {
            return (
              <TipRackRenderer
                key={item.key}
                config={item.config}
                positions={filterRenderablePositions(item.positions)}
                svgWidth={SVG_W}
                svgHeight={SVG_H}
                machineXRange={machineXRange}
                machineYRange={machineYRange}
              />
            );
          }
          if (item.config.type === "well_plate_holder") {
            const nestedConfig = item.config.well_plate;
            const nestedWells = filterChildPositions(item.positions, "plate");

            return (
              <g key={item.key}>
                <HolderRenderer
                  label={item.config.name ?? item.key}
                  geometry={item.geometry ?? null}
                  anchor={item.location ?? null}
                  childPositions={Object.values(item.positions ?? {})}
                  svgWidth={SVG_W}
                  svgHeight={SVG_H}
                  machineXRange={machineXRange}
                  machineYRange={machineYRange}
                />
                {nestedConfig && Object.keys(nestedWells).length > 0 && (
                  <WellPlateRenderer
                    config={{
                      type: "well_plate",
                      name: nestedConfig.name ?? "Well Plate",
                      model_name: nestedConfig.model_name,
                      rows: nestedConfig.rows,
                      columns: nestedConfig.columns,
                      length_mm: nestedConfig.length_mm ?? 0,
                      width_mm: nestedConfig.width_mm ?? 0,
                      height_mm: nestedConfig.height_mm ?? 0,
                      a1: null,
                      calibration: {
                        a1: normalizeCoordinate3D(nestedConfig.calibration.a1),
                        a2: normalizeCoordinate3D(nestedConfig.calibration.a2) ?? { x: 0, y: 0, z: 0 },
                      },
                      x_offset_mm: nestedConfig.x_offset_mm,
                      y_offset_mm: nestedConfig.y_offset_mm,
                      capacity_ul: nestedConfig.capacity_ul ?? 0,
                      working_volume_ul: nestedConfig.working_volume_ul ?? 0,
                    }}
                    wells={nestedWells}
                    svgWidth={SVG_W}
                    svgHeight={SVG_H}
                    machineXRange={machineXRange}
                    machineYRange={machineYRange}
                  />
                )}
              </g>
            );
          }
          if (item.config.type === "vial_holder") {
            return (
              <g key={item.key}>
                <HolderRenderer
                  label={item.config.name ?? item.key}
                  geometry={item.geometry ?? null}
                  anchor={item.location ?? null}
                  childPositions={Object.values(item.positions ?? {})}
                  svgWidth={SVG_W}
                  svgHeight={SVG_H}
                  machineXRange={machineXRange}
                  machineYRange={machineYRange}
                />
                {Object.entries(item.config.vials ?? {}).map(([vialId, vialConfig]) => {
                  const position = item.positions?.[vialId];
                  if (!position) return null;
                  return (
                    <VialRenderer
                      key={`${item.key}:${vialId}`}
                      label={vialId}
                      config={{
                        type: "vial",
                        name: vialConfig.name ?? vialId,
                        model_name: vialConfig.model_name,
                        height_mm: vialConfig.height_mm,
                        diameter_mm: vialConfig.diameter_mm,
                        location: position,
                        capacity_ul: vialConfig.capacity_ul,
                        working_volume_ul: vialConfig.working_volume_ul,
                      }}
                      svgWidth={SVG_W}
                      svgHeight={SVG_H}
                      machineXRange={machineXRange}
                      machineYRange={machineYRange}
                    />
                  );
                })}
              </g>
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

function filterRenderablePositions(positions?: Record<string, { x: number; y: number; z: number }> | null) {
  if (!positions) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(positions).filter(([name]) => name !== "location" && !name.includes(".")),
  );
}

function filterChildPositions(
  positions: Record<string, { x: number; y: number; z: number }> | null | undefined,
  childName: string,
) {
  if (!positions) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(positions)
      .filter(([name]) => name.startsWith(`${childName}.`))
      .map(([name, position]) => [name.slice(childName.length + 1), position]),
  );
}

function normalizeCoordinate3D(
  value: { x: number; y: number; z?: number } | null | undefined,
) {
  if (!value) {
    return null;
  }
  return {
    x: value.x,
    y: value.y,
    z: value.z ?? 0,
  };
}
