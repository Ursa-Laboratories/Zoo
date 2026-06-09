import { useState } from "react";
import type {
  GantryResponse,
  GantryConfig,
  GrblSettingsConfig,
  InstrumentConfig,
  InstrumentSchemas,
  InstrumentTypeInfo,
} from "../../types";
import { DirtyMarker, NumberField, SaveButton, TextField, UnsavedNotice } from "./fields";
import { isFieldEqual } from "./field-utils";
import ImportFromFile from "./ImportFromFile";

interface Props {
  configs: string[];
  selectedFile: string | null;
  onSelectFile: (f: string) => void;
  gantry: GantryResponse | null;
  /** The server-loaded config; used to decide which fields show the
   * amber "*" dirty marker. Differs from ``gantry`` when the parent
   * is passing a local working copy with unsaved edits. */
  baseline: GantryResponse | null;
  instrumentTypes: InstrumentTypeInfo[];
  instrumentSchemas: InstrumentSchemas;
  onSave: (filename: string, body: GantryConfig) => Promise<void> | void;
  /** Called on every local edit so the parent can persist the working
   * copy across tab switches (the editor unmounts on tab-away and would
   * otherwise lose its useState). */
  onLocalChange?: (gantry: GantryResponse) => void;
  /** True when this gantry has local edits not yet saved to disk. The
   * prompt to save lives here (not in the Protocol tab) because this is
   * where the gantry is written. */
  dirty?: boolean;
  onRefresh: () => void;
}

const HOMING_STRATEGIES = ["standard"] as const;
const Y_AXIS_MOTION_OPTIONS = ["head", "bed"] as const;

const EMPTY_GANTRY: GantryConfig = {
  serial_port: "",
  gantry_type: "cub_xl",
  cnc: {
    homing_strategy: "standard",
    factory_z_travel_mm: 80,
    calibration_block_height_mm: 35,
    y_axis_motion: "head",
    safe_z: 80,
  },
  working_volume: { x_min: 0, x_max: 300, y_min: 0, y_max: 200, z_min: 0, z_max: 80 },
  grbl_settings: {},
  instruments: {},
};

const GRBL_NUMBER_FIELDS: Array<{ key: keyof GrblSettingsConfig; label: string }> = [
  { key: "dir_invert_mask", label: "Dir invert mask" },
  { key: "status_report", label: "Status report" },
  { key: "homing_dir_mask", label: "Homing dir mask" },
  { key: "homing_pull_off", label: "Homing pull-off" },
  { key: "steps_per_mm_x", label: "Steps/mm X" },
  { key: "steps_per_mm_y", label: "Steps/mm Y" },
  { key: "steps_per_mm_z", label: "Steps/mm Z" },
  { key: "max_rate_x", label: "Max rate X" },
  { key: "max_rate_y", label: "Max rate Y" },
  { key: "max_rate_z", label: "Max rate Z" },
  { key: "accel_x", label: "Accel X" },
  { key: "accel_y", label: "Accel Y" },
  { key: "accel_z", label: "Accel Z" },
  { key: "max_travel_x", label: "Max travel X" },
  { key: "max_travel_y", label: "Max travel Y" },
  { key: "max_travel_z", label: "Max travel Z" },
];

const GRBL_BOOLEAN_FIELDS: Array<{ key: keyof GrblSettingsConfig; label: string }> = [
  { key: "soft_limits", label: "Soft limits" },
  { key: "hard_limits", label: "Hard limits" },
  { key: "homing_enable", label: "Homing enable" },
];

const INSTRUMENT_COLORS: Record<string, string> = {
  asmi: "#2563eb",
  uvvis_ccs: "#7c3aed",
  pipette: "#059669",
  filmetrics: "#d97706",
  potentiostat: "#dc2626",
  uv_curing: "#0891b2",
};

export default function GantryEditor({
  configs,
  selectedFile,
  onSelectFile,
  gantry,
  baseline,
  instrumentTypes,
  instrumentSchemas,
  onSave,
  onLocalChange,
  dirty,
}: Props) {
  const [config, setConfig] = useState<GantryConfig | null>(() => (
    gantry ? structuredClone(gantry.config) : null
  ));
  const [addType, setAddType] = useState<string>("");
  const [saveAs, setSaveAs] = useState("");
  const [saving, setSaving] = useState(false);
  // GRBL lives under a collapsed "Advanced settings" panel. Start it
  // open only when GRBL already has unsaved edits (e.g. coming back to
  // this tab) so hidden changes are never silently buried.
  const [advancedOpen, setAdvancedOpen] = useState(() => {
    const current = gantry?.config.grbl_settings ?? {};
    const saved = baseline?.config.grbl_settings ?? {};
    return [...GRBL_BOOLEAN_FIELDS, ...GRBL_NUMBER_FIELDS].some(
      ({ key }) => !isFieldEqual((current as Record<string, unknown>)[key], (saved as Record<string, unknown>)[key]),
    );
  });

  const selectedAddType = addType || instrumentTypes[0]?.type || "";

  const commit = (next: GantryConfig) => {
    setConfig(next);
    onLocalChange?.({ filename: selectedFile ?? "unsaved", config: next });
  };

  const startNew = () => {
    commit(structuredClone(EMPTY_GANTRY));
  };

  const updateInstrument = (key: string, inst: InstrumentConfig) => {
    if (!config) return;
    commit({
      ...config,
      instruments: { ...config.instruments, [key]: inst },
    });
  };

  const removeInstrument = (key: string) => {
    if (!config) return;
    const next = { ...config.instruments };
    delete next[key];
    commit({ ...config, instruments: next });
  };

  const addInstrument = () => {
    if (!config || !selectedAddType) return;
    let idx = Object.keys(config.instruments).length + 1;
    let key = `${selectedAddType}_${idx}`;
    while (config.instruments[key]) {
      idx += 1;
      key = `${selectedAddType}_${idx}`;
    }

    const vendors = vendorsForType(instrumentTypes, selectedAddType);
    const template: InstrumentConfig = {
      type: selectedAddType,
      vendor: vendors[0] ?? "",
      offset_x: 0,
      offset_y: 0,
      depth: 0,
      measurement_height: 0,
      safe_approach_height: 0,
    };
    const fields = instrumentSchemas[selectedAddType] ?? [];
    for (const field of fields) {
      if (field.default != null) {
        (template as Record<string, unknown>)[field.name] = field.default;
      }
    }
    commit({ ...config, instruments: { ...config.instruments, [key]: template } });
  };

  const updateGrblSetting = (field: keyof GrblSettingsConfig, value: number | boolean | null) => {
    if (!config) return;
    const nextSettings = { ...(config.grbl_settings ?? {}) };
    if (value === null) {
      delete nextSettings[field];
    } else {
      (nextSettings as Record<string, number | boolean>)[field] = value;
    }
    commit({ ...config, grbl_settings: nextSettings });
  };

  // Per-field dirty compared against the last-saved config. A missing
  // baseline means there's nothing saved yet (brand-new config).
  const base = baseline?.config;
  const notDirty = (a: unknown, b: unknown) => !base || isFieldEqual(a, b);
  const wv = config?.working_volume;
  const bwv = base?.working_volume;
  const cnc = config?.cnc;
  const bcnc = base?.cnc;
  const d = {
    serial_port: !!config && !notDirty(config.serial_port, base?.serial_port ?? ""),
    gantry_type: !!config && !notDirty(config.gantry_type, base?.gantry_type),
    homing_strategy: !!cnc && !notDirty(cnc.homing_strategy, bcnc?.homing_strategy),
    factory_z_travel_mm: !!cnc && !notDirty(cnc.factory_z_travel_mm, bcnc?.factory_z_travel_mm),
    calibration_block_height_mm: !!cnc && !notDirty(cnc.calibration_block_height_mm, bcnc?.calibration_block_height_mm),
    safe_z: !!cnc && !notDirty(cnc.safe_z, bcnc?.safe_z),
    y_axis_motion: !!cnc && !notDirty(cnc.y_axis_motion, bcnc?.y_axis_motion),
    x_min: !!wv && !notDirty(wv.x_min, bwv?.x_min),
    x_max: !!wv && !notDirty(wv.x_max, bwv?.x_max),
    y_min: !!wv && !notDirty(wv.y_min, bwv?.y_min),
    y_max: !!wv && !notDirty(wv.y_max, bwv?.y_max),
    z_min: !!wv && !notDirty(wv.z_min, bwv?.z_min),
    z_max: !!wv && !notDirty(wv.z_max, bwv?.z_max),
  };

  const canSave = !!config && isValidGantry(config) && (!!saveAs.trim() || !!selectedFile) && !saving;

  const handleSave = async () => {
    if (!config || !canSave) return;
    const filename = saveAs.trim() || selectedFile || "";
    const normalized = filename.endsWith(".yaml") ? filename : filename + ".yaml";
    setSaving(true);
    try {
      await Promise.resolve(onSave(normalized, config));
      onSelectFile(normalized);
      setSaveAs("");
    } catch (err) {
      console.error("Gantry save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={configPickerRowStyle}>
        <ImportFromFile configs={configs} onSelectFile={onSelectFile} label="Import gantry config" />
        {!config && <button onClick={startNew} style={newConfigBtnStyle}>+ New config</button>}
      </div>

      {config && (
        <>
          <div style={cardStyle}>
            <h4 style={{ margin: "0 0 8px", color: "#16a34a", fontSize: 13 }}>Connection</h4>
            <TextField
              id="gantry-serial-port"
              name="serial_port"
              label="Serial port"
              value={config.serial_port}
              onChange={(v) => commit({ ...config, serial_port: v })}
              dirty={d.serial_port}
            />
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <SelectField
                id="gantry-type"
                name="gantry_type"
                label="Gantry type"
                value={config.gantry_type}
                options={[
                  { value: "cub", label: "Cub" },
                  { value: "cub_xl", label: "Cub XL" },
                ]}
                onChange={(v) => commit({ ...config, gantry_type: v as "cub" | "cub_xl" })}
                dirty={d.gantry_type}
                required
              />
              <SelectField
                id="gantry-homing-strategy"
                name="homing_strategy"
                label="Homing strategy"
                value={config.cnc.homing_strategy}
                options={HOMING_STRATEGIES.map((s) => ({ value: s, label: s }))}
                onChange={() => commit({ ...config, cnc: { ...config.cnc, homing_strategy: "standard" } })}
                dirty={d.homing_strategy}
              />
              <SelectField
                id="gantry-y-axis-motion"
                name="y_axis_motion"
                label="Y-axis motion"
                value={config.cnc.y_axis_motion ?? "head"}
                options={Y_AXIS_MOTION_OPTIONS.map((s) => ({ value: s, label: s === "head" ? "Head moves" : "Bed moves" }))}
                onChange={(v) => commit({ ...config, cnc: { ...config.cnc, y_axis_motion: v as "head" | "bed" } })}
                dirty={d.y_axis_motion}
              />
              <NumberField
                id="gantry-factory-z-travel"
                name="factory_z_travel_mm"
                label="Factory Z travel"
                value={config.cnc.factory_z_travel_mm}
                onChange={(v) => commit({ ...config, cnc: { ...config.cnc, factory_z_travel_mm: v } })}
                dirty={d.factory_z_travel_mm}
                required
              />
              <NumberField
                id="gantry-calibration-block-height"
                name="calibration_block_height_mm"
                label="Block height"
                value={Number(config.cnc.calibration_block_height_mm ?? 0)}
                onChange={(v) => commit({ ...config, cnc: { ...config.cnc, calibration_block_height_mm: v } })}
                dirty={d.calibration_block_height_mm}
                required
              />
              <NumberField
                id="gantry-safe-z"
                name="safe_z"
                label="Safe Z"
                value={Number(config.cnc.safe_z ?? config.working_volume.z_max)}
                onChange={(v) => commit({ ...config, cnc: { ...config.cnc, safe_z: v } })}
                dirty={d.safe_z}
              />
            </div>
          </div>

          <div style={cardStyle}>
            <h4 style={{ margin: "0 0 8px", color: "#16a34a", fontSize: 13 }}>Working Volume</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <NumberField id="wv-xmin" name="x_min" label="X min" value={config.working_volume.x_min} onChange={(v) => commit({ ...config, working_volume: { ...config.working_volume, x_min: v } })} dirty={d.x_min} />
              <NumberField id="wv-xmax" name="x_max" label="X max" value={config.working_volume.x_max} onChange={(v) => commit({ ...config, working_volume: { ...config.working_volume, x_max: v } })} dirty={d.x_max} />
              <NumberField id="wv-ymin" name="y_min" label="Y min" value={config.working_volume.y_min} onChange={(v) => commit({ ...config, working_volume: { ...config.working_volume, y_min: v } })} dirty={d.y_min} />
              <NumberField id="wv-ymax" name="y_max" label="Y max" value={config.working_volume.y_max} onChange={(v) => commit({ ...config, working_volume: { ...config.working_volume, y_max: v } })} dirty={d.y_max} />
              <NumberField id="wv-zmin" name="z_min" label="Z min" value={config.working_volume.z_min} onChange={(v) => commit({ ...config, working_volume: { ...config.working_volume, z_min: v } })} dirty={d.z_min} />
              <NumberField id="wv-zmax" name="z_max" label="Z max" value={config.working_volume.z_max} onChange={(v) => commit({ ...config, working_volume: { ...config.working_volume, z_max: v } })} dirty={d.z_max} />
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <h4 style={{ margin: 0, color: "#16a34a", fontSize: 13 }}>Instruments</h4>
              <div style={{ display: "flex", gap: 8 }}>
                <select value={selectedAddType} onChange={(e) => setAddType(e.target.value)} style={selectStyle}>
                  {instrumentTypes.map((it) => (
                    <option key={it.type} value={it.type}>{typeLabel(it.type)}{it.is_mock ? " (mock)" : ""}</option>
                  ))}
                </select>
                <button onClick={addInstrument} style={addBtnStyle} disabled={!selectedAddType}>+ Add</button>
              </div>
            </div>

            {Object.entries(config.instruments).map(([key, inst]) => {
              const color = INSTRUMENT_COLORS[inst.type] ?? INSTRUMENT_COLORS[inst.type.replace("mock_", "")] ?? "#666";
              const fields = instrumentSchemas[inst.type] ?? [];
              const vendors = vendorsForType(instrumentTypes, inst.type);
              return (
                <div key={key} style={instrumentCardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <h4 style={{ margin: 0, color, fontSize: 13 }}>
                      {key} <span style={{ fontWeight: 400, color: "#888", fontSize: 11 }}>({typeLabel(inst.type)})</span>
                    </h4>
                    <button onClick={() => removeInstrument(key)} style={removeBtnStyle}>Remove</button>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <TextField
                      id={`${key}-type`}
                      name={`${key}_type`}
                      label="Type"
                      value={inst.type}
                      onChange={(v) => updateInstrument(key, { ...inst, type: v })}
                      dirty={isInstrumentFieldDirty(baseline, key, "type", inst.type)}
                      required
                    />
                    {vendors.length > 0 ? (
                      <SelectField
                        id={`${key}-vendor`}
                        name={`${key}_vendor`}
                        label="Vendor"
                        value={inst.vendor}
                        options={vendors.map((v) => ({ value: v, label: v }))}
                        onChange={(v) => updateInstrument(key, { ...inst, vendor: v })}
                        dirty={isInstrumentFieldDirty(baseline, key, "vendor", inst.vendor)}
                        required
                      />
                    ) : (
                      <TextField
                        id={`${key}-vendor`}
                        name={`${key}_vendor`}
                        label="Vendor"
                        value={inst.vendor}
                        onChange={(v) => updateInstrument(key, { ...inst, vendor: v })}
                        dirty={isInstrumentFieldDirty(baseline, key, "vendor", inst.vendor)}
                        required
                      />
                    )}
                    <NumberField id={`${key}-offset-x`} name={`${key}_offset_x`} label="Offset X" value={inst.offset_x} onChange={(v) => updateInstrument(key, { ...inst, offset_x: v })} dirty={isInstrumentFieldDirty(baseline, key, "offset_x", inst.offset_x)} />
                    <NumberField id={`${key}-offset-y`} name={`${key}_offset_y`} label="Offset Y" value={inst.offset_y} onChange={(v) => updateInstrument(key, { ...inst, offset_y: v })} dirty={isInstrumentFieldDirty(baseline, key, "offset_y", inst.offset_y)} />
                    <NumberField id={`${key}-depth`} name={`${key}_depth`} label="Depth" value={Number(inst.depth ?? 0)} onChange={(v) => updateInstrument(key, { ...inst, depth: v })} dirty={isInstrumentFieldDirty(baseline, key, "depth", inst.depth)} />
                    <NumberField id={`${key}-measurement-height`} name={`${key}_measurement_height`} label="Measurement height" value={Number(inst.measurement_height ?? 0)} onChange={(v) => updateInstrument(key, { ...inst, measurement_height: v })} dirty={isInstrumentFieldDirty(baseline, key, "measurement_height", inst.measurement_height)} />
                    <NumberField id={`${key}-safe-approach`} name={`${key}_safe_approach`} label="Safe approach" value={Number(inst.safe_approach_height ?? inst.measurement_height ?? 0)} onChange={(v) => updateInstrument(key, { ...inst, safe_approach_height: v })} dirty={isInstrumentFieldDirty(baseline, key, "safe_approach_height", inst.safe_approach_height)} />
                  </div>

                  {fields.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                      {fields.map((field) => {
                        const value = (inst as Record<string, unknown>)[field.name];
                        const fieldDirty = isInstrumentFieldDirty(baseline, key, field.name, value);
                        if (field.choices) {
                          return (
                            <SelectField
                              key={field.name}
                              id={`${key}-${field.name}`}
                              name={`${key}_${field.name}`}
                              label={fieldLabel(field.name) + (field.required ? " *" : "")}
                              value={String(value ?? field.default ?? "")}
                              options={field.choices.map((c) => ({ value: c, label: c }))}
                              onChange={(v) => updateInstrument(key, { ...inst, [field.name]: v })}
                              dirty={fieldDirty}
                            />
                          );
                        }
                        if (field.type === "bool") {
                          return (
                            <SelectField
                              key={field.name}
                              id={`${key}-${field.name}`}
                              name={`${key}_${field.name}`}
                              label={fieldLabel(field.name) + (field.required ? " *" : "")}
                              value={String(value ?? field.default ?? false)}
                              options={[{ value: "true", label: "true" }, { value: "false", label: "false" }]}
                              onChange={(v) => updateInstrument(key, { ...inst, [field.name]: v === "true" })}
                              dirty={fieldDirty}
                            />
                          );
                        }
                        if (field.type === "float" || field.type === "int") {
                          return (
                            <NumberField
                              key={field.name}
                              id={`${key}-${field.name}`}
                              name={`${key}_${field.name}`}
                              label={fieldLabel(field.name) + (field.required ? " *" : "")}
                              value={Number(value ?? field.default ?? 0)}
                              onChange={(v) => updateInstrument(key, { ...inst, [field.name]: v })}
                              dirty={fieldDirty}
                            />
                          );
                        }
                        return (
                          <TextField
                            key={field.name}
                            id={`${key}-${field.name}`}
                            name={`${key}_${field.name}`}
                            label={fieldLabel(field.name) + (field.required ? " *" : "")}
                            value={String(value ?? field.default ?? "")}
                            onChange={(v) => updateInstrument(key, { ...inst, [field.name]: v })}
                            dirty={fieldDirty}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {(() => {
            const grblDirty = [...GRBL_BOOLEAN_FIELDS, ...GRBL_NUMBER_FIELDS].some(
              ({ key }) => !notDirty(config.grbl_settings?.[key], base?.grbl_settings?.[key]),
            );
            return (
              <div style={cardStyle}>
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((open) => !open)}
                  aria-expanded={advancedOpen}
                  style={advancedHeaderStyle}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "#6b7280", fontSize: 12, width: 12, display: "inline-block" }}>
                      {advancedOpen ? "▾" : "▸"}
                    </span>
                    Advanced settings
                    {grblDirty && <DirtyMarker />}
                  </span>
                  <span style={{ color: "#9ca3af", fontSize: 11, fontWeight: 400 }}>GRBL Settings</span>
                </button>
                {advancedOpen && (
                  <div style={{ marginTop: 12 }}>
                    <h4 style={{ margin: "0 0 8px", color: "#16a34a", fontSize: 13 }}>GRBL Settings</h4>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      {GRBL_BOOLEAN_FIELDS.map(({ key, label }) => (
                        <OptionalBooleanField
                          key={key}
                          id={`grbl-${key}`}
                          name={key}
                          label={label}
                          value={config.grbl_settings?.[key] as boolean | null | undefined}
                          onChange={(v) => updateGrblSetting(key, v)}
                          dirty={!notDirty(config.grbl_settings?.[key], base?.grbl_settings?.[key])}
                        />
                      ))}
                      {GRBL_NUMBER_FIELDS.map(({ key, label }) => (
                        <OptionalNumberField
                          key={key}
                          id={`grbl-${key}`}
                          name={key}
                          label={label}
                          value={config.grbl_settings?.[key] as number | null | undefined}
                          onChange={(v) => updateGrblSetting(key, v)}
                          dirty={!notDirty(config.grbl_settings?.[key], base?.grbl_settings?.[key])}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {dirty && (
            <div style={{ marginTop: 12 }}>
              <UnsavedNotice>
                <strong>Unsaved changes.</strong>{" "}
                Save this gantry before running a protocol — runs use the saved file, not your edits.
              </UnsavedNotice>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
            <input
              value={saveAs}
              onChange={(e) => setSaveAs(e.target.value)}
              placeholder={selectedFile ?? "my_gantry.yaml"}
              style={filenameInputStyle}
            />
            <SaveButton onClick={handleSave} disabled={!canSave} />
          </div>
        </>
      )}
    </div>
  );
}

function isValidGantry(config: GantryConfig): boolean {
  const wv = config.working_volume;
  if (wv.x_min >= wv.x_max || wv.y_min >= wv.y_max || wv.z_min >= wv.z_max) return false;
  if (config.cnc.factory_z_travel_mm <= 0 || config.cnc.factory_z_travel_mm < wv.z_max - wv.z_min) return false;
  if (config.cnc.calibration_block_height_mm != null && config.cnc.calibration_block_height_mm <= 0) return false;
  if (config.cnc.safe_z != null && (config.cnc.safe_z < wv.z_min || config.cnc.safe_z > wv.z_max)) return false;
  for (const inst of Object.values(config.instruments)) {
    if (!inst.type.trim() || !inst.vendor.trim()) return false;
    const measurement = Number(inst.measurement_height ?? 0);
    const safe = inst.safe_approach_height == null ? measurement : Number(inst.safe_approach_height);
    if (safe < measurement) return false;
  }
  return true;
}

function isInstrumentFieldDirty(
  baseline: GantryResponse | null,
  key: string,
  field: string,
  current: unknown,
): boolean {
  const base = baseline?.config.instruments?.[key];
  if (base === undefined) return false;
  return !isFieldEqual((base as Record<string, unknown>)[field], current);
}

function vendorsForType(instrumentTypes: InstrumentTypeInfo[], type: string): string[] {
  return instrumentTypes.find((it) => it.type === type)?.vendors ?? [];
}

function typeLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fieldLabel(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function SelectField({
  id,
  name,
  label,
  value,
  options,
  onChange,
  dirty,
  required,
}: {
  id?: string;
  name?: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  dirty?: boolean;
  required?: boolean;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
      <span style={{ color: "#666" }}>
        {label}
        {required && <span style={{ color: "#dc2626" }}> *</span>}
        {dirty && <DirtyMarker />}
      </span>
      <select id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function OptionalNumberField({
  id,
  name,
  label,
  value,
  onChange,
  dirty,
}: {
  id?: string;
  name?: string;
  label: string;
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  dirty?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "end", gap: 4 }}>
      <div style={{ flex: 1 }}>
        <NumberField
          id={id}
          name={name}
          label={label}
          value={Number(value ?? 0)}
          onChange={(v) => onChange(v)}
          dirty={dirty}
        />
      </div>
      <button onClick={() => onChange(null)} disabled={value == null} style={clearBtnStyle}>Clear</button>
    </div>
  );
}

function OptionalBooleanField({
  id,
  name,
  label,
  value,
  onChange,
  dirty,
}: {
  id?: string;
  name?: string;
  label: string;
  value: boolean | null | undefined;
  onChange: (value: boolean | null) => void;
  dirty?: boolean;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
      <span style={{ color: "#666" }}>
        {label}
        {dirty && <DirtyMarker />}
      </span>
      <select
        id={id}
        name={name}
        value={value == null ? "" : value ? "true" : "false"}
        onChange={(e) => {
          if (e.target.value === "") onChange(null);
          else onChange(e.target.value === "true");
        }}
        style={selectStyle}
      >
        <option value="">unset</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    </label>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#fafafa",
  border: "1px solid #e0e0e0",
  borderRadius: 6,
  padding: 12,
  marginTop: 8,
};

const advancedHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  width: "100%",
  background: "transparent",
  border: "none",
  padding: 0,
  margin: 0,
  cursor: "pointer",
  color: "#374151",
  fontSize: 13,
  fontWeight: 700,
};

const instrumentCardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e0e0e0",
  borderRadius: 6,
  padding: 12,
  marginTop: 10,
};

const configPickerRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "end",
  gap: 10,
  marginBottom: 12,
  flexWrap: "wrap",
};

const selectStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #ccc",
  color: "#1a1a1a",
  padding: "4px 6px",
  borderRadius: 4,
  fontSize: 13,
};

const addBtnStyle: React.CSSProperties = {
  background: "#fff",
  color: "#16a34a",
  border: "1px solid #16a34a",
  padding: "5px 14px",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const newConfigBtnStyle: React.CSSProperties = {
  background: "#fff",
  color: "#16a34a",
  border: "1px solid #16a34a",
  height: 34,
  padding: "0 12px",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const removeBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#999",
  border: "1px solid #ddd",
  padding: "2px 10px",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 11,
};

const clearBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#888",
  border: "1px solid #ddd",
  padding: "4px 8px",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 11,
};

const filenameInputStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #ccc",
  color: "#1a1a1a",
  padding: "4px 8px",
  borderRadius: 4,
  fontSize: 13,
  flex: 1,
};
