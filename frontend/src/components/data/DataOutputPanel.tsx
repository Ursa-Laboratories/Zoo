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

export default function DataOutputPanel({
  campaigns,
  isLoading,
  error,
  onRefresh,
}: Props) {
  const [exportingId, setExportingId] = useState<number | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = async (campaign: CampaignSummary) => {
    setExportingId(campaign.campaign_id);
    setExportError(null);
    try {
      const blob = await dataApi.exportCampaignAsmiZip(campaign.campaign_id);
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `campaign_${campaign.campaign_id}_asmi_raw_csvs.zip`;
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
    <section style={panelStyle} aria-label="Campaign results output">
      <div style={headerStyle}>
        <div>
          <h3 style={titleStyle}>Campaign Results</h3>
          <div style={subtitleStyle}>Stored ASMI campaign output</div>
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
        <div style={emptyStyle}>No campaigns found.</div>
      )}
      {!isLoading && campaigns.length > 0 && (
        <div style={tableFrameStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Campaign</th>
                <th style={thStyle}>Run time</th>
                <th style={thStyle}>Experiments</th>
                <th style={thStyle}>Wells</th>
                <th style={thStyle}>Export</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => {
                const exportDisabled = campaign.asmi_measurement_count === 0 || exportingId !== null;
                return (
                  <tr key={campaign.campaign_id}>
                    <td style={tdStyle}>
                      <div style={strongTextStyle}>Campaign #{campaign.campaign_id}</div>
                      <div style={metaTextStyle}>{campaign.campaign_description}</div>
                    </td>
                    <td style={tdStyle}>{campaign.latest_measurement_at ?? campaign.created_at}</td>
                    <td style={tdStyle}>{campaign.experiment_count}</td>
                    <td style={tdStyle}>{campaign.well_count}</td>
                    <td style={tdStyle}>
                      <button
                        onClick={() => void handleExport(campaign)}
                        disabled={exportDisabled}
                        style={{
                          ...primaryButtonStyle,
                          opacity: exportDisabled ? 0.55 : 1,
                          cursor: exportDisabled ? "default" : "pointer",
                        }}
                      >
                        {exportingId === campaign.campaign_id ? "Exporting..." : "Export ZIP"}
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
