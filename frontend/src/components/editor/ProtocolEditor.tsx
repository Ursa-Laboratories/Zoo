import { useState } from "react";
import type { CommandInfo, ProtocolStep, ProtocolConfig } from "../../types";
import { NumberField, TextField } from "./fields";
import ImportFromFile from "./ImportFromFile";

interface Props {
  configs: string[];
  selectedFile: string | null;
  onSelectFile: (f: string) => void;
  commands: CommandInfo[];
  steps: ProtocolStep[] | null;
  onSave: (filename: string, body: ProtocolConfig) => void;
  /** Called on every local edit so the parent can persist the working
   * copy across tab switches. */
  onLocalChange?: (steps: ProtocolStep[]) => void;
  onValidate: (body: ProtocolConfig) => void;
  validationErrors: string[] | null;
  isValidating: boolean;
  onRefresh: () => void;
  onRun: () => void;
  isRunning: boolean;
  runMode: "simulation" | "hardware";
  onRunModeChange: (mode: "simulation" | "hardware") => void;
  runResult: { status: string; steps_executed: number } | null;
  runError: string | null;
}

const COMMAND_COLORS: Record<string, string> = {
  move: "#2563eb",
  aspirate: "#059669",
  dispense: "#059669",
  blowout: "#059669",
  mix: "#059669",
  pick_up_tip: "#059669",
  drop_tip: "#059669",
  scan: "#7c3aed",
};

function defaultArgsForCommand(cmd: CommandInfo): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const a of cmd.args) {
    if (a.required) {
      args[a.name] = a.type === "float" || a.type === "int" ? 0 : "";
    } else if (a.default != null) {
      args[a.name] = a.default;
    }
  }
  return args;
}

export default function ProtocolEditor({
  configs,
  selectedFile,
  onSelectFile,
  commands,
  steps: loadedSteps,
  onSave,
  onLocalChange,
  onValidate,
  validationErrors,
  isValidating,
  onRun,
  isRunning,
  runMode,
  onRunModeChange,
  runResult,
  runError,
}: Props) {
  const [steps, setSteps] = useState<ProtocolStep[]>(() => (
    loadedSteps ? structuredClone(loadedSteps) : []
  ));
  const [addCommand, setAddCommand] = useState(commands[0]?.name ?? "move");
  const [saveAs, setSaveAs] = useState("");

  const commandsByName = Object.fromEntries(commands.map((c) => [c.name, c]));

  const commit = (next: ProtocolStep[]) => {
    setSteps(next);
    onLocalChange?.(next);
  };

  const addStep = () => {
    const cmd = commandsByName[addCommand];
    if (!cmd) return;
    commit([...steps, { command: addCommand, args: defaultArgsForCommand(cmd) }]);
  };

  const removeStep = (i: number) => {
    commit(steps.filter((_, idx) => idx !== i));
  };

  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };

  const updateStepArg = (i: number, argName: string, value: unknown) => {
    const next = [...steps];
    next[i] = { ...next[i], args: { ...next[i].args, [argName]: value } };
    commit(next);
  };

  const buildConfig = (): ProtocolConfig => ({ protocol: steps });

  const handleValidate = () => onValidate(buildConfig());

  const handleSave = () => {
    const filename = saveAs.trim() || selectedFile || "";
    if (!filename) return;
    const normalized = filename.endsWith(".yaml") ? filename : filename + ".yaml";
    onSelectFile(normalized);
    onSave(normalized, { protocol: steps });
    setSaveAs("");
  };

  const hasSteps = steps.length > 0;
  const canSave = hasSteps && (!!saveAs.trim() || !!selectedFile);

  return (
    <div>
      <ImportFromFile configs={configs} onSelectFile={onSelectFile} label="Import protocol config" />

      <div style={{ display: "flex", gap: 8, margin: "12px 0", alignItems: "center" }}>
        <select value={addCommand} onChange={(e) => setAddCommand(e.target.value)} style={selectStyle}>
          {commands.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <button onClick={addStep} style={addBtnStyle}>
          + Add Step
        </button>
      </div>

      {steps.map((step, i) => {
        const cmd = commandsByName[step.command];
        const color = COMMAND_COLORS[step.command] ?? "#666";

        return (
          <div key={i} style={{ ...cardStyle, borderLeft: `3px solid ${color}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h4 style={{ margin: 0, fontSize: 13 }}>
                <span style={{ color: "#888", fontWeight: 400, fontSize: 11 }}>Step {i + 1}:</span>{" "}
                <span style={{ color }}>{step.command}</span>
              </h4>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => moveStep(i, -1)} disabled={i === 0} style={reorderBtnStyle} title="Move up">
                  ↑
                </button>
                <button onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} style={reorderBtnStyle} title="Move down">
                  ↓
                </button>
                <button onClick={() => removeStep(i)} style={removeBtnStyle}>
                  ✕
                </button>
              </div>
            </div>

            {cmd ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {cmd.args.map((arg) => {
                  const val = step.args[arg.name];
                  if (arg.type === "float" || arg.type === "int") {
                    return (
                      <NumberField
                        key={arg.name}
                        label={arg.name}
                        value={Number(val ?? 0)}
                        onChange={(v) => updateStepArg(i, arg.name, v)}
                        required={arg.required}
                      />
                    );
                  }
                  return (
                    <TextField
                      key={arg.name}
                      label={arg.name}
                      value={String(val ?? "")}
                      onChange={(v) => updateStepArg(i, arg.name, v)}
                      required={arg.required}
                    />
                  );
                })}
              </div>
            ) : (
              <p style={{ color: "#dc2626", fontSize: 12, margin: 0 }}>Unknown command: {step.command}</p>
            )}

            {validationErrors &&
              validationErrors
                .filter((e) => e.startsWith(`Step ${i}`))
                .map((e, j) => (
                  <p key={j} style={{ color: "#dc2626", fontSize: 11, margin: "4px 0 0" }}>
                    {e}
                  </p>
                ))}
          </div>
        );
      })}

      {hasSteps && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={saveAs}
              onChange={(e) => setSaveAs(e.target.value)}
              placeholder={selectedFile ?? "my_protocol.yaml"}
              style={filenameInputStyle}
            />
            <button onClick={handleValidate} disabled={isValidating} style={validateBtnStyle}>
              {isValidating ? "..." : "Validate"}
            </button>
            <button onClick={handleSave} disabled={!canSave} style={saveBtnStyle}>
              Save
            </button>
            <select
              aria-label="Protocol run target"
              value={runMode}
              onChange={(event) => onRunModeChange(event.target.value as "simulation" | "hardware")}
              style={runTargetStyle}
            >
              <option value="simulation">Simulation</option>
              <option value="hardware">Hardware</option>
            </select>
            <button onClick={onRun} disabled={isRunning || !hasSteps} style={runBtnStyle}>
              {isRunning ? "Running..." : runMode === "simulation" ? "Run Simulation" : "Run Hardware"}
            </button>
          </div>

          {validationErrors !== null && validationErrors.length === 0 && (
            <p style={{ color: "#059669", fontSize: 12, margin: "6px 0 0" }}>Protocol is valid.</p>
          )}
          {runResult && (
            <p style={{ color: "#059669", fontSize: 12, margin: "6px 0 0" }}>
              {runResult.status === "simulated" ? "Simulation ready" : "Protocol complete"} — {runResult.steps_executed} steps.
            </p>
          )}
          {runError && (
            <p style={{ color: "#dc2626", fontSize: 12, margin: "6px 0 0" }}>{runError}</p>
          )}
        </div>
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
  color: "#2563eb",
  border: "1px solid #2563eb",
  padding: "5px 14px",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const reorderBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#888",
  border: "1px solid #ddd",
  padding: "2px 6px",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  lineHeight: 1,
};

const removeBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#dc2626",
  border: "1px solid #ddd",
  padding: "2px 8px",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  lineHeight: 1,
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

const validateBtnStyle: React.CSSProperties = {
  background: "#fff",
  color: "#7c3aed",
  border: "1px solid #7c3aed",
  padding: "5px 14px",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

const saveBtnStyle: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  padding: "6px 20px",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const runTargetStyle: React.CSSProperties = {
  background: "#fff",
  color: "#1a1a1a",
  border: "1px solid #ccc",
  padding: "5px 8px",
  borderRadius: 4,
  fontSize: 12,
};

const runBtnStyle: React.CSSProperties = {
  background: "#059669",
  color: "#fff",
  border: "none",
  padding: "6px 20px",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};
