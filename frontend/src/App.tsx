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
import type { DeckResponse, WellPosition, ProtocolValidationResponse, WorkingVolume } from "./types";

export default function App() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("Gantry");
  const [campaignId, setCampaignId] = useState("");
  const [pandaCorePath, setPandaCorePath] = useState<string | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);

  const [deckFile, setDeckFile] = useState<string | null>(null);
  const [boardFile, setBoardFile] = useState<string | null>(null);
  const [gantryFile, setGantryFile] = useState<string | null>(null);
  const [protocolFile, setProtocolFile] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<ProtocolValidationResponse | null>(null);
  const [runResult, setRunResult] = useState<{ status: string; steps_executed: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // Load current PANDA_CORE path on mount
  React.useEffect(() => {
    settingsApi.get().then((s) => setPandaCorePath(s.panda_core_path)).catch(() => {});
  }, []);

  const handleBrowse = async () => {
    setBrowseLoading(true);
    try {
      const result = await settingsApi.browse();
      setPandaCorePath(result.panda_core_path);
      await settingsApi.update(result.panda_core_path);
      refreshAll();
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
  const gantryPosition = useGantryPosition(!isRunning);

  const protocolCommands = useProtocolCommands();
  const protocolConfigs = useProtocolConfigs();
  const protocolQuery = useProtocol(protocolFile);
  const saveProtocol = useSaveProtocol(protocolFile ?? "");
  const validateProtocol = useValidateProtocol();

  const [localDeck, setLocalDeck] = useState<DeckResponse | null>(null);
  const [previewWells, setPreviewWells] = useState<Record<string, Record<string, WellPosition>>>({});
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Compute well positions via PANDA_CORE when user edits a deck locally.
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

  const workingVolume: WorkingVolume | null = gantryQuery.data?.config.working_volume ?? null;
  const yAxisMotion = gantryQuery.data?.config.cnc?.y_axis_motion ?? "head";
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

  const handleRunProtocol = async () => {
    if (!gantryFile || !deckFile || !boardFile || !protocolFile) return;
    setIsRunning(true);
    setRunResult(null);
    setRunError(null);
    try {
      const result = await protocolApi.run({
        gantry_file: gantryFile,
        deck_file: deckFile,
        board_file: boardFile,
        protocol_file: protocolFile,
      });
      setRunResult(result);
    } catch (err: unknown) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
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
          <span style={{ color: "#666" }}>Campaign ID</span>
          <input
            type="text"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            placeholder="e.g. mofcat_001"
            style={campaignInputStyle}
          />
        </label>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
          <span style={{ color: "#666" }}>PANDA_CORE Path</span>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="text"
              value={pandaCorePath ?? ""}
              readOnly
              placeholder="Not set"
              style={{ ...campaignInputStyle, flex: 1, color: pandaCorePath ? "#1a1a1a" : "#aaa" }}
            />
            <button onClick={handleBrowse} disabled={browseLoading} style={browseBtnStyle}>
              {browseLoading ? "..." : "Browse"}
            </button>
          </div>
        </label>
      </div>
      <EditorTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
          disabledTabs={!deckQuery.data || !boardQuery.data || !gantryQuery.data ? ["Protocol"] : []}
          disabledMessage={(() => {
            const missing = [
              !gantryQuery.data && "Gantry",
              !deckQuery.data && "Deck",
              !boardQuery.data && "Board",
            ].filter(Boolean);
            if (missing.length === 0) return null;
            return `Please load ${missing.join(", ")} config${missing.length > 1 ? "s" : ""} first.`;
          })()}
        />
      {activeTab === "Deck" && (
        <DeckEditor
          configs={deckConfigs.data ?? []}
          selectedFile={deckFile}
          onSelectFile={setDeckFile}
          deck={deckQuery.data ?? null}
          onSave={(body) => saveDeck.mutate(body)}
          onLocalChange={setLocalDeck}
          onRefresh={refreshAll}
        />
      )}
      {activeTab === "Board" && (
        <BoardEditor
          configs={boardConfigs.data ?? []}
          selectedFile={boardFile}
          onSelectFile={setBoardFile}
          board={boardQuery.data ?? null}
          instrumentTypes={instrumentTypes.data ?? []}
          instrumentSchemas={instrumentSchemas.data ?? {}}
          onSave={(body) => saveBoard.mutate(body)}
          onRefresh={refreshAll}
        />
      )}
      {activeTab === "Gantry" && (
        <GantryEditor
          configs={gantryConfigs.data ?? []}
          selectedFile={gantryFile}
          onSelectFile={setGantryFile}
          gantry={gantryQuery.data ?? null}
          onSave={(body) => saveGantry.mutate(body)}
          onRefresh={refreshAll}
        />
      )}
      {activeTab === "Protocol" && deckQuery.data && boardQuery.data && gantryQuery.data && (
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
          onRun={handleRunProtocol}
          isRunning={isRunning}
          runResult={runResult}
          runError={runError}
        />
      )}
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
      configSelected={!!gantryFile}
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
