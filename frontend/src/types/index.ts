// Mirrors backend Pydantic models

export interface Coordinate3D {
  x: number;
  y: number;
  z: number;
}

export interface CalibrationPoints {
  a1: Coordinate3D | null;
  a2: Coordinate3D;
}

export interface WellPlateConfig {
  type: "well_plate";
  name: string;
  model_name: string;
  rows: number;
  columns: number;
  length_mm: number;
  width_mm: number;
  height_mm: number;
  a1: Coordinate3D | null;
  calibration: CalibrationPoints;
  x_offset_mm: number;
  y_offset_mm: number;
  capacity_ul: number;
  working_volume_ul: number;
}

export interface VialConfig {
  type: "vial";
  name: string;
  model_name: string;
  height_mm: number;
  diameter_mm: number;
  location: Coordinate3D;
  capacity_ul: number;
  working_volume_ul: number;
}

export interface WallConfig {
  type: "wall";
  name: string;
  corner_1: Coordinate3D;
  corner_2: Coordinate3D;
}

export type LabwareConfig = WellPlateConfig | VialConfig | WallConfig;

export interface WellPosition {
  x: number;
  y: number;
  z: number;
}

export interface BoundingBox {
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
  z_min: number;
  z_max: number;
}

export interface LabwareResponse {
  key: string;
  config: LabwareConfig;
  wells: Record<string, WellPosition> | null;
  bounding_box: BoundingBox | null;
}

export interface DeckResponse {
  filename: string;
  labware: LabwareResponse[];
}

export interface DeckConfig {
  labware: Record<string, LabwareConfig>;
}

export interface InstrumentConfig {
  type: string;
  offset_x: number;
  offset_y: number;
  [key: string]: unknown;
}

export interface BoardResponse {
  filename: string;
  instruments: Record<string, InstrumentConfig>;
}

export interface BoardConfig {
  instruments: Record<string, InstrumentConfig>;
}

export interface WorkingVolume {
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
  z_min: number;
  z_max: number;
}

export interface CncConfig {
  homing_strategy: string;
  y_axis_motion?: "head" | "bed";
}

export interface GantryConfig {
  serial_port: string;
  cnc: CncConfig | null;
  working_volume: WorkingVolume;
}

export interface GantryResponse {
  filename: string;
  config: GantryConfig;
}

export interface GantryPosition {
  x: number;
  y: number;
  z: number;
  work_x: number | null;
  work_y: number | null;
  work_z: number | null;
  status: string;
  connected: boolean;
}

// Board introspection (from CubOS)

export interface InstrumentTypeInfo {
  type: string;
  is_mock: boolean;
}

export interface PipetteModelInfo {
  name: string;
  family: string;
  channels: number;
  max_volume: number;
  min_volume: number;
}

export interface InstrumentFieldInfo {
  name: string;
  type: string;
  required: boolean;
  default: unknown;
  choices: string[] | null;
}

export type InstrumentSchemas = Record<string, InstrumentFieldInfo[]>;

// Protocol

export interface CommandArg {
  name: string;
  type: string;
  required: boolean;
  default: unknown;
}

export interface CommandInfo {
  name: string;
  args: CommandArg[];
  description: string;
}

export interface ProtocolStep {
  command: string;
  args: Record<string, unknown>;
}

export interface ProtocolConfig {
  protocol: ProtocolStep[];
}

export interface ProtocolResponse {
  filename: string;
  steps: ProtocolStep[];
}

export interface ProtocolValidationResponse {
  valid: boolean;
  errors: string[];
}
