import { useState } from "react";

function tryParse(s: string): number | null {
  if (s === "" || s === "-" || s === "." || s === "-.") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
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
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  required?: boolean;
  /** If set, renders an amber "*" next to the label when true. */
  dirty?: boolean;
}

export function NumberField({ label, value, onChange, required, dirty }: NumberFieldProps) {
  const [state, setState] = useState({ raw: String(value), value });
  if (value !== state.value) {
    setState({ raw: String(value), value });
  }
  const raw = state.raw;
  const setRaw = (next: string) => setState({ raw: next, value });

  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
      <span style={{ color: "#666" }}>
        {label}
        {required && <span style={{ color: "#dc2626" }}> *</span>}
        {dirty && <DirtyMarker />}
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          const n = tryParse(e.target.value);
          if (n !== null) onChange(n);
        }}
        onBlur={() => setRaw(String(value))}
        style={inputStyle}
      />
    </label>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  /** If set, renders an amber "*" next to the label when true. */
  dirty?: boolean;
}

export function TextField({ label, value, onChange, required, dirty }: TextFieldProps) {
  const hasError = required && !value.trim();
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
      <span style={{ color: "#666" }}>
        {label}
        {required && <span style={{ color: "#dc2626" }}> *</span>}
        {dirty && <DirtyMarker />}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={hasError ? { ...inputStyle, borderColor: "#dc2626" } : inputStyle}
      />
    </label>
  );
}

interface CoordinateFieldProps {
  label: string;
  value: { x: number; y: number; z: number };
  onChange: (v: { x: number; y: number; z: number }) => void;
  required?: boolean;
}

export function CoordinateField({ label, value, onChange, required }: CoordinateFieldProps) {
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
      <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
        <input
          type="text"
          inputMode="decimal"
          value={rx}
          onChange={(e) => { setRx(e.target.value); const n = tryParse(e.target.value); if (n !== null) onChange({ ...value, x: n }); }}
          onBlur={() => setRx(String(value.x))}
          style={{ ...inputStyle, width: 80 }}
          placeholder="X"
        />
        <input
          type="text"
          inputMode="decimal"
          value={ry}
          onChange={(e) => { setRy(e.target.value); const n = tryParse(e.target.value); if (n !== null) onChange({ ...value, y: n }); }}
          onBlur={() => setRy(String(value.y))}
          style={{ ...inputStyle, width: 80 }}
          placeholder="Y"
        />
        <input
          type="text"
          inputMode="decimal"
          value={rz}
          onChange={(e) => { setRz(e.target.value); const n = tryParse(e.target.value); if (n !== null) onChange({ ...value, z: n }); }}
          onBlur={() => setRz(String(value.z))}
          style={{ ...inputStyle, width: 80 }}
          placeholder="Z"
        />
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

export function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
      <span style={{ color: "#666" }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
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
