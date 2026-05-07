import { useEffect, useState } from "react";
import type { DeckResponse, LabwareConfig, WellPlateConfig, VialConfig, DeckConfig } from "../../types";
import { CoordinateField, NumberField, SaveButton, TextField } from "./fields";
import ImportFromFile from "./ImportFromFile";

interface Props {
  configs: string[];
  selectedFile: string | null;
  onSelectFile: (f: string) => void;
  onImportFile: (f: string) => void;
  deck: DeckResponse | null;
  onSave: (filename: string, body: DeckConfig) => void;
  onLocalChange: (deck: DeckResponse) => void;
  onRefresh: () => void;
}

const EMPTY_WELL_PLATE: WellPlateConfig = {
  type: "well_plate",
  name: "",
  model_name: "",
  rows: 8,
  columns: 12,
  length_mm: 127.76,
  width_mm: 85.47,
  height_mm: 14.22,
  a1: null,
  calibration: {
    a1: { x: 100.0, y: 50.0, z: 20.0 },
    a2: { x: 91.0, y: 50.0, z: 20.0 },
  },
  x_offset_mm: 9.0,
  y_offset_mm: 9.0,
  capacity_ul: 200.0,
  working_volume_ul: 150.0,
};

const EMPTY_VIAL: VialConfig = {
  type: "vial",
  name: "",
  model_name: "",
  height_mm: 66.75,
  diameter_mm: 28.0,
  location: { x: 30.0, y: 40.0, z: 20.0 },
  capacity_ul: 1500.0,
  working_volume_ul: 1200.0,
};

function buildDeckResponse(labware: Record<string, LabwareConfig>, filename: string): DeckResponse {
  return {
    filename,
    labware: Object.entries(labware).map(([key, config]) => ({
      key,
      config,
      wells: null,
    })),
  };
}

function isValid(labware: Record<string, LabwareConfig>): boolean {
  for (const entry of Object.values(labware)) {
    // Only validate editable types; unsupported types are preserved as-is.
    if (!isEditableDeckLabware(entry)) continue;
    if (!entry.name.trim()) return false;
  }
  return true;
}

function isEditableDeckLabware(entry: LabwareConfig): entry is WellPlateConfig | VialConfig {
  return entry.type === "well_plate" || entry.type === "vial";
}

function labwareFromDeck(deck: DeckResponse | null): Record<string, LabwareConfig> {
  const obj: Record<string, LabwareConfig> = {};
  deck?.labware.forEach((item) => {
    obj[item.key] = structuredClone(item.config);
  });
  return obj;
}

export default function DeckEditor({ configs, selectedFile, onSelectFile, onImportFile, deck, onSave, onLocalChange }: Props) {
  const [labware, setLabware] = useState<Record<string, LabwareConfig>>(() => labwareFromDeck(deck));
  const [saveAs, setSaveAs] = useState("");

  useEffect(() => {
    setLabware(labwareFromDeck(deck));
  }, [deck]);

  const syncViz = (next: Record<string, LabwareConfig>) => {
    onLocalChange(buildDeckResponse(next, selectedFile ?? "unsaved"));
  };

  const updateLabware = (key: string, updated: LabwareConfig) => {
    const next = { ...labware, [key]: updated };
    setLabware(next);
    syncViz(next);
  };

  const removeLabware = (key: string) => {
    const next = { ...labware };
    delete next[key];
    setLabware(next);
    syncViz(next);
  };

  const addLabware = (type: "well_plate" | "vial") => {
    const idx = Object.keys(labware).length + 1;
    const key = type === "well_plate" ? `wellplate_${idx}` : `vial_${idx}`;
    const template = type === "well_plate" ? structuredClone(EMPTY_WELL_PLATE) : structuredClone(EMPTY_VIAL);
    const next = { ...labware, [key]: template };
    setLabware(next);
    syncViz(next);
  };

  const hasItems = Object.keys(labware).length > 0;
  const valid = hasItems && isValid(labware);
  const canSave = valid && (!!saveAs.trim() || !!selectedFile);

  const handleSave = () => {
    if (!canSave) return;
    const filename = saveAs.trim() || selectedFile || "";
    const normalized = filename.endsWith(".yaml") ? filename : `${filename}.yaml`;
    onSelectFile(normalized);
    onSave(normalized, { labware });
    setSaveAs("");
  };

  return (
    <div>
      <ImportFromFile configs={configs} onSelectFile={onImportFile} label="Import deck config" />

      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <button onClick={() => addLabware("well_plate")} style={addBtnStyle}>
          + Well Plate
        </button>
        <button onClick={() => addLabware("vial")} style={addBtnStyle}>
          + Vial
        </button>
      </div>

      {Object.entries(labware).map(([key, entry]) => (
        <div key={key} style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h4 style={{ margin: 0, color: "#2563eb", fontSize: 13 }}>{key}</h4>
            <button onClick={() => removeLabware(key)} style={removeBtnStyle}>Remove</button>
          </div>
          {isEditableDeckLabware(entry) ? (
            <>
              <TextField label="Name" value={entry.name} onChange={(v) => updateLabware(key, { ...entry, name: v })} required />
              <TextField label="Model" value={entry.model_name} onChange={(v) => updateLabware(key, { ...entry, model_name: v })} />
              {entry.type === "well_plate" && <WellPlateFields entry={entry} onChange={(v) => updateLabware(key, v)} />}
              {entry.type === "vial" && <VialFields entry={entry} onChange={(v) => updateLabware(key, v)} />}
            </>
          ) : (
            <div style={unsupportedNoteStyle}>
              <strong>{entry.type}</strong> — editing not supported. This entry will be passed through to CubOS unchanged on save.
            </div>
          )}
        </div>
      ))}

      {hasItems && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
          <input
            value={saveAs}
            onChange={(e) => setSaveAs(e.target.value)}
            placeholder={selectedFile ?? "my_deck.yaml"}
            style={filenameInputStyle}
          />
          <SaveButton
            disabled={!canSave}
            onClick={handleSave}
          />
        </div>
      )}
    </div>
  );
}

function WellPlateFields({ entry, onChange }: { entry: WellPlateConfig; onChange: (v: WellPlateConfig) => void }) {
  const a1 = entry.calibration.a1 ?? entry.a1 ?? { x: 0, y: 0, z: 0 };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <NumberField label="Rows" value={entry.rows} step={1} onChange={(v) => onChange({ ...entry, rows: v })} required />
        <NumberField label="Columns" value={entry.columns} step={1} onChange={(v) => onChange({ ...entry, columns: v })} required />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <NumberField label="Length (mm)" value={entry.length_mm} onChange={(v) => onChange({ ...entry, length_mm: v })} />
        <NumberField label="Width (mm)" value={entry.width_mm} onChange={(v) => onChange({ ...entry, width_mm: v })} />
        <NumberField label="Height (mm)" value={entry.height_mm} onChange={(v) => onChange({ ...entry, height_mm: v })} />
      </div>
      <CoordinateField label="Calibration A1" value={a1} onChange={(v) => onChange({ ...entry, calibration: { ...entry.calibration, a1: v } })} required />
      <CoordinateField label="Calibration A2" value={entry.calibration.a2} onChange={(v) => onChange({ ...entry, calibration: { ...entry.calibration, a2: v } })} required />
      <div style={{ display: "flex", gap: 8 }}>
        <NumberField label="Well pitch X (mm)" value={entry.x_offset_mm} onChange={(v) => onChange({ ...entry, x_offset_mm: v })} required />
        <NumberField label="Well pitch Y (mm)" value={entry.y_offset_mm} onChange={(v) => onChange({ ...entry, y_offset_mm: v })} required />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <NumberField label="Capacity (uL)" value={entry.capacity_ul} onChange={(v) => onChange({ ...entry, capacity_ul: v })} />
        <NumberField label="Working vol (uL)" value={entry.working_volume_ul} onChange={(v) => onChange({ ...entry, working_volume_ul: v })} />
      </div>
    </div>
  );
}

function VialFields({ entry, onChange }: { entry: VialConfig; onChange: (v: VialConfig) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <NumberField label="Height (mm)" value={entry.height_mm} onChange={(v) => onChange({ ...entry, height_mm: v })} />
        <NumberField label="Diameter (mm)" value={entry.diameter_mm} onChange={(v) => onChange({ ...entry, diameter_mm: v })} />
      </div>
      <CoordinateField label="Location" value={entry.location} onChange={(v) => onChange({ ...entry, location: v })} required />
      <div style={{ display: "flex", gap: 8 }}>
        <NumberField label="Capacity (uL)" value={entry.capacity_ul} onChange={(v) => onChange({ ...entry, capacity_ul: v })} />
        <NumberField label="Working vol (uL)" value={entry.working_volume_ul} onChange={(v) => onChange({ ...entry, working_volume_ul: v })} />
      </div>
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

const addBtnStyle: React.CSSProperties = {
  background: "#fff",
  color: "#2563eb",
  border: "1px solid #2563eb",
  padding: "5px 14px",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
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

const unsupportedNoteStyle: React.CSSProperties = {
  marginTop: 8,
  padding: "8px 10px",
  borderRadius: 4,
  background: "#fffbeb",
  border: "1px solid #fde68a",
  color: "#92400e",
  fontSize: 12,
};
