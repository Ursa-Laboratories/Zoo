import React from "react";
import type {
  Coordinate3D,
  DeckResponse,
  GantryPosition,
  GeometryResponse,
  InstrumentConfig,
  LabwareResponse,
} from "../../types";
import { SVG_PADDING } from "../../utils/coordinates";
import GantryMarker from "./GantryMarker";
import HolderRenderer from "./HolderRenderer";
import InstrumentRenderer from "./InstrumentRenderer";
import TipRackRenderer from "./TipRackRenderer";
import VialRenderer from "./VialRenderer";
import WellPlateRenderer from "./WellPlateRenderer";

interface Props {
  deck: DeckResponse | null;
  instruments: Record<string, InstrumentConfig> | null;
  gantryPosition: GantryPosition | null;
  machineXRange?: [number, number];
  machineYRange?: [number, number];
  yAxisMotion?: "head" | "bed";
}

const SVG_W = 600;
const SVG_H = 420;
const VISUAL_MARGIN_MM = 10;

type Bounds2D = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

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
  const xStart = Math.ceil(machineXRange[0] / step) * step;
  const xEnd = Math.floor(machineXRange[1] / step) * step;
  for (let tick = xStart; tick <= xEnd; tick += step) {
    const x = SVG_PADDING + ((tick - machineXRange[0]) / xSpan) * drawW;
    lines.push(
      <line key={`vx${tick}`} x1={x} y1={SVG_PADDING} x2={x} y2={SVG_PADDING + drawH} stroke="#e0e0e0" strokeWidth={0.5} />
    );
    lines.push(
      <text key={`lx${tick}`} x={x} y={SVG_PADDING + drawH + 14} fill="#999" fontSize={9} textAnchor="middle">
        {tick}
      </text>
    );
  }
  const yStart = Math.ceil(machineYRange[0] / step) * step;
  const yEnd = Math.floor(machineYRange[1] / step) * step;
  for (let tick = yStart; tick <= yEnd; tick += step) {
    const y = SVG_PADDING + drawH - ((tick - machineYRange[0]) / ySpan) * drawH;
    lines.push(
      <line key={`vy${tick}`} x1={SVG_PADDING} y1={y} x2={SVG_PADDING + drawW} y2={y} stroke="#e0e0e0" strokeWidth={0.5} />
    );
    lines.push(
      <text key={`ly${tick}`} x={SVG_PADDING - 4} y={y + 3} fill="#999" fontSize={9} textAnchor="end">
        {tick}
      </text>
    );
  }

  return <g>{lines}</g>;
}

export default function DeckVisualization({
  deck,
  instruments,
  gantryPosition,
  machineXRange = [0, 300],
  machineYRange = [0, 200],
  yAxisMotion = "head",
}: Props) {
  const visualBounds = getVisualizationBounds(deck, instruments, gantryPosition, machineXRange, machineYRange);
  const visualXRange: [number, number] = [visualBounds.minX, visualBounds.maxX];
  const visualYRange: [number, number] = [visualBounds.minY, visualBounds.maxY];
  const isBedMode = yAxisMotion === "bed";

  // In bed mode, compute SVG pixel offset for the deck based on gantry Y.
  // The bed moves opposite to the head: when gantry reports Y=50, the bed
  // has shifted 50mm from its home, so we translate the deck group.
  let deckTranslateY = 0;
  if (isBedMode && gantryPosition?.connected) {
    const gantryY = gantryPosition.work_y ?? gantryPosition.y ?? 0;
    const drawH = SVG_H - 2 * SVG_PADDING;
    const ySpan = visualYRange[1] - visualYRange[0];
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
        machineXRange={visualXRange}
        machineYRange={visualYRange}
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
                machineXRange={visualXRange}
                machineYRange={visualYRange}
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
                machineXRange={visualXRange}
                machineYRange={visualYRange}
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
                  machineXRange={visualXRange}
                  machineYRange={visualYRange}
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
                    machineXRange={visualXRange}
                    machineYRange={visualYRange}
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
                  machineXRange={visualXRange}
                  machineYRange={visualYRange}
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
                      machineXRange={visualXRange}
                      machineYRange={visualYRange}
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
                machineXRange={visualXRange}
                machineYRange={visualYRange}
              />
            );
          }
          return null;
        })}
      </g>

      {instruments &&
        Object.entries(instruments).map(([key, inst]) => (
          <InstrumentRenderer
            key={key}
            label={key}
            instrument={inst}
            gantryPosition={gantryPosition}
            svgWidth={SVG_W}
            svgHeight={SVG_H}
            machineXRange={visualXRange}
            machineYRange={visualYRange}
          />
        ))}

      {markerPosition && (
        <GantryMarker
          position={markerPosition}
          svgWidth={SVG_W}
          svgHeight={SVG_H}
          machineXRange={visualXRange}
          machineYRange={visualYRange}
        />
      )}
    </svg>
  );
}

function getVisualizationBounds(
  deck: DeckResponse | null,
  instruments: Record<string, InstrumentConfig> | null,
  gantryPosition: GantryPosition | null,
  machineXRange: [number, number],
  machineYRange: [number, number],
): Bounds2D {
  const bounds: Bounds2D = {
    minX: machineXRange[0],
    maxX: machineXRange[1],
    minY: machineYRange[0],
    maxY: machineYRange[1],
  };

  for (const item of deck?.labware ?? []) {
    expandForLabware(bounds, item);
  }

  if (instruments) {
    for (const instrument of Object.values(instruments)) {
      if (gantryPosition?.connected && gantryPosition.work_x != null && gantryPosition.work_y != null) {
        expandPoint(
          bounds,
          gantryPosition.work_x + (instrument.offset_x ?? 0),
          gantryPosition.work_y + (instrument.offset_y ?? 0),
          12,
        );
      } else {
        expandPoint(bounds, 0, 0, 12);
        expandPoint(bounds, instrument.offset_x ?? 0, instrument.offset_y ?? 0, 12);
      }
    }
  }

  if (gantryPosition?.connected) {
    expandPoint(
      bounds,
      gantryPosition.work_x ?? gantryPosition.x,
      gantryPosition.work_y ?? gantryPosition.y,
      14,
    );
  }

  bounds.minX = Math.floor((bounds.minX - VISUAL_MARGIN_MM) / VISUAL_MARGIN_MM) * VISUAL_MARGIN_MM;
  bounds.maxX = Math.ceil((bounds.maxX + VISUAL_MARGIN_MM) / VISUAL_MARGIN_MM) * VISUAL_MARGIN_MM;
  bounds.minY = Math.floor((bounds.minY - VISUAL_MARGIN_MM) / VISUAL_MARGIN_MM) * VISUAL_MARGIN_MM;
  bounds.maxY = Math.ceil((bounds.maxY + VISUAL_MARGIN_MM) / VISUAL_MARGIN_MM) * VISUAL_MARGIN_MM;

  if (bounds.maxX <= bounds.minX) bounds.maxX = bounds.minX + 1;
  if (bounds.maxY <= bounds.minY) bounds.maxY = bounds.minY + 1;
  return bounds;
}

function expandForLabware(bounds: Bounds2D, item: LabwareResponse) {
  if (item.config.type === "well_plate") {
    expandPositions(
      bounds,
      Object.values(item.wells ?? {}),
      wellPlatePad(item.config.x_offset_mm, item.config.y_offset_mm),
    );
    return;
  }

  if (item.config.type === "tip_rack") {
    expandPositions(
      bounds,
      Object.values(filterRenderablePositions(item.positions)),
      4.5,
    );
    return;
  }

  if (item.config.type === "well_plate_holder") {
    expandHolder(
      bounds,
      item.geometry ?? null,
      item.location ?? null,
      Object.values(item.positions ?? {}),
    );
    expandPositions(
      bounds,
      Object.values(filterChildPositions(item.positions, "plate")),
      wellPlatePad(
        item.config.well_plate?.x_offset_mm ?? 9,
        item.config.well_plate?.y_offset_mm ?? 9,
      ),
    );
    return;
  }

  if (item.config.type === "vial_holder") {
    expandHolder(
      bounds,
      item.geometry ?? null,
      item.location ?? null,
      Object.values(item.positions ?? {}),
    );
    for (const [vialId, vialConfig] of Object.entries(item.config.vials ?? {})) {
      const position = item.positions?.[vialId];
      if (position) {
        expandPoint(bounds, position.x, position.y, Math.max(6, vialConfig.diameter_mm * 0.5));
      }
    }
    return;
  }

  if (item.config.type === "vial") {
    expandPoint(
      bounds,
      item.config.location.x,
      item.config.location.y,
      Math.max(6, item.config.diameter_mm * 0.5),
    );
  }
}

function expandHolder(
  bounds: Bounds2D,
  geometry: GeometryResponse | null,
  anchor: Coordinate3D | null,
  childPositions: Coordinate3D[],
) {
  if (!geometry) {
    expandPositions(bounds, childPositions, 0);
    if (anchor) expandPoint(bounds, anchor.x, anchor.y, 0);
    return;
  }

  const center = getPositionCenter(childPositions, anchor);

  if (!center) return;
  const length = geometry.length_mm ?? 20;
  const width = geometry.width_mm ?? 20;
  expandRect(
    bounds,
    center.x - length * 0.5,
    center.y - width * 0.5,
    center.x + length * 0.5,
    center.y + width * 0.5,
  );
}

function getPositionCenter(
  positions: Coordinate3D[],
  anchor: Coordinate3D | null,
): { x: number; y: number } | null {
  if (positions.length === 0) {
    return anchor ? { x: anchor.x, y: anchor.y } : null;
  }

  const xs = positions.map((position) => position.x);
  const ys = positions.map((position) => position.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) * 0.5,
    y: (Math.min(...ys) + Math.max(...ys)) * 0.5,
  };
}

function expandPositions(bounds: Bounds2D, positions: Coordinate3D[], pad: number) {
  for (const position of positions) {
    expandPoint(bounds, position.x, position.y, pad);
  }
}

function expandPoint(bounds: Bounds2D, x: number, y: number, pad: number) {
  expandRect(bounds, x - pad, y - pad, x + pad, y + pad);
}

function expandRect(bounds: Bounds2D, minX: number, minY: number, maxX: number, maxY: number) {
  bounds.minX = Math.min(bounds.minX, minX);
  bounds.maxX = Math.max(bounds.maxX, maxX);
  bounds.minY = Math.min(bounds.minY, minY);
  bounds.maxY = Math.max(bounds.maxY, maxY);
}

function wellPlatePad(xOffset: number, yOffset: number): number {
  return Math.max(Math.abs(xOffset), Math.abs(yOffset), 9) * 0.5;
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
