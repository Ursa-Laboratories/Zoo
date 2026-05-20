import { useState } from "react";
import type {
  CommandInfo,
  DeckResponse,
  GantryResponse,
  LabwareResponse,
  ProtocolStep,
  ProtocolConfig,
} from "../../types";
import { NumberField, TextField } from "./fields";
import ImportFromFile from "./ImportFromFile";

interface Props {
  configs: string[];
  selectedFile: string | null;
  onSelectFile: (f: string) => void;
  commands: CommandInfo[];
  deck: DeckResponse;
  gantry: GantryResponse;
  steps: ProtocolStep[] | null;
  positions?: Record<string, number[]> | null;
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

type ProtocolChoices = {
  instruments: string[];
  plates: string[];
  positions: string[];
  instrumentTypes: Record<string, string>;
};

function defaultArgsForCommand(cmd: CommandInfo, choices: ProtocolChoices): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const a of cmd.args) {
    const contextual = defaultArgValue(a.name, choices, args);
    if (contextual !== undefined) {
      args[a.name] = contextual;
    } else if (a.required) {
      args[a.name] = isNumericType(a.type) ? 0 : "";
    } else if (a.default != null) {
      args[a.name] = a.default;
    }
  }
  if (isAsmiIndentationStep(args, choices)) {
    args.method_kwargs = {
      step_size: 0.1,
      force_limit: 10,
      baseline_samples: 10,
      measure_with_return: false,
    };
  }
  return args;
}

export default function ProtocolEditor({
  configs,
  selectedFile,
  onSelectFile,
  commands,
  deck,
  gantry,
  steps: loadedSteps,
  positions,
  onSave,
  onLocalChange,
  onValidate,
  validationErrors,
  isValidating,
  onRun,
  isRunning,
  runResult,
  runError,
}: Props) {
  const [steps, setSteps] = useState<ProtocolStep[]>(() => (
    loadedSteps ? structuredClone(loadedSteps) : []
  ));
  const [addCommand, setAddCommand] = useState(commands[0]?.name ?? "move");
  const [saveAs, setSaveAs] = useState("");

  const commandsByName = Object.fromEntries(commands.map((c) => [c.name, c]));
  const choices = buildProtocolChoices(deck, gantry);

  const commit = (next: ProtocolStep[]) => {
    setSteps(next);
    onLocalChange?.(next);
  };

  const addStep = () => {
    const cmd = commandsByName[addCommand];
    if (!cmd) return;
    commit([...steps, { command: addCommand, args: defaultArgsForCommand(cmd, choices) }]);
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
    const updatedArgs = { ...next[i].args, [argName]: value };
    if (argName === "instrument") {
      const methods = measurementMethodsForInstrument(String(value), choices);
      if (methods.length > 0 && !methods.includes(String(updatedArgs.method ?? ""))) {
        updatedArgs.method = methods[0];
      }
    }
    if ((argName === "instrument" || argName === "method") && isAsmiIndentationStep(updatedArgs, choices)) {
      updatedArgs.method_kwargs = {
        step_size: 0.1,
        force_limit: 10,
        baseline_samples: 10,
        measure_with_return: false,
        ...(isRecord(updatedArgs.method_kwargs) ? updatedArgs.method_kwargs : {}),
      };
    }
    next[i] = { ...next[i], args: updatedArgs };
    commit(next);
  };

  const buildConfig = (): ProtocolConfig => (
    positions ? { positions, protocol: steps } : { protocol: steps }
  );

  const handleValidate = () => onValidate(buildConfig());

  const handleSave = () => {
    const filename = saveAs.trim() || selectedFile || "";
    if (!filename) return;
    const normalized = filename.endsWith(".yaml") ? filename : filename + ".yaml";
    onSelectFile(normalized);
    onSave(normalized, buildConfig());
    setSaveAs("");
  };

  const hasSteps = steps.length > 0;
  const canSave = hasSteps && (!!saveAs.trim() || !!selectedFile);

  return (
    <div>
      <div style={protocolPickerStyle}>
        <ImportFromFile configs={configs} onSelectFile={onSelectFile} label="Import protocol config" />
      </div>

      {!hasSteps && (
        <div style={emptyProtocolStyle}>
          Load a protocol or add steps.
        </div>
      )}

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
                  const contextualOptions = optionsForArg(arg.name, step.args, choices);
                  const argOptions = contextualOptions.length > 0
                    ? includeCurrentOption(contextualOptions, val)
                    : [];
                  if (argOptions.length > 0) {
                    return (
                      <SmartSelectField
                        key={arg.name}
                        label={argLabel(arg.name)}
                        value={String(val ?? "")}
                        options={argOptions}
                        onChange={(v) => updateStepArg(i, arg.name, v)}
                        required={arg.required}
                      />
                    );
                  }
                  if (arg.name === "method_kwargs") {
                    return (
                      <MethodOptionsField
                        key={arg.name}
                        value={val}
                        asmiIndentation={isAsmiIndentationStep(step.args, choices)}
                        onChange={(v) => updateStepArg(i, arg.name, v)}
                      />
                    );
                  }
                  if (isNumericType(arg.type)) {
                    return (
                      <NumberField
                        key={arg.name}
                        label={argLabel(arg.name)}
                        value={Number(val ?? 0)}
                        onChange={(v) => updateStepArg(i, arg.name, v)}
                        required={arg.required}
                      />
                    );
                  }
                  return (
                    <TextField
                      key={arg.name}
                      label={argLabel(arg.name)}
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

      <div style={addStepPanelStyle}>
        <label style={toolbarFieldStyle}>
          <span style={toolbarLabelStyle}>Add step</span>
          <select value={addCommand} onChange={(e) => setAddCommand(e.target.value)} style={selectStyle}>
            {commands.map((c) => (
              <option key={c.name} value={c.name}>
                {commandLabel(c.name)}
              </option>
            ))}
          </select>
        </label>
        <button onClick={addStep} style={addBtnStyle}>
          Add
        </button>
      </div>

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
            <button onClick={onRun} disabled={isRunning || !hasSteps} style={runBtnStyle}>
              {isRunning ? "Running..." : "Run Protocol"}
            </button>
          </div>

          {validationErrors !== null && validationErrors.length === 0 && (
            <p style={{ color: "#059669", fontSize: 12, margin: "6px 0 0" }}>Protocol is valid.</p>
          )}
          {validationErrors !== null && validationErrors.length > 0 && (
            <div style={{ color: "#dc2626", fontSize: 12, margin: "6px 0 0" }}>
              {validationErrors.map((error, i) => (
                <div key={i}>{error}</div>
              ))}
            </div>
          )}
          {runResult && (
            <p style={{ color: "#059669", fontSize: 12, margin: "6px 0 0" }}>
              Protocol complete — {runResult.steps_executed} steps executed.
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

function defaultArgValue(name: string, choices: ProtocolChoices, current: Record<string, unknown>): unknown {
  if (name === "instrument") return choices.instruments[0] ?? "";
  if (name === "plate") return choices.plates[0] ?? "";
  if (isPositionArg(name)) return choices.positions[0] ?? "";
  if (name === "method") {
    const instrument = String(current.instrument ?? choices.instruments[0] ?? "");
    return measurementMethodsForInstrument(instrument, choices)[0] ?? "measure";
  }
  return undefined;
}

function buildProtocolChoices(deck: DeckResponse, gantry: GantryResponse): ProtocolChoices {
  const instruments = Object.keys(gantry.config.instruments);
  const instrumentTypes = Object.fromEntries(
    Object.entries(gantry.config.instruments).map(([name, instrument]) => [name, instrument.type]),
  );
  const plates = deck.labware
    .filter((item) => item.config.type === "well_plate" || item.wells)
    .map((item) => item.key);
  const positions = uniqueStrings(deck.labware.flatMap(targetsForLabware));
  return { instruments, plates, positions, instrumentTypes };
}

function targetsForLabware(item: LabwareResponse): string[] {
  const targets: string[] = [];
  const wells = item.wells ? Object.keys(item.wells).sort(wellSort) : generatedWellIds(item);
  if (wells.length > 0) {
    targets.push(...wells.map((well) => `${item.key}.${well}`));
  }
  const positions = item.positions ? Object.keys(item.positions).sort(wellSort) : [];
  if (positions.length > 0) {
    targets.push(...positions.map((position) => `${item.key}.${position}`));
  }
  if (targets.length === 0) {
    targets.push(item.key);
  }
  return targets;
}

function generatedWellIds(item: LabwareResponse): string[] {
  if (item.config.type !== "well_plate") return [];
  const rows = Math.max(0, Number(item.config.rows) || 0);
  const columns = Math.max(0, Number(item.config.columns) || 0);
  const ids: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    const rowName = String.fromCharCode("A".charCodeAt(0) + row);
    for (let column = 1; column <= columns; column += 1) {
      ids.push(`${rowName}${column}`);
    }
  }
  return ids;
}

function wellSort(left: string, right: string): number {
  const a = /^([A-Za-z]+)(\d+)$/.exec(left);
  const b = /^([A-Za-z]+)(\d+)$/.exec(right);
  if (a && b && a[1] === b[1]) return Number(a[2]) - Number(b[2]);
  return left.localeCompare(right, undefined, { numeric: true });
}

function optionsForArg(
  name: string,
  args: Record<string, unknown>,
  choices: ProtocolChoices,
): string[] {
  if (name === "instrument") return choices.instruments;
  if (name === "plate") return choices.plates;
  if (isPositionArg(name)) return choices.positions;
  if (name === "method") return measurementMethodsForInstrument(String(args.instrument ?? ""), choices);
  return [];
}

function includeCurrentOption(options: string[], current: unknown): string[] {
  const value = String(current ?? "");
  if (!value || options.includes(value)) return options;
  return [value, ...options];
}

function measurementMethodsForInstrument(instrument: string, choices: ProtocolChoices): string[] {
  const type = inferInstrumentType(instrument, choices);
  if (type === "asmi") return ["indentation", "measure"];
  if (["filmetrics", "uvvis_ccs", "uv_curing"].includes(type)) return ["measure"];
  if (type === "pipette") return [];
  return ["measure"];
}

function inferInstrumentType(instrument: string, choices: ProtocolChoices): string {
  const raw = choices.instrumentTypes[instrument] ?? instrument;
  const normalized = raw.replace(/^mock_/, "").toLowerCase();
  if (normalized.includes("asmi")) return "asmi";
  if (normalized.includes("filmetrics")) return "filmetrics";
  if (normalized.includes("uvvis")) return "uvvis_ccs";
  if (normalized.includes("uv_curing")) return "uv_curing";
  if (normalized.includes("pipette")) return "pipette";
  return normalized;
}

function isPositionArg(name: string): boolean {
  return ["position", "source", "destination"].includes(name);
}

function isNumericType(type: string): boolean {
  return type.includes("float") || type.includes("int");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAsmiIndentationStep(args: Record<string, unknown>, choices: ProtocolChoices): boolean {
  const instrument = String(args.instrument ?? "");
  const type = inferInstrumentType(instrument, choices);
  return type === "asmi" && String(args.method ?? "") === "indentation";
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function argLabel(name: string): string {
  const labels: Record<string, string> = {
    delay_s: "Delay (s)",
    indentation_limit_height: "Indentation limit height",
    interwell_scan_height: "Interwell scan height",
    measurement_height: "Measurement height",
    method: "Measurement",
    method_kwargs: "Method options",
    volume_ul: "Volume (uL)",
  };
  return labels[name] ?? commandLabel(name);
}

function commandLabel(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function SmartSelectField({
  label,
  value,
  options,
  onChange,
  required,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
      <span style={{ color: "#666" }}>
        {label}
        {required && <span style={{ color: "#dc2626" }}> *</span>}
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value)} style={selectStyle}>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function MethodOptionsField({
  value,
  asmiIndentation,
  onChange,
}: {
  value: unknown;
  asmiIndentation: boolean;
  onChange: (value: Record<string, unknown>) => void;
}) {
  if (!asmiIndentation) return null;
  const options = isRecord(value) ? value : {};
  const update = (key: string, nextValue: unknown) => onChange({ ...options, [key]: nextValue });
  return (
    <div style={methodOptionsStyle}>
      <div style={methodOptionsTitleStyle}>ASMI indentation options</div>
      <div style={methodOptionsGridStyle}>
        <NumberField
          label="Force limit (N)"
          value={Number(options.force_limit ?? 10)}
          onChange={(v) => update("force_limit", v)}
        />
        <NumberField
          label="Step size (mm)"
          value={Number(options.step_size ?? 0.1)}
          onChange={(v) => update("step_size", v)}
        />
        <NumberField
          label="Baseline samples"
          value={Number(options.baseline_samples ?? 10)}
          onChange={(v) => update("baseline_samples", Math.max(1, Math.round(v)))}
        />
        <SmartSelectField
          label="Measure with return"
          value={String(Boolean(options.measure_with_return ?? false))}
          options={["false", "true"]}
          onChange={(v) => update("measure_with_return", v === "true")}
        />
      </div>
    </div>
  );
}

const protocolPickerStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "end",
  marginBottom: 12,
  flexWrap: "wrap",
};

const addStepPanelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "end",
  gap: 8,
  minWidth: 0,
  width: "min(100%, 340px)",
  marginTop: 12,
};

const toolbarFieldStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  flex: "1 1 220px",
  minWidth: 0,
};

const toolbarLabelStyle: React.CSSProperties = {
  color: "#4b5563",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0,
};

const methodOptionsStyle: React.CSSProperties = {
  border: "1px solid #dbeafe",
  background: "#eff6ff",
  borderRadius: 6,
  padding: 10,
  marginTop: 4,
};

const methodOptionsTitleStyle: React.CSSProperties = {
  color: "#1e40af",
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 8,
};

const methodOptionsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: 8,
};

const emptyProtocolStyle: React.CSSProperties = {
  border: "1px dashed #d1d5db",
  borderRadius: 6,
  color: "#6b7280",
  fontSize: 13,
  padding: "18px 12px",
  marginTop: 8,
  background: "#fafafa",
};

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
  height: 34,
  padding: "0 10px",
  borderRadius: 4,
  fontSize: 13,
  width: "100%",
};

const addBtnStyle: React.CSSProperties = {
  background: "#fff",
  color: "#2563eb",
  border: "1px solid #2563eb",
  height: 34,
  padding: "0 14px",
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
