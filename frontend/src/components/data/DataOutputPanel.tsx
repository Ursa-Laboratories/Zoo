import { useState } from "react";
import type { CSSProperties } from "react";
import { dataApi } from "../../api/client";
import type { CampaignSummary } from "../../types";

interface Props {
  campaigns: CampaignSummary[];
  isLoading: boolean;
  error: unknown;
  onRefresh: () => void;
}

type ExportKind = "measurements" | "asmi";

type ExportingState = {
  campaignId: number;
  kind: ExportKind;
};

export default function DataOutputPanel({
  campaigns,
  isLoading,
  error,
  onRefresh,
}: Props) {
  const [exporting, setExporting] = useState<ExportingState | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = async (campaign: CampaignSummary, kind: ExportKind) => {
    setExporting({ campaignId: campaign.campaign_id, kind });
    setExportError(null);
    try {
      const blob = kind === "measurements"
        ? await dataApi.exportCampaignMeasurementsZip(campaign.campaign_id)
        : await dataApi.exportCampaignAsmiZip(campaign.campaign_id);
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = kind === "measurements"
        ? `campaign_${campaign.campaign_id}_measurements.zip`
        : `campaign_${campaign.campaign_id}_asmi_raw_csvs.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(null);
    }
  };

  return (
    <section style={panelStyle} aria-label="Campaign results output">
      <div style={headerStyle}>
        <div>
          <h3 style={titleStyle}>Campaign Results</h3>
          <div style={subtitleStyle}>Stored instrument measurement output</div>
        </div>
        <button onClick={onRefresh} style={secondaryButtonStyle}>
          Refresh
        </button>
      </div>

      {Boolean(error) && (
        <div style={errorStyle}>Data load failed: {error instanceof Error ? error.message : String(error)}</div>
      )}
      {exportError && (
        <div style={errorStyle}>Export failed: {exportError}</div>
      )}
      {isLoading && <div style={emptyStyle}>Loading campaigns...</div>}
      {!isLoading && campaigns.length === 0 && (
        <div style={emptyStyle}>No campaigns yet — run a protocol to create one.</div>
      )}
      {!isLoading && campaigns.length > 0 && (
        <div style={tableFrameStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Campaign</th>
                <th style={thStyle}>Last measured</th>
                <th style={thStyle}>Experiments</th>
                <th style={thStyle}>Wells</th>
                <th style={thStyle}>Measurements</th>
                <th style={thStyle}>Export</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => {
                const measurementsDisabled = campaign.measurement_count === 0 || exporting !== null;
                const asmiDisabled = campaign.asmi_measurement_count === 0 || exporting !== null;
                const timestamp = campaign.latest_measurement_at ?? campaign.created_at;
                return (
                  <tr key={campaign.campaign_id}>
                    <td style={tdStyle}>
                      <div style={strongTextStyle}>Campaign #{campaign.campaign_id}</div>
                      <div style={metaTextStyle}>{campaign.campaign_description}</div>
                    </td>
                    <td style={tdStyle}>{formatTimestamp(timestamp)}</td>
                    <td style={tdStyle}>{campaign.experiment_count}</td>
                    <td style={tdStyle}>{campaign.well_count}</td>
                    <td style={tdStyle}>{campaign.measurement_count}</td>
                    <td style={tdStyle}>
                      <button
                        onClick={() => void handleExport(campaign, "measurements")}
                        disabled={measurementsDisabled}
                        style={{
                          ...primaryButtonStyle,
                          opacity: measurementsDisabled ? 0.55 : 1,
                          cursor: measurementsDisabled ? "default" : "pointer",
                        }}
                      >
                        {isExporting(exporting, campaign.campaign_id, "measurements") ? "Exporting..." : "Measurements ZIP"}
                      </button>
                      <button
                        onClick={() => void handleExport(campaign, "asmi")}
                        disabled={asmiDisabled}
                        style={{
                          ...secondaryExportButtonStyle,
                          opacity: asmiDisabled ? 0.55 : 1,
                          cursor: asmiDisabled ? "default" : "pointer",
                        }}
                      >
                        {isExporting(exporting, campaign.campaign_id, "asmi") ? "Exporting..." : "ASMI ZIP"}
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

function isExporting(exporting: ExportingState | null, campaignId: number, kind: ExportKind): boolean {
  return exporting?.campaignId === campaignId && exporting.kind === kind;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
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
  marginRight: 6,
};

const secondaryExportButtonStyle: CSSProperties = {
  background: "#fff",
  color: "#1f2937",
  border: "1px solid #d1d5db",
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
