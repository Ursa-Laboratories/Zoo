import { useState } from "react";

interface Props {
  configs: string[];
  onSelectFile: (f: string) => void;
  label: string;
}

export default function ImportFromFile({ configs, onSelectFile, label }: Props) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={importBtnStyle}>
        {label}
      </button>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
      <select
        aria-label={label}
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) {
            onSelectFile(e.target.value);
            setOpen(false);
          }
        }}
        style={selectStyle}
      >
        <option value="" disabled>Select file...</option>
        {configs.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <button onClick={() => setOpen(false)} style={cancelBtnStyle}>Cancel</button>
    </div>
  );
}

const importBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#2563eb",
  border: "1px dashed #2563eb",
  padding: "5px 14px",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  marginBottom: 8,
};

const selectStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #ccc",
  color: "#1a1a1a",
  padding: "4px 6px",
  borderRadius: 4,
  fontSize: 13,
  flex: 1,
};

const cancelBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#888",
  border: "1px solid #ddd",
  padding: "4px 10px",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
};
