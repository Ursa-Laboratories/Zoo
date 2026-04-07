import React, { useRef, useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import AppLayout from "./components/layout/AppLayout";
import DeckVisualization from "./components/deck/DeckVisualization";
import GantryPositionWidget from "./components/gantry/GantryPositionWidget";
import EditorTabs from "./components/editor/EditorTabs";
import DeckEditor from "./components/editor/DeckEditor";
import BoardEditor from "./components/editor/BoardEditor";
import GantryEditor from "./components/editor/GantryEditor";
import ProtocolEditor from "./components/editor/ProtocolEditor";
import { settingsApi, deckApi, protocolApi } from "./api/client";
import { useDeckConfigs, useDeck, useSaveDeck } from "./hooks/useDeck";
import { useBoardConfigs, useBoard, useSaveBoard, useInstrumentTypes, useInstrumentSchemas } from "./hooks/useBoard";
import { useGantryPosition, useGantryConfigs, useGantry, useSaveGantry } from "./hooks/useGantryPosition";
import { useProtocolCommands, useProtocolConfigs, useProtocol, useSaveProtocol, useValidateProtocol } from "./hooks/useProtocol";
import type { DeckResponse, GantryConfig, WellPosition, ProtocolValidationResponse, WorkingVolume } from "./types";

export default function App() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("Gantry");
  const [experimentsDir, setExperimentsDir] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [browseLoading, setBrowseLoading] = useState(false);

  const [deckFile, setDeckFile] = useState<string | null>(null);
  const [boardFile, setBoardFile] = useState<string | null>(null);
  const [gantryFile, setGantryFile] = useState<string | null>(null);
  const [deckReady, setDeckReady] = useState(false);
  const [boardReady, setBoardReady] = useState(false);
  const [gantryReady, setGantryReady] = useState(false);
  const [liveGantryConfig, setLiveGantryConfig] = useState<GantryConfig | null>(null);
  const [protocolFile, setProtocolFile] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<ProtocolValidationResponse | null>(null);
  const [runResult, setRunResult] = useState<{ status: string; steps_executed: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isDryRunning, setIsDryRunning] = useState(false);

  // Load current settings on mount
  React.useEffect(() => {
    settingsApi.get().then((s) => {
      setExperimentsDir(s.experiments_dir);
      if (s.campaign_id) setCampaignId(s.campaign_id);
    }).catch(() => {});
  }, []);

  // Sync settings to backend with debounce to avoid creating intermediate directories
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => {
    if (experimentsDir) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        settingsApi.update(experimentsDir, campaignId.trim()).then(() => refreshAll()).catch(() => {});
      }, 600);
    }
    return () => clearTimeout(syncTimerRef.current);
  }, [experimentsDir, campaignId]);

  const handleBrowse = async () => {
    setBrowseLoading(true);
    try {
      const result = await settingsApi.browse();
      setExperimentsDir(result.experiments_dir);
    } catch {
      // User cancelled the dialog
    }
    setBrowseLoading(false);
  };

  const deckConfigs = useDeckConfigs();
  const deckQuery = useDeck(deckFile);
  const saveDeck = useSaveDeck(deckFile ?? "");

  const boardConfigs = useBoardConfigs();
  const boardQuery = useBoard(boardFile);
  const saveBoard = useSaveBoard(boardFile ?? "");
  const instrumentTypes = useInstrumentTypes();
  const instrumentSchemas = useInstrumentSchemas();

  const gantryConfigs = useGantryConfigs();
  const gantryQuery = useGantry(gantryFile);
  const saveGantry = useSaveGantry(gantryFile ?? "");
  const gantryPosition = useGantryPosition(true);

  const protocolCommands = useProtocolCommands();
  const protocolConfigs = useProtocolConfigs();
  const protocolQuery = useProtocol(protocolFile);
  const saveProtocol = useSaveProtocol(protocolFile ?? "");
  const validateProtocol = useValidateProtocol();

  const [localDeck, setLocalDeck] = useState<DeckResponse | null>(null);
  const [previewWells, setPreviewWells] = useState<Record<string, Record<string, WellPosition>>>({});
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Compute well positions via CubOS when user edits a deck locally.
  React.useEffect(() => {
    if (!localDeck) {
      setPreviewWells({});
      return;
    }
    clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(async () => {
      const result: Record<string, Record<string, WellPosition>> = {};
      for (const item of localDeck.labware) {
        if (item.config.type === "well_plate") {
          try {
            result[item.key] = await deckApi.previewWells(item.config);
          } catch {
            // Config may be incomplete during editing — skip.
          }
        }
      }
      setPreviewWells(result);
    }, 300);
    return () => clearTimeout(previewTimerRef.current);
  }, [localDeck]);

  const displayDeck = useMemo(() => {
    const base = localDeck ?? deckQuery.data ?? null;
    if (!base) return null;
    // Merge server-computed or preview wells into each labware item.
    return {
      ...base,
      labware: base.labware.map((item) => ({
        ...item,
        wells: item.wells ?? previewWells[item.key] ?? null,
      })),
    };
  }, [localDeck, deckQuery.data, previewWells]);

  const workingVolume: WorkingVolume | null = liveGantryConfig?.working_volume ?? gantryQuery.data?.config.working_volume ?? null;
  const yAxisMotion = liveGantryConfig?.cnc?.y_axis_motion ?? gantryQuery.data?.config.cnc?.y_axis_motion ?? "head";
  const machineXRange: [number, number] = workingVolume
    ? [workingVolume.x_min, workingVolume.x_max]
    : [0, 300];
  const machineYRange: [number, number] = workingVolume
    ? [workingVolume.y_min, workingVolume.y_max]
    : [0, 200];

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["deck"] });
    qc.invalidateQueries({ queryKey: ["board"] });
    qc.invalidateQueries({ queryKey: ["gantry"] });
    qc.invalidateQueries({ queryKey: ["protocol"] });
    setLocalDeck(null);
  };

  const handleRunProtocol = async (dryRun = false) => {
    if (!gantryFile || !deckFile || !boardFile || !protocolFile) return;
    if (dryRun) setIsDryRunning(true); else setIsRunning(true);
    setRunResult(null);
    setRunError(null);
    try {
      await protocolApi.run({
        gantry_file: gantryFile,
        deck_file: deckFile,
        board_file: boardFile,
        protocol_file: protocolFile,
        dry_run: dryRun,
      });
      // Poll for completion
      const poll = async () => {
        for (;;) {
          await new Promise((r) => setTimeout(r, 500));
          const s = await protocolApi.runStatus();
          if (s.status === "done") {
            setRunResult({ status: "ok", steps_executed: s.steps_executed ?? 0 });
            break;
          }
          if (s.status === "error") {
            setRunError(s.error ?? "Unknown error");
            break;
          }
        }
      };
      await poll();
    } catch (err: unknown) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      if (dryRun) setIsDryRunning(false); else setIsRunning(false);
    }
  };

  const left = (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Zoo</h2>
        <p style={{ margin: "2px 0 0", fontSize: 12, color: "#888" }}>An online pen for managing Pandas</p>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
          <span style={{ color: "#666" }}>Experiments Directory</span>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="text"
              value={experimentsDir ?? ""}
              readOnly
              placeholder="Not set"
              style={{ ...campaignInputStyle, flex: 1, color: experimentsDir ? "#1a1a1a" : "#aaa" }}
            />
            <button onClick={handleBrowse} disabled={browseLoading} style={browseBtnStyle}>
              {browseLoading ? "..." : "Browse"}
            </button>
          </div>
        </label>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
          <span style={{ color: "#666" }}>Campaign ID</span>
          <input
            type="text"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            placeholder="e.g. mofcat_001"
            style={campaignInputStyle}
          />
        </label>
        {experimentsDir && campaignId.trim() && (
          <div style={{ fontSize: 10, color: "#999", marginTop: 4 }}>
            Configs: {experimentsDir}/{campaignId.trim()}/
          </div>
        )}
      </div>
      <EditorTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
          disabledTabs={!deckReady || !boardReady || !gantryReady ? ["Protocol"] : []}
          disabledMessage={(() => {
            const missing = [
              !gantryReady && "Gantry",
              !deckReady && "Deck",
              !boardReady && "Board",
            ].filter(Boolean);
            if (missing.length === 0) return null;
            return `Complete ${missing.join(", ")} first.`;
          })()}
        />
      <div style={{ display: activeTab === "Deck" ? undefined : "none" }}>
        <DeckEditor
          configs={deckConfigs.data ?? []}
          selectedFile={deckFile}
          onSelectFile={setDeckFile}
          deck={deckQuery.data ?? null}
          onSave={(body) => saveDeck.mutate(body)}
          onLocalChange={setLocalDeck}
          onRefresh={refreshAll}
          onHasContent={setDeckReady}
        />
      </div>
      <div style={{ display: activeTab === "Board" ? undefined : "none" }}>
        <BoardEditor
          configs={boardConfigs.data ?? []}
          selectedFile={boardFile}
          onSelectFile={setBoardFile}
          board={boardQuery.data ?? null}
          instrumentTypes={instrumentTypes.data ?? []}
          instrumentSchemas={instrumentSchemas.data ?? {}}
          onSave={(body) => saveBoard.mutate(body)}
          onRefresh={refreshAll}
          onHasContent={setBoardReady}
        />
      </div>
      <div style={{ display: activeTab === "Gantry" ? undefined : "none" }}>
        <GantryEditor
          configs={gantryConfigs.data ?? []}
          selectedFile={gantryFile}
          onSelectFile={setGantryFile}
          gantry={gantryQuery.data ?? null}
          onSave={(body) => saveGantry.mutate(body)}
          onRefresh={refreshAll}
          onHasContent={setGantryReady}
          onConfigChange={setLiveGantryConfig}
        />
      </div>
      <div style={{ display: activeTab === "Protocol" ? undefined : "none" }}>
        <ProtocolEditor
          configs={protocolConfigs.data ?? []}
          selectedFile={protocolFile}
          onSelectFile={setProtocolFile}
          commands={protocolCommands.data ?? []}
          steps={protocolQuery.data?.steps ?? null}
          onSave={(body) => saveProtocol.mutate(body)}
          onValidate={(body) =>
            validateProtocol.mutate(body, {
              onSuccess: (res) => setValidationResult(res),
            })
          }
          validationErrors={validationResult?.errors ?? null}
          isValidating={validateProtocol.isPending}
          onRefresh={refreshAll}
          onRun={() => handleRunProtocol(false)}
          onDryRun={() => handleRunProtocol(true)}
          isRunning={isRunning}
          isDryRunning={isDryRunning}
          runResult={runResult}
          runError={runError}
        />
      </div>
    </div>
  );

  const topRight = (
    <div>
      <h3 style={{ margin: "0 0 8px", fontSize: 14, color: "#666" }}>Deck Visualization</h3>
      <DeckVisualization
        deck={displayDeck}
        board={boardQuery.data ?? null}
        gantryPosition={gantryPosition.data ?? null}
        machineXRange={machineXRange}
        machineYRange={machineYRange}
        yAxisMotion={yAxisMotion}
      />
    </div>
  );

  const bottomRight = (
    <GantryPositionWidget
      position={gantryPosition.data ?? null}
      workingVolume={workingVolume}
      gantryConfig={liveGantryConfig}
    />
  );

  return <AppLayout left={left} topRight={topRight} bottomRight={bottomRight} />;
}

const campaignInputStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #ccc",
  color: "#1a1a1a",
  padding: "4px 8px",
  borderRadius: 4,
  fontSize: 13,
};

const browseBtnStyle: React.CSSProperties = {
  background: "#f5f5f5",
  color: "#1a1a1a",
  border: "1px solid #ccc",
  padding: "4px 10px",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  whiteSpace: "nowrap",
};
