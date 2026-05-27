import { useState } from "react";

function tryParse(s: string): number | null {
  if (s === "" || s === "-" || s === "." || s === "-.") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function formatNumberInput(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

/** Amber "*" rendered next to a field label when the field's current
 * value differs from the last-saved value. Signals "unsaved local
 * edit" — distinct from the red "*" used for required-field markers.
 * Exported so inline <label> blocks (the ones that use a raw <select>
 * rather than NumberField/TextField) can reuse it without duplicating
 * the color/title/margin style inline. */
export function DirtyMarker() {
  return (
    <span
      style={{ color: "#d97706", fontWeight: 700, marginLeft: 2 }}
      title="Unsaved local edit"
    >
      *
    </span>
  );
}

interface NumberFieldProps {
  id?: string;
  name?: string;
  label: string;
  value: number | null | undefined;
  onChange: (v: number) => void;
  step?: number;
  required?: boolean;
  /** If set, renders an amber "*" next to the label when true. */
  dirty?: boolean;
}

export function NumberField({ id, name, label, value, onChange, required, dirty }: NumberFieldProps) {
  const normalizedValue = typeof value === "number" && Number.isFinite(value) ? value : NaN;
  const [state, setState] = useState({ raw: formatNumberInput(normalizedValue), value: normalizedValue });
  if (!Object.is(normalizedValue, state.value)) {
    setState({ raw: formatNumberInput(normalizedValue), value: normalizedValue });
  }
  const raw = state.raw;
  const setRaw = (next: string) => setState({ raw: next, value: normalizedValue });

  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
      <span style={{ color: "#666" }}>
        {label}
        {required && <span style={{ color: "#dc2626" }}> *</span>}
        {dirty && <DirtyMarker />}
      </span>
      <input
        id={id}
        name={name}
        type="text"
        inputMode="decimal"
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          const n = tryParse(e.target.value);
          if (n !== null) onChange(n);
        }}
        onBlur={() => setRaw(formatNumberInput(normalizedValue))}
        style={inputStyle}
      />
    </label>
  );
}


interface TextFieldProps {
  id?: string;
  name?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  /** If set, renders an amber "*" next to the label when true. */
  dirty?: boolean;
}

export function TextField({ id, name, label, value, onChange, required, dirty }: TextFieldProps) {
  const hasError = required && !value.trim();
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
      <span style={{ color: "#666" }}>
        {label}
        {required && <span style={{ color: "#dc2626" }}> *</span>}
        {dirty && <DirtyMarker />}
      </span>
      <input
        id={id}
        name={name}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={hasError ? { ...inputStyle, borderColor: "#dc2626" } : inputStyle}
      />
    </label>
  );
}

interface CoordinateFieldProps {
  id?: string;
  name?: string;
  label: string;
  value: { x: number; y: number; z: number };
  onChange: (v: { x: number; y: number; z: number }) => void;
  required?: boolean;
}

export function CoordinateField({ id, name, label, value, onChange, required }: CoordinateFieldProps) {
  const [state, setState] = useState({
    rx: String(value.x),
    ry: String(value.y),
    rz: String(value.z),
    x: value.x,
    y: value.y,
    z: value.z,
  });
  if (value.x !== state.x || value.y !== state.y || value.z !== state.z) {
    setState({
      rx: String(value.x),
      ry: String(value.y),
      rz: String(value.z),
      x: value.x,
      y: value.y,
      z: value.z,
    });
  }
  const { rx, ry, rz } = state;
  const setRx = (next: string) => setState({ ...state, rx: next });
  const setRy = (next: string) => setState({ ...state, ry: next });
  const setRz = (next: string) => setState({ ...state, rz: next });

  return (
    <div style={{ fontSize: 12 }}>
      <span style={{ color: "#666" }}>{label}{required && <span style={{ color: "#dc2626" }}> *</span>}</span>
      <div style={coordinateGridStyle}>
        <label style={axisFieldStyle}>
          <span style={axisLabelStyle}>X</span>
          <input
            id={id ? `${id}-x` : undefined}
            name={name ? `${name}_x` : undefined}
            aria-label={`${label} X`}
            type="text"
            inputMode="decimal"
            value={rx}
            onChange={(e) => { setRx(e.target.value); const n = tryParse(e.target.value); if (n !== null) onChange({ ...value, x: n }); }}
            onBlur={() => setRx(String(value.x))}
            style={{ ...inputStyle, width: "100%" }}
          />
        </label>
        <label style={axisFieldStyle}>
          <span style={axisLabelStyle}>Y</span>
          <input
            id={id ? `${id}-y` : undefined}
            name={name ? `${name}_y` : undefined}
            aria-label={`${label} Y`}
            type="text"
            inputMode="decimal"
            value={ry}
            onChange={(e) => { setRy(e.target.value); const n = tryParse(e.target.value); if (n !== null) onChange({ ...value, y: n }); }}
            onBlur={() => setRy(String(value.y))}
            style={{ ...inputStyle, width: "100%" }}
          />
        </label>
        <label style={axisFieldStyle}>
          <span style={axisLabelStyle}>Z</span>
          <input
            id={id ? `${id}-z` : undefined}
            name={name ? `${name}_z` : undefined}
            aria-label={`${label} Z`}
            type="text"
            inputMode="decimal"
            value={rz}
            onChange={(e) => { setRz(e.target.value); const n = tryParse(e.target.value); if (n !== null) onChange({ ...value, z: n }); }}
            onBlur={() => setRz(String(value.z))}
            style={{ ...inputStyle, width: "100%" }}
          />
        </label>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #ccc",
  color: "#1a1a1a",
  padding: "4px 6px",
  borderRadius: 4,
  fontSize: 13,
};

const coordinateGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 6,
  marginTop: 3,
};

const axisFieldStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "18px minmax(0, 1fr)",
  alignItems: "center",
  gap: 4,
  minWidth: 0,
};

const axisLabelStyle: React.CSSProperties = {
  color: "#1f2937",
  fontSize: 11,
  fontWeight: 700,
  textAlign: "center",
};

export function SelectField({
  id,
  name,
  label,
  value,
  options,
  onChange,
}: {
  id?: string;
  name?: string;
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
      <span style={{ color: "#666" }}>{label}</span>
      <select id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
        {options.length === 0 && <option value="">No configs found</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SaveButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "#2563eb",
        color: "#fff",
        border: "none",
        padding: "6px 20px",
        borderRadius: 4,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 13,
        fontWeight: 600,
        marginTop: 12,
      }}
    >
      Save
    </button>
  );
}
