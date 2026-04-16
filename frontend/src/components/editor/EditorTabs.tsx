interface Props {
  activeTab: string;
  onTabChange: (tab: string) => void;
  disabledTabs?: string[];
  disabledMessage?: string | null;
  /**
   * Filename to show underneath each tab label once a config has been
   * loaded (or saved) on that tab. Keyed by the tab name; a missing or
   * empty value leaves the tab with only its section label.
   */
  loadedFilenames?: Partial<Record<string, string | null | undefined>>;
}

const TABS = ["Gantry", "Deck", "Board", "Protocol"];

export default function EditorTabs({
  activeTab,
  onTabChange,
  disabledTabs = [],
  disabledMessage,
  loadedFilenames,
}: Props) {
  return (
    <div>
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #ddd", marginBottom: disabledMessage && activeTab === "Protocol" ? 0 : 16 }}>
        {TABS.map((tab) => {
          const disabled = disabledTabs.includes(tab);
          const filename = loadedFilenames?.[tab] || null;
          return (
            <button
              key={tab}
              onClick={() => {
                if (disabled && disabledMessage) {
                  onTabChange(tab);
                } else if (!disabled) {
                  onTabChange(tab);
                }
              }}
              style={{
                background: activeTab === tab ? "#f5f5f5" : "transparent",
                color: disabled ? "#ccc" : activeTab === tab ? "#1a1a1a" : "#888",
                border: "none",
                borderBottom: activeTab === tab ? "2px solid #2563eb" : "2px solid transparent",
                padding: "8px 20px",
                cursor: disabled ? "default" : "pointer",
                fontSize: 14,
                fontWeight: activeTab === tab ? 600 : 400,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                lineHeight: 1.2,
                minWidth: 120,
              }}
              title={filename ?? undefined}
            >
              <span>{tab}</span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 400,
                  color: disabled ? "#ccc" : "#888",
                  marginTop: 2,
                  maxWidth: 180,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  // Reserve the line height so tabs stay the same size
                  // regardless of whether a config has been loaded.
                  minHeight: 13,
                }}
              >
                {filename ?? "\u00A0"}
              </span>
            </button>
          );
        })}
      </div>
      {disabledMessage && disabledTabs.includes(activeTab) && (
        <div style={{ padding: "12px 16px", marginBottom: 16, fontSize: 12, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderTop: "none", borderRadius: "0 0 4px 4px" }}>
          {disabledMessage}
        </div>
      )}
    </div>
  );
}
