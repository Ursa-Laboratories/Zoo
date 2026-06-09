const TABS = ["Gantry", "Deck", "Protocol"] as const;
type TabName = (typeof TABS)[number];

interface Props {
  activeTab: string;
  onTabChange: (tab: string) => void;
  /** Tabs whose editor has unsaved local edits. Renders an amber dot
   * next to the label so the user knows that tab changed but isn't
   * persisted yet. */
  dirtyTabs?: string[];
  disabledTabs?: string[];
  disabledMessage?: string | null;
  /**
   * Filename to show underneath each tab label once a config has been
   * successfully loaded (or saved) on that tab. A missing or empty
   * value leaves the tab with only its section label. The tab bar
   * reserves vertical space for the second line either way so the bar
   * does not jump when a filename appears.
   */
  loadedFilenames?: Partial<Record<TabName, string | null>>;
}

export default function EditorTabs({
  activeTab,
  onTabChange,
  dirtyTabs = [],
  disabledTabs = [],
  disabledMessage,
  loadedFilenames,
}: Props) {
  return (
    <div>
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #ddd", marginBottom: disabledMessage && activeTab === "Protocol" ? 0 : 16 }}>
        {TABS.map((tab) => {
          const disabled = disabledTabs.includes(tab);
          const dirty = dirtyTabs.includes(tab);
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
            >
              <span>
                {tab}
                {dirty && (
                  // aria-hidden so the button's accessible name stays the
                  // bare section label ("Deck", ...) — the dot is a
                  // sighted-only unsaved-changes cue.
                  <span
                    aria-hidden="true"
                    title="Unsaved changes"
                    style={{ color: "#d97706", marginLeft: 6, fontSize: 11, fontWeight: 700 }}
                  >
                    ●
                  </span>
                )}
              </span>
              <span
                // Hide the filename line from the accessibility tree so
                // the button's accessible name stays exactly the section
                // label ("Gantry", "Deck", ...). Screen readers still get
                // a clean tab name; sighted users still see the filename.
                aria-hidden="true"
                style={{
                  fontSize: 11,
                  fontWeight: 400,
                  color: disabled ? "#ccc" : "#888",
                  marginTop: 2,
                  maxWidth: 180,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
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
