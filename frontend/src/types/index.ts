// Mirrors backend Pydantic models

export interface Coordinate3D {
  x: number;
  y: number;
  z: number;
}

export interface Coordinate2D {
  x: number;
  y: number;
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

export interface TipRackConfig {
  type: "tip_rack";
  name: string;
  model_name: string;
  load_name?: string;
  rows?: number;
  columns?: number;
  z_pickup?: number;
  z_drop?: number;
  tips?: Record<string, WellPosition>;
  tip_present?: Record<string, boolean>;
  [key: string]: unknown;
}

export interface NestedWellPlateConfig {
  name?: string;
  model_name: string;
  rows: number;
  columns: number;
  calibration: {
    a1: Coordinate2D | Coordinate3D | null;
    a2: Coordinate2D | Coordinate3D;
  };
  x_offset_mm: number;
  y_offset_mm: number;
  length_mm?: number;
  width_mm?: number;
  height_mm?: number;
  capacity_ul?: number;
  working_volume_ul?: number;
  [key: string]: unknown;
}

export interface NestedVialConfig {
  name?: string;
  model_name: string;
  height_mm: number;
  diameter_mm: number;
  location: Coordinate2D | Coordinate3D;
  capacity_ul: number;
  working_volume_ul: number;
  [key: string]: unknown;
}

export interface WellPlateHolderConfig {
  type: "well_plate_holder";
  name: string;
  model_name?: string;
  location?: Coordinate3D;
  well_plate?: NestedWellPlateConfig | null;
  [key: string]: unknown;
}

export interface VialHolderConfig {
  type: "vial_holder";
  name: string;
  model_name?: string;
  location?: Coordinate3D;
  vials?: Record<string, NestedVialConfig>;
  [key: string]: unknown;
}

export interface TipDisposalConfig {
  type: "tip_disposal";
  name: string;
  model_name?: string;
  location?: Coordinate3D;
  [key: string]: unknown;
}

export type UnsupportedDeckConfig =
  | TipRackConfig
  | WellPlateHolderConfig
  | VialHolderConfig
  | TipDisposalConfig;

export type LabwareConfig = WellPlateConfig | VialConfig | UnsupportedDeckConfig;

export interface WellPosition {
  x: number;
  y: number;
  z: number;
}

export interface GeometryResponse {
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
}

export interface LabwareResponse {
  key: string;
  config: LabwareConfig;
  wells: Record<string, WellPosition> | null;
  location?: Coordinate3D;
  geometry?: GeometryResponse;
  positions?: Record<string, WellPosition>;
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
