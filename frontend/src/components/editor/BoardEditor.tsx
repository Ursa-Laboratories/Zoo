import { useState } from "react";
import type { BoardResponse, InstrumentConfig, BoardConfig, InstrumentTypeInfo, InstrumentSchemas } from "../../types";
import { NumberField, SaveButton, TextField } from "./fields";
import ImportFromFile from "./ImportFromFile";

interface Props {
  configs: string[];
  selectedFile: string | null;
  onSelectFile: (f: string) => void;
  board: BoardResponse | null;
  instrumentTypes: InstrumentTypeInfo[];
  instrumentSchemas: InstrumentSchemas;
  onSave: (filename: string, body: BoardConfig) => void;
  onRefresh: () => void;
}

/** Convert snake_case type key to a readable label. */
function typeLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const INSTRUMENT_COLORS: Record<string, string> = {
  uvvis_ccs: "#7c3aed",
  pipette: "#059669",
  filmetrics: "#d97706",
};

export default function BoardEditor({ configs, selectedFile, onSelectFile, board, instrumentTypes, instrumentSchemas, onSave }: Props) {
  const [instruments, setInstruments] = useState<Record<string, InstrumentConfig>>(() => (
    board ? structuredClone(board.instruments) : {}
  ));
  const [addType, setAddType] = useState<string>("");
  const [saveAs, setSaveAs] = useState("");

  const selectedAddType = addType || instrumentTypes[0]?.type || "";

  const update = (key: string, inst: InstrumentConfig) => {
    setInstruments({ ...instruments, [key]: inst });
  };

  const remove = (key: string) => {
    const next = { ...instruments };
    delete next[key];
    setInstruments(next);
  };

  const addInstrument = () => {
    if (!selectedAddType) return;
    const idx = Object.keys(instruments).length + 1;
    const key = `${selectedAddType}_${idx}`;
    // Seed with type + defaults from schema.
    const template: InstrumentConfig = { type: selectedAddType, offset_x: 0, offset_y: 0 };
    const fields = instrumentSchemas[selectedAddType] ?? [];
    for (const field of fields) {
      if (field.default != null) {
        (template as Record<string, unknown>)[field.name] = field.default;
      }
    }
    setInstruments({ ...instruments, [key]: template });
  };

  const hasItems = Object.keys(instruments).length > 0;
  const canSave = hasItems && (!!saveAs.trim() || !!selectedFile);

  const handleSave = () => {
    if (!canSave) return;
    const filename = saveAs.trim() || selectedFile || "";
    const normalized = filename.endsWith(".yaml") ? filename : filename + ".yaml";
    onSelectFile(normalized);
    onSave(normalized, { instruments });
    setSaveAs("");
  };

  return (
    <div>
      <ImportFromFile configs={configs} onSelectFile={onSelectFile} label="Import board config" />

      <div style={{ display: "flex", gap: 8, margin: "12px 0", alignItems: "center" }}>
        <select value={selectedAddType} onChange={(e) => setAddType(e.target.value)} style={selectStyle}>
          {instrumentTypes.map((it) => (
            <option key={it.type} value={it.type}>{typeLabel(it.type)}{it.is_mock ? " (mock)" : ""}</option>
          ))}
        </select>
        <button onClick={addInstrument} style={addBtnStyle}>+ Add</button>
      </div>

      {Object.entries(instruments).map(([key, inst]) => {
        const color = INSTRUMENT_COLORS[inst.type] ?? INSTRUMENT_COLORS[inst.type.replace("mock_", "")] ?? "#666";
        const fields = instrumentSchemas[inst.type] ?? [];
        return (
          <div key={key} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h4 style={{ margin: 0, color, fontSize: 13 }}>
                {key} <span style={{ fontWeight: 400, color: "#888", fontSize: 11 }}>({typeLabel(inst.type)})</span>
              </h4>
              <button onClick={() => remove(key)} style={removeBtnStyle}>Remove</button>
            </div>

            {/* Common base-class fields (all instruments) */}
            <div style={{ display: "flex", gap: 8 }}>
              <NumberField label="Offset X" value={inst.offset_x} onChange={(v) => update(key, { ...inst, offset_x: v })} />
              <NumberField label="Offset Y" value={inst.offset_y} onChange={(v) => update(key, { ...inst, offset_y: v })} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <NumberField label="Depth" value={Number(inst.depth ?? 0)} onChange={(v) => update(key, { ...inst, depth: v })} />
              <NumberField label="Meas. height" value={Number(inst.measurement_height ?? 0)} onChange={(v) => update(key, { ...inst, measurement_height: v })} />
              <NumberField
                label="Safe approach"
                value={Number(inst.safe_approach_height ?? inst.measurement_height ?? 0)}
                onChange={(v) => update(key, { ...inst, safe_approach_height: v })}
              />
            </div>

            {/* Type-specific fields from CubOS instrument schema */}
            {fields.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {fields.map((field) => {
                  const value = (inst as Record<string, unknown>)[field.name];
                  if (field.choices) {
                    return (
                      <label key={field.name} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12, marginTop: 4 }}>
                        <span style={{ color: "#666" }}>{fieldLabel(field.name)}{field.required ? " *" : ""}</span>
                        <select
                          value={String(value ?? field.default ?? "")}
                          onChange={(e) => update(key, { ...inst, [field.name]: e.target.value })}
                          style={selectStyle}
                        >
                          {field.choices.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </label>
                    );
                  }
                  if (field.type === "float" || field.type === "int") {
                    return (
                      <NumberField
                        key={field.name}
                        label={fieldLabel(field.name) + (field.required ? " *" : "")}
                        value={Number(value ?? field.default ?? 0)}
                        step={field.type === "int" ? 1 : undefined}
                        onChange={(v) => update(key, { ...inst, [field.name]: v })}
                      />
                    );
                  }
                  return (
                    <TextField
                      key={field.name}
                      label={fieldLabel(field.name) + (field.required ? " *" : "")}
                      value={String(value ?? field.default ?? "")}
                      onChange={(v) => update(key, { ...inst, [field.name]: v })}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {hasItems && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
          <input
            value={saveAs}
            onChange={(e) => setSaveAs(e.target.value)}
            placeholder={selectedFile ?? "my_board.yaml"}
            style={filenameInputStyle}
          />
          <SaveButton onClick={handleSave} disabled={!canSave} />
        </div>
      )}
    </div>
  );
}

/** Convert snake_case field name to a readable label. */
function fieldLabel(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
  color: "#7c3aed",
  border: "1px solid #7c3aed",
  padding: "5px 14px",
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

const filenameInputStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #ccc",
  color: "#1a1a1a",
  padding: "4px 8px",
  borderRadius: 4,
  fontSize: 13,
  flex: 1,
};
