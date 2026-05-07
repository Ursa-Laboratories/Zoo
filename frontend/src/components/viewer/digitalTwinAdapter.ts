import type {
  Coordinate3D,
  DeckResponse,
  DigitalTwinAabb,
  DigitalTwinBundle,
  DigitalTwinLabwareItem,
  DigitalTwinMotionPoint,
  GantryPosition,
  GantryResponse,
  LabwareResponse,
} from "../../types";

const SCHEMA_VERSION = "digital-twin.v1";

export function liveTwinFromZoo(
  deck: DeckResponse | null,
  gantry: GantryResponse | null,
  position: GantryPosition | null,
): { twin: DigitalTwinBundle | null; current: DigitalTwinMotionPoint | null } {
  if (!gantry) {
    return { twin: null, current: null };
  }

  const gantryPoint = positionToPoint(position, gantry.config.working_volume);
  const instrument = firstInstrument(gantry);
  const tool = {
    x: gantryPoint.x + instrument.offset.x,
    y: gantryPoint.y + instrument.offset.y,
    z: gantryPoint.z - instrument.depth,
  };
  const current: DigitalTwinMotionPoint = {
    index: 0,
    stepIndex: -1,
    command: "live",
    phase: position?.status ?? "idle",
    targetRef: "live:gantry",
    instrument: instrument.name,
    tool,
    gantry: gantryPoint,
    envelope: instrumentEnvelope(tool, instrument.depth, instrument.name),
  };

  const twin: DigitalTwinBundle = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      gantry: gantry.filename,
      deck: deck?.filename ?? null,
      protocol: null,
      mode: "live",
    },
    coordinateSystem: {
      frame: "CubOS deck frame",
      origin: "front-left-bottom reachable work volume",
      axes: { "+x": "right", "+y": "away/back", "+z": "up" },
      units: "millimeters",
    },
    gantry: {
      yAxisMotion: gantry.config.cnc.y_axis_motion ?? "head",
      workingVolume: gantry.config.working_volume,
      homePosition: {
        x: gantry.config.working_volume.x_max,
        y: gantry.config.working_volume.y_max,
        z: gantry.config.working_volume.z_max,
      },
      instruments: Object.entries(gantry.config.instruments).map(([name, config]) => ({
        name,
        type: config.type,
        vendor: config.vendor ?? null,
        offset: { x: config.offset_x ?? 0, y: config.offset_y ?? 0, z: 0 },
        depth: config.depth ?? 0,
        safeApproachHeight: config.safe_approach_height ?? 40,
        measurementHeight: config.measurement_height ?? 0,
      })),
    },
    deck: { labware: (deck?.labware ?? []).map(labwareFromZoo) },
    protocol: {
      positions: {},
      timeline: [],
    },
    motion: {
      timeline: [],
      segments: [],
      path: [current],
    },
    warnings: [],
  };

  return { twin, current };
}

export function simulationPointToGantryPosition(point: DigitalTwinMotionPoint | null): GantryPosition | null {
  if (!point) return null;
  return {
    x: point.gantry.x,
    y: point.gantry.y,
    z: point.gantry.z,
    work_x: point.gantry.x,
    work_y: point.gantry.y,
    work_z: point.gantry.z,
    status: `${point.command}:${point.phase}`,
    connected: true,
  };
}

function labwareFromZoo(item: LabwareResponse): DigitalTwinLabwareItem {
  const points = item.positions ?? item.wells ?? {};
  const aabb = aabbFromPoints(item.key, item.config.type, Object.values(points), item.geometry);
  const tipState: Record<string, boolean> | undefined = "tip_present" in item.config
    ? item.config.tip_present as Record<string, boolean>
    : undefined;
  return {
    key: item.key,
    parentKey: null,
    name: item.config.name,
    kind: item.config.type,
    modelName: "model_name" in item.config ? String(item.config.model_name ?? "") : "",
    anchor: item.location ?? firstPoint(points) ?? { x: 0, y: 0, z: 0 },
    geometry: {
      lengthMm: item.geometry?.length_mm ?? geometryValue(item.config, "length_mm"),
      widthMm: item.geometry?.width_mm ?? geometryValue(item.config, "width_mm"),
      heightMm: item.geometry?.height_mm ?? geometryValue(item.config, "height_mm"),
      diameterMm: geometryValue(item.config, "diameter_mm"),
    },
    aabb,
    positions: points,
    wells: item.wells ? Object.entries(item.wells).map(([id, center]) => ({ id, center })) : undefined,
    tips: item.config.type === "tip_rack"
      ? Object.entries(points).map(([id, center]) => ({ id, center, present: Boolean(tipState?.[id] ?? true) }))
      : undefined,
    children: [],
  };
}

function firstInstrument(gantry: GantryResponse) {
  const entry = Object.entries(gantry.config.instruments)[0];
  if (!entry) {
    return {
      name: "instrument",
      offset: { x: 0, y: 0, z: 0 },
      depth: 0,
    };
  }
  const [name, config] = entry;
  return {
    name,
    offset: {
      x: Number(config.offset_x ?? 0),
      y: Number(config.offset_y ?? 0),
      z: 0,
    },
    depth: Number(config.depth ?? 0),
  };
}

function positionToPoint(position: GantryPosition | null, volume: GantryResponse["config"]["working_volume"]): Coordinate3D {
  if (position?.connected) {
    return {
      x: position.work_x ?? position.x,
      y: position.work_y ?? position.y,
      z: position.work_z ?? position.z,
    };
  }
  return { x: volume.x_max, y: volume.y_max, z: volume.z_max };
}

function instrumentEnvelope(tool: Coordinate3D, depthMm: number, label: string): DigitalTwinAabb {
  const width = 18;
  const height = Math.max(Math.abs(depthMm), 20);
  return aabbFromBaseCenter(tool, width, width, height, label, "instrument_envelope");
}

function aabbFromPoints(
  label: string,
  kind: string,
  points: Coordinate3D[],
  geometry?: { length_mm: number | null; width_mm: number | null; height_mm: number | null },
): DigitalTwinAabb | null {
  if (points.length === 0) return null;
  let minX = Math.min(...points.map((point) => point.x));
  let maxX = Math.max(...points.map((point) => point.x));
  let minY = Math.min(...points.map((point) => point.y));
  let maxY = Math.max(...points.map((point) => point.y));
  const minZ = Math.min(...points.map((point) => point.z));
  const length = geometry?.length_mm ?? null;
  const width = geometry?.width_mm ?? null;
  const height = geometry?.height_mm ?? 1;

  if (length != null) {
    const centerX = (minX + maxX) / 2;
    minX = Math.min(minX, centerX - length / 2);
    maxX = Math.max(maxX, centerX + length / 2);
  }
  if (width != null) {
    const centerY = (minY + maxY) / 2;
    minY = Math.min(minY, centerY - width / 2);
    maxY = Math.max(maxY, centerY + width / 2);
  }

  return aabbFromMinMax(
    { x: minX, y: minY, z: minZ },
    { x: maxX, y: maxY, z: minZ + height },
    label,
    kind,
  );
}

function aabbFromBaseCenter(
  center: Coordinate3D,
  lengthMm: number,
  widthMm: number,
  heightMm: number,
  label: string,
  kind: string,
): DigitalTwinAabb {
  return aabbFromMinMax(
    { x: center.x - lengthMm / 2, y: center.y - widthMm / 2, z: center.z },
    { x: center.x + lengthMm / 2, y: center.y + widthMm / 2, z: center.z + heightMm },
    label,
    kind,
  );
}

function aabbFromMinMax(min: Coordinate3D, max: Coordinate3D, label: string, kind: string): DigitalTwinAabb {
  return {
    label,
    kind,
    min,
    max,
    size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z },
    center: {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    },
  };
}

function firstPoint(points: Record<string, Coordinate3D>): Coordinate3D | null {
  return Object.values(points)[0] ?? null;
}

function geometryValue(config: object, key: string): number | null {
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "number" ? value : null;
}
