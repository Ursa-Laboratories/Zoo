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
import "./viewer.css";

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
    <div className="viewer-panel">
      <div className="viewer-panel__header">
        <h3 className="viewer-panel__title">Deck Visualization</h3>
        <div className="viewer-panel__controls">
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
            className="viewer-panel__simulate"
          >
            {simulationLoading ? "Simulating..." : "Run Simulation"}
          </button>
        </div>
      </div>

      <div className="viewer-panel__body">
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
          <DigitalTwinScene
            twin={twin}
            current={current}
            pathIndex={simulationPathIndex}
            loading={simulationLoading}
            error={simulationError}
            onPathIndexChange={mode === "simulation" ? onSimulationPathIndexChange : undefined}
          />
        )}
      </div>

      {mode === "simulation" && view === "2d" && (
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
    <div className="simulation-timeline">
      <div className="simulation-timeline__top">
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
        className="simulation-timeline__range"
      />
      {loading && <p className="simulation-timeline__info">Building Digital Sim motion bundle...</p>}
      {error && <p className="simulation-timeline__error">{error}</p>}
      {twin && (
        <div className="simulation-timeline__steps">
          {twin.protocol.timeline.slice(0, 12).map((step) => (
            <button
              type="button"
              key={step.index}
              onClick={() => onPathIndexChange(step.pathStart)}
              className={current?.stepIndex === step.index ? "active" : undefined}
            >
              {step.index}: {step.command}
            </button>
          ))}
        </div>
      )}
      {twin && twin.warnings.length > 0 && (
        <p className="simulation-timeline__warning">{twin.warnings.length} AABB warning(s) in the simulated path.</p>
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
    <div role="group" aria-label={label} className="viewer-panel__segment">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
