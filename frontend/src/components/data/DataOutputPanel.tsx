import { useState } from "react";
import type { CSSProperties } from "react";
import { dataApi } from "../../api/client";
import type { ExperimentSummary } from "../../types";

interface Props {
  experiments: ExperimentSummary[];
  isLoading: boolean;
  error: unknown;
  onRefresh: () => void;
}

export default function DataOutputPanel({
  experiments,
  isLoading,
  error,
  onRefresh,
}: Props) {
  const [exportingId, setExportingId] = useState<number | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = async (experiment: ExperimentSummary) => {
    setExportingId(experiment.experiment_id);
    setExportError(null);
    try {
      const blob = await dataApi.exportAsmiCsv(experiment.experiment_id);
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `experiment_${experiment.experiment_id}_asmi.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingId(null);
    }
  };

  return (
    <section style={panelStyle} aria-label="Experiment data output">
      <div style={headerStyle}>
        <div>
          <h3 style={titleStyle}>Experiment Data</h3>
          <div style={subtitleStyle}>Stored experiment output</div>
        </div>
        <button onClick={onRefresh} style={secondaryButtonStyle}>
          Refresh
        </button>
      </div>

      {Boolean(error) && (
        <div style={errorStyle}>Data load failed: {error instanceof Error ? error.message : String(error)}</div>
      )}
      {exportError && (
        <div style={errorStyle}>CSV export failed: {exportError}</div>
      )}
      {isLoading && <div style={emptyStyle}>Loading experiments...</div>}
      {!isLoading && experiments.length === 0 && (
        <div style={emptyStyle}>No experiments found.</div>
      )}
      {!isLoading && experiments.length > 0 && (
        <div style={tableFrameStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Experiment</th>
                <th style={thStyle}>Run time</th>
                <th style={thStyle}>Well</th>
                <th style={thStyle}>Export</th>
              </tr>
            </thead>
            <tbody>
              {experiments.map((experiment) => {
                const exportDisabled = experiment.asmi_measurement_count === 0 || exportingId !== null;
                return (
                  <tr key={experiment.experiment_id}>
                    <td style={tdStyle}>
                      <div style={strongTextStyle}>Experiment #{experiment.experiment_id}</div>
                      <div style={metaTextStyle}>{experiment.campaign_description}</div>
                    </td>
                    <td style={tdStyle}>{experiment.latest_measurement_at ?? experiment.created_at}</td>
                    <td style={tdStyle}>{experiment.well_id ?? "-"}</td>
                    <td style={tdStyle}>
                      <button
                        onClick={() => void handleExport(experiment)}
                        disabled={exportDisabled}
                        style={{
                          ...primaryButtonStyle,
                          opacity: exportDisabled ? 0.55 : 1,
                          cursor: exportDisabled ? "default" : "pointer",
                        }}
                      >
                        {exportingId === experiment.experiment_id ? "Exporting..." : "Export CSV"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const panelStyle: CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 6,
  background: "#fff",
  overflow: "hidden",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 14px",
  borderBottom: "1px solid #eee",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 15,
};

const subtitleStyle: CSSProperties = {
  marginTop: 2,
  color: "#777",
  fontSize: 12,
};

const tableFrameStyle: CSSProperties = {
  overflowX: "auto",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const thStyle: CSSProperties = {
  padding: "9px 12px",
  textAlign: "left",
  color: "#666",
  borderBottom: "1px solid #eee",
  fontWeight: 600,
};

const tdStyle: CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #f1f1f1",
  verticalAlign: "middle",
};

const strongTextStyle: CSSProperties = {
  fontWeight: 600,
};

const metaTextStyle: CSSProperties = {
  marginTop: 2,
  color: "#777",
  fontSize: 12,
};

const emptyStyle: CSSProperties = {
  padding: 16,
  color: "#777",
  fontSize: 13,
};

const errorStyle: CSSProperties = {
  margin: 12,
  padding: "8px 10px",
  borderRadius: 4,
  background: "#fef2f2",
  border: "1px solid #fca5a5",
  color: "#991b1b",
  fontSize: 12,
};

const primaryButtonStyle: CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "1px solid #1d4ed8",
  borderRadius: 4,
  padding: "5px 10px",
  fontSize: 12,
};

const secondaryButtonStyle: CSSProperties = {
  background: "#f5f5f5",
  color: "#1a1a1a",
  border: "1px solid #ccc",
  borderRadius: 4,
  padding: "5px 10px",
  fontSize: 12,
  cursor: "pointer",
};
