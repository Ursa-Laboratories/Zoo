import type { CSSProperties } from "react";
import DeckVisualization from "../deck/DeckVisualization";
import type {
  DeckResponse,
  DigitalTwinBundle,
  DigitalTwinMotionPoint,
  GantryPosition,
  GantryResponse,
  InstrumentConfig,
  WorkingVolume,
} from "../../types";
import DigitalTwinScene from "./DigitalTwinScene";
import { liveTwinFromZoo, simulationPointToGantryPosition } from "./digitalTwinAdapter";

export type ViewerMode = "live" | "simulation";
export type ViewerDimension = "2d" | "3d";

interface Props {
  deck: DeckResponse | null;
  gantry: GantryResponse | null;
  livePosition: GantryPosition | null;
  mode: ViewerMode;
  view: ViewerDimension;
  simulationTwin: DigitalTwinBundle | null;
  simulationPathIndex: number;
  simulationLoading: boolean;
  simulationError: string | null;
  canSimulate: boolean;
  onModeChange: (mode: ViewerMode) => void;
  onViewChange: (view: ViewerDimension) => void;
  onSimulationPathIndexChange: (index: number) => void;
  onRunSimulation: () => void;
}

export default function ViewerPanel({
  deck,
  gantry,
  livePosition,
  mode,
  view,
  simulationTwin,
  simulationPathIndex,
  simulationLoading,
  simulationError,
  canSimulate,
  onModeChange,
  onViewChange,
  onSimulationPathIndexChange,
  onRunSimulation,
}: Props) {
  const workingVolume: WorkingVolume | null = gantry?.config.working_volume ?? null;
  const machineXRange: [number, number] = workingVolume
    ? [workingVolume.x_min, workingVolume.x_max]
    : [0, 300];
  const machineYRange: [number, number] = workingVolume
    ? [workingVolume.y_min, workingVolume.y_max]
    : [0, 200];
  const yAxisMotion = gantry?.config.cnc?.y_axis_motion ?? "head";
  const simulationPoint = currentSimulationPoint(simulationTwin, simulationPathIndex);
  const position = mode === "simulation"
    ? simulationPointToGantryPosition(simulationPoint)
    : livePosition;
  const liveTwin = liveTwinFromZoo(deck, gantry, livePosition);
  const twin = mode === "simulation" ? simulationTwin : liveTwin.twin;
  const current = mode === "simulation" ? simulationPoint : liveTwin.current;
  const instruments: Record<string, InstrumentConfig> | null = gantry?.config.instruments ?? null;

  return (
    <div>
      <div style={headerStyle}>
        <h3 style={{ margin: 0, fontSize: 14, color: "#666" }}>Deck Visualization</h3>
        <div style={controlsStyle}>
          <SegmentedControl
            label="Position source"
            value={mode}
            options={[
              { value: "live", label: "Live" },
              { value: "simulation", label: "Simulation" },
            ]}
            onChange={onModeChange}
          />
          <SegmentedControl
            label="Viewer dimension"
            value={view}
            options={[
              { value: "2d", label: "Top" },
              { value: "3d", label: "3D" },
            ]}
            onChange={onViewChange}
          />
          <button
            type="button"
            aria-label="Build simulation viewer"
            onClick={onRunSimulation}
            disabled={!canSimulate || simulationLoading}
            style={simulateButtonStyle}
          >
            {simulationLoading ? "Simulating..." : "Run Simulation"}
          </button>
        </div>
      </div>

      {view === "2d" ? (
        <DeckVisualization
          deck={deck}
          instruments={instruments}
          gantryPosition={position}
          machineXRange={machineXRange}
          machineYRange={machineYRange}
          yAxisMotion={yAxisMotion}
        />
      ) : (
        <DigitalTwinScene twin={twin} current={current} />
      )}

      {mode === "simulation" && (
        <SimulationTimeline
          twin={simulationTwin}
          pathIndex={simulationPathIndex}
          loading={simulationLoading}
          error={simulationError}
          onPathIndexChange={onSimulationPathIndexChange}
        />
      )}
    </div>
  );
}

function SimulationTimeline({
  twin,
  pathIndex,
  loading,
  error,
  onPathIndexChange,
}: {
  twin: DigitalTwinBundle | null;
  pathIndex: number;
  loading: boolean;
  error: string | null;
  onPathIndexChange: (index: number) => void;
}) {
  const current = currentSimulationPoint(twin, pathIndex);
  const pathLength = twin?.motion.path.length ?? 0;

  return (
    <div style={timelineStyle}>
      <div style={timelineTopStyle}>
        <span>
          Simulation path {pathLength ? pathIndex + 1 : 0} / {pathLength}
        </span>
        {current && (
          <span>
            {current.command} / {current.phase} / {current.targetRef}
          </span>
        )}
      </div>
      <input
        aria-label="Simulation path sample"
        type="range"
        min={0}
        max={Math.max(pathLength - 1, 0)}
        value={Math.min(pathIndex, Math.max(pathLength - 1, 0))}
        onChange={(event) => onPathIndexChange(Number(event.target.value))}
        disabled={!pathLength}
        style={{ width: "100%" }}
      />
      {loading && <p style={infoStyle}>Building Digital Sim motion bundle...</p>}
      {error && <p style={errorStyle}>{error}</p>}
      {twin && (
        <div style={timelineButtonsStyle}>
          {twin.protocol.timeline.slice(0, 12).map((step) => (
            <button
              type="button"
              key={step.index}
              onClick={() => onPathIndexChange(step.pathStart)}
              style={stepButtonStyle(current?.stepIndex === step.index)}
            >
              {step.index}: {step.command}
            </button>
          ))}
        </div>
      )}
      {twin && twin.warnings.length > 0 && (
        <p style={warningStyle}>{twin.warnings.length} AABB warning(s) in the simulated path.</p>
      )}
    </div>
  );
}

function currentSimulationPoint(twin: DigitalTwinBundle | null, pathIndex: number): DigitalTwinMotionPoint | null {
  if (!twin?.motion.path.length) return null;
  return twin.motion.path[Math.min(pathIndex, twin.motion.path.length - 1)];
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} style={segmentStyle}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          style={segmentButtonStyle(value === option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  marginBottom: 8,
  flexWrap: "wrap",
};

const controlsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const segmentStyle: CSSProperties = {
  display: "flex",
  border: "1px solid #cfd6df",
  borderRadius: 6,
  overflow: "hidden",
  background: "#fff",
};

function segmentButtonStyle(active: boolean): CSSProperties {
  return {
    border: "none",
    borderRight: "1px solid #cfd6df",
    background: active ? "#253041" : "#fff",
    color: active ? "#fff" : "#1f2937",
    padding: "5px 10px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
  };
}

const simulateButtonStyle: CSSProperties = {
  background: "#0f766e",
  color: "#fff",
  border: "none",
  padding: "6px 12px",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

const timelineStyle: CSSProperties = {
  marginTop: 10,
  padding: 10,
  border: "1px solid #d7dde5",
  borderRadius: 8,
  background: "#fbfcfd",
};

const timelineTopStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  fontSize: 12,
  color: "#4b5563",
  marginBottom: 6,
  flexWrap: "wrap",
};

const timelineButtonsStyle: CSSProperties = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
  marginTop: 6,
};

function stepButtonStyle(active: boolean): CSSProperties {
  return {
    background: active ? "#dbeafe" : "#fff",
    color: "#1f2937",
    border: "1px solid #cfd6df",
    borderRadius: 4,
    padding: "3px 6px",
    cursor: "pointer",
    fontSize: 11,
  };
}

const infoStyle: CSSProperties = {
  margin: "6px 0 0",
  color: "#4b5563",
  fontSize: 12,
};

const errorStyle: CSSProperties = {
  margin: "6px 0 0",
  color: "#dc2626",
  fontSize: 12,
};

const warningStyle: CSSProperties = {
  margin: "6px 0 0",
  color: "#b45309",
  fontSize: 12,
};
