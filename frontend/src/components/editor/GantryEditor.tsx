import { useState } from "react";
import type { GantryResponse, GantryConfig } from "../../types";
import { NumberField, SaveButton, TextField } from "./fields";
import ImportFromFile from "./ImportFromFile";

interface Props {
  configs: string[];
  selectedFile: string | null;
  onSelectFile: (f: string) => void;
  gantry: GantryResponse | null;
  onSave: (filename: string, body: GantryConfig) => void;
  onRefresh: () => void;
}

const HOMING_STRATEGIES = ["standard", "xy_hard_limits"];
const Y_AXIS_MOTION_OPTIONS = ["head", "bed"] as const;

const EMPTY_GANTRY: GantryConfig = {
  serial_port: "",
  cnc: { homing_strategy: "xy_hard_limits", y_axis_motion: "head" },
  working_volume: { x_min: 0, x_max: 300, y_min: 0, y_max: 200, z_min: 0, z_max: 80 },
};

export default function GantryEditor({ configs, selectedFile, onSelectFile, gantry, onSave }: Props) {
  const [config, setConfig] = useState<GantryConfig | null>(() => (
    gantry ? structuredClone(gantry.config) : null
  ));
  const [saveAs, setSaveAs] = useState("");

  const startNew = () => {
    setConfig(structuredClone(EMPTY_GANTRY));
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
              onChange={(v) => setConfig({ ...config, serial_port: v })}
            />
            <div style={{ marginTop: 8, display: "flex", gap: 16 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
                <span style={{ color: "#666" }}>Homing strategy</span>
                <select
                  value={config.cnc?.homing_strategy ?? "standard"}
                  onChange={(v) => setConfig({ ...config, cnc: { ...config.cnc!, homing_strategy: v.target.value } })}
                  style={selectStyle}
                >
                  {HOMING_STRATEGIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
                <span style={{ color: "#666" }}>Y-axis motion</span>
                <select
                  value={config.cnc?.y_axis_motion ?? "head"}
                  onChange={(v) => setConfig({ ...config, cnc: { ...config.cnc!, y_axis_motion: v.target.value as "head" | "bed" } })}
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
              <NumberField label="X min" value={config.working_volume.x_min} onChange={(v) => setConfig({ ...config, working_volume: { ...config.working_volume, x_min: v } })} />
              <NumberField label="X max" value={config.working_volume.x_max} onChange={(v) => setConfig({ ...config, working_volume: { ...config.working_volume, x_max: v } })} />
              <NumberField label="Y min" value={config.working_volume.y_min} onChange={(v) => setConfig({ ...config, working_volume: { ...config.working_volume, y_min: v } })} />
              <NumberField label="Y max" value={config.working_volume.y_max} onChange={(v) => setConfig({ ...config, working_volume: { ...config.working_volume, y_max: v } })} />
              <NumberField label="Z min" value={config.working_volume.z_min} onChange={(v) => setConfig({ ...config, working_volume: { ...config.working_volume, z_min: v } })} />
              <NumberField label="Z max" value={config.working_volume.z_max} onChange={(v) => setConfig({ ...config, working_volume: { ...config.working_volume, z_max: v } })} />
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
