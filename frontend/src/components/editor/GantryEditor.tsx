import { useState } from "react";
import type { GantryResponse, GantryConfig } from "../../types";
import { NumberField, SaveButton, TextField } from "./fields";
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
  onSave: (filename: string, body: GantryConfig) => void;
  /** Called on every local edit so the parent can persist the working
   * copy across tab switches (the editor unmounts on tab-away and would
   * otherwise lose its useState). */
  onLocalChange?: (gantry: GantryResponse) => void;
  onRefresh: () => void;
}

const HOMING_STRATEGIES = ["standard", "xy_hard_limits"];
const Y_AXIS_MOTION_OPTIONS = ["head", "bed"] as const;

const EMPTY_GANTRY: GantryConfig = {
  serial_port: "",
  cnc: { homing_strategy: "xy_hard_limits", y_axis_motion: "head" },
  working_volume: { x_min: 0, x_max: 300, y_min: 0, y_max: 200, z_min: 0, z_max: 80 },
};

export default function GantryEditor({ configs, selectedFile, onSelectFile, gantry, baseline, onSave, onLocalChange }: Props) {
  const [config, setConfig] = useState<GantryConfig | null>(() => (
    gantry ? structuredClone(gantry.config) : null
  ));
  const [saveAs, setSaveAs] = useState("");

  const commit = (next: GantryConfig) => {
    setConfig(next);
    onLocalChange?.({ filename: selectedFile ?? "unsaved", config: next });
  };

  const startNew = () => {
    commit(structuredClone(EMPTY_GANTRY));
  };

  // Per-field dirty compared against the last-saved config. A missing
  // baseline (creating a brand-new config) counts every set field as
  // dirty since there's nothing saved to compare against.
  const base = baseline?.config;
  const d = {
    serial_port: config ? config.serial_port !== (base?.serial_port ?? "") : false,
    homing_strategy: config ? config.cnc?.homing_strategy !== base?.cnc?.homing_strategy : false,
    y_axis_motion: config ? config.cnc?.y_axis_motion !== base?.cnc?.y_axis_motion : false,
    x_min: config ? config.working_volume.x_min !== base?.working_volume.x_min : false,
    x_max: config ? config.working_volume.x_max !== base?.working_volume.x_max : false,
    y_min: config ? config.working_volume.y_min !== base?.working_volume.y_min : false,
    y_max: config ? config.working_volume.y_max !== base?.working_volume.y_max : false,
    z_min: config ? config.working_volume.z_min !== base?.working_volume.z_min : false,
    z_max: config ? config.working_volume.z_max !== base?.working_volume.z_max : false,
  };

  const handleSave = () => {
    if (!config) return;
    const filename = saveAs.trim() || selectedFile || "";
    if (!filename) return;
    const normalized = filename.endsWith(".yaml") ? filename : filename + ".yaml";
    onSelectFile(normalized);
    onSave(normalized, config);
    setSaveAs("");
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <ImportFromFile configs={configs} onSelectFile={onSelectFile} label="Import gantry config" />
        {!config && <button onClick={startNew} style={addBtnStyle}>+ New Gantry Config</button>}
      </div>

      {config && (
        <>
          <div style={cardStyle}>
            <h4 style={{ margin: "0 0 8px", color: "#16a34a", fontSize: 13 }}>Connection</h4>
            <TextField
              label="Serial port"
              value={config.serial_port}
              onChange={(v) => commit({ ...config, serial_port: v })}
              dirty={d.serial_port}
            />
            <div style={{ marginTop: 8, display: "flex", gap: 16 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
                <span style={{ color: "#666" }}>
                  Homing strategy
                  {d.homing_strategy && <span style={{ color: "#d97706", fontWeight: 700, marginLeft: 2 }} title="Unsaved local edit">*</span>}
                </span>
                <select
                  value={config.cnc?.homing_strategy ?? "standard"}
                  onChange={(v) => commit({ ...config, cnc: { ...config.cnc!, homing_strategy: v.target.value } })}
                  style={selectStyle}
                >
                  {HOMING_STRATEGIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
                <span style={{ color: "#666" }}>
                  Y-axis motion
                  {d.y_axis_motion && <span style={{ color: "#d97706", fontWeight: 700, marginLeft: 2 }} title="Unsaved local edit">*</span>}
                </span>
                <select
                  value={config.cnc?.y_axis_motion ?? "head"}
                  onChange={(v) => commit({ ...config, cnc: { ...config.cnc!, y_axis_motion: v.target.value as "head" | "bed" } })}
                  style={selectStyle}
                >
                  {Y_AXIS_MOTION_OPTIONS.map((s) => <option key={s} value={s}>{s === "head" ? "Head moves" : "Bed moves"}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div style={cardStyle}>
            <h4 style={{ margin: "0 0 8px", color: "#16a34a", fontSize: 13 }}>Working Volume</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <NumberField label="X min" value={config.working_volume.x_min} onChange={(v) => commit({ ...config, working_volume: { ...config.working_volume, x_min: v } })} dirty={d.x_min} />
              <NumberField label="X max" value={config.working_volume.x_max} onChange={(v) => commit({ ...config, working_volume: { ...config.working_volume, x_max: v } })} dirty={d.x_max} />
              <NumberField label="Y min" value={config.working_volume.y_min} onChange={(v) => commit({ ...config, working_volume: { ...config.working_volume, y_min: v } })} dirty={d.y_min} />
              <NumberField label="Y max" value={config.working_volume.y_max} onChange={(v) => commit({ ...config, working_volume: { ...config.working_volume, y_max: v } })} dirty={d.y_max} />
              <NumberField label="Z min" value={config.working_volume.z_min} onChange={(v) => commit({ ...config, working_volume: { ...config.working_volume, z_min: v } })} dirty={d.z_min} />
              <NumberField label="Z max" value={config.working_volume.z_max} onChange={(v) => commit({ ...config, working_volume: { ...config.working_volume, z_max: v } })} dirty={d.z_max} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
            <input
              value={saveAs}
              onChange={(e) => setSaveAs(e.target.value)}
              placeholder={selectedFile ?? "my_gantry.yaml"}
              style={filenameInputStyle}
            />
            <SaveButton onClick={handleSave} disabled={!saveAs.trim() && !selectedFile} />
          </div>
        </>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#fafafa",
  border: "1px solid #e0e0e0",
  borderRadius: 6,
  padding: 12,
  marginTop: 8,
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

const filenameInputStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #ccc",
  color: "#1a1a1a",
  padding: "4px 8px",
  borderRadius: 4,
  fontSize: 13,
  flex: 1,
};
