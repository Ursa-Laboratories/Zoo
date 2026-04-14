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
import type { SettingsResponse } from "./api/client";

function configDirFromSettings(settings: SettingsResponse): string {
  return settings.config_dir ?? "";
}

const WORKING_DECK_FILENAME = "panda-deck.yaml";

export default function App() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("Gantry");
  const [campaignId, setCampaignId] = useState("");
  const [configDir, setConfigDir] = useState<string | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);

  const [deckFile, setDeckFile] = useState<string | null>(null);
  const [boardFile, setBoardFile] = useState<string | null>(null);
  const [gantryFile, setGantryFile] = useState<string | null>(null);
  const [protocolFile, setProtocolFile] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<ProtocolValidationResponse | null>(null);
  const [runResult, setRunResult] = useState<{ status: string; steps_executed: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Load the local config directory on mount.
  React.useEffect(() => {
    settingsApi.get()
      .then((s) => setConfigDir(configDirFromSettings(s)))
      .catch((err) => console.error("Failed to load settings:", err));
  }, []);

  const handleBrowse = async () => {
    setBrowseLoading(true);
    try {
      const browseResult = await settingsApi.browse();
      const selectedPath = configDirFromSettings(browseResult);
      const savedSettings = await settingsApi.update(selectedPath);
      setConfigDir(configDirFromSettings(savedSettings));
      refreshAll();
    } catch (err) {
      // Distinguish cancellation (no selected path) from a real API failure.
      if (err instanceof Error && err.message !== "cancelled") {
        console.error("Browse/settings update failed:", err);
      }
    } finally {
      setBrowseLoading(false);
    }
  };

  const deckConfigs = useDeckConfigs();
  const deckQuery = useDeck(deckFile);
  const saveDeck = useSaveDeck();

  const boardConfigs = useBoardConfigs();
  const boardQuery = useBoard(boardFile);
  const saveBoard = useSaveBoard();
  const instrumentTypes = useInstrumentTypes();
  const instrumentSchemas = useInstrumentSchemas();

  const gantryConfigs = useGantryConfigs();
  const gantryQuery = useGantry(gantryFile);
  const saveGantry = useSaveGantry();
  const gantryPosition = useGantryPosition(!isRunning);

  const protocolCommands = useProtocolCommands();
  const protocolConfigs = useProtocolConfigs();
  const protocolQuery = useProtocol(protocolFile);
  const saveProtocol = useSaveProtocol();
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
          } catch (err) {
            // 400 = config still incomplete during editing — expected, skip silently.
            const is400 = err instanceof Error && err.message.includes("400");
            if (!is400) {
              console.error("Unexpected well preview error for", item.key, err);
            }
          }
        }
      }
      setPreviewWells(result);
    }, 300);
    return () => clearTimeout(previewTimerRef.current);
  }, [localDeck]);

  React.useEffect(() => {
    setLocalDeck(null);
  }, [deckFile]);

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

  const handleImportDeck = async (filename: string) => {
    setImportError(null);
    try {
      const importedDeck = await deckApi.get(filename);
      const labware = Object.fromEntries(
        importedDeck.labware.map((item) => [item.key, structuredClone(item.config)]),
      );
      await saveDeck.mutateAsync({
        filename: WORKING_DECK_FILENAME,
        body: { labware },
      });
      setDeckFile(WORKING_DECK_FILENAME);
      setLocalDeck(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
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
          <span style={{ color: "#666" }}>Config Directory</span>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="text"
              value={configDir ?? ""}
              readOnly
              placeholder="Not set"
              style={{ ...campaignInputStyle, flex: 1, color: configDir ? "#1a1a1a" : "#aaa" }}
            />
            <button onClick={handleBrowse} disabled={browseLoading} style={browseButtonStyle}>
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
        <>
          {importError && (
            <div style={importErrorStyle}>Import failed: {importError}</div>
          )}
          <DeckEditor
            key={deckQuery.data ? `loaded:${deckQuery.data.filename}` : `selected:${deckFile ?? "none"}`}
            configs={deckConfigs.data ?? []}
            selectedFile={deckFile}
            onSelectFile={setDeckFile}
            onImportFile={handleImportDeck}
            deck={deckQuery.data ?? null}
            onSave={(filename, body) => saveDeck.mutate({ filename, body })}
            onLocalChange={setLocalDeck}
            onRefresh={refreshAll}
          />
        </>
      )}
      {activeTab === "Board" && (
        <BoardEditor
          key={boardQuery.data ? `loaded:${boardQuery.data.filename}` : `selected:${boardFile ?? "none"}`}
          configs={boardConfigs.data ?? []}
          selectedFile={boardFile}
          onSelectFile={setBoardFile}
          board={boardQuery.data ?? null}
          instrumentTypes={instrumentTypes.data ?? []}
          instrumentSchemas={instrumentSchemas.data ?? {}}
          onSave={(filename, body) => saveBoard.mutate({ filename, body })}
          onRefresh={refreshAll}
        />
      )}
      {activeTab === "Gantry" && (
        <GantryEditor
          key={gantryQuery.data ? `loaded:${gantryQuery.data.filename}` : `selected:${gantryFile ?? "none"}`}
          configs={gantryConfigs.data ?? []}
          selectedFile={gantryFile}
          onSelectFile={setGantryFile}
          gantry={gantryQuery.data ?? null}
          onSave={(filename, body) => saveGantry.mutate({ filename, body })}
          onRefresh={refreshAll}
        />
      )}
      {activeTab === "Protocol" && deckQuery.data && boardQuery.data && gantryQuery.data && (
        <ProtocolEditor
          key={protocolQuery.data ? `loaded:${protocolQuery.data.filename}` : `selected:${protocolFile ?? "none"}`}
          configs={protocolConfigs.data ?? []}
          selectedFile={protocolFile}
          onSelectFile={setProtocolFile}
          commands={protocolCommands.data ?? []}
          steps={protocolQuery.data?.steps ?? null}
          onSave={(filename, body) => saveProtocol.mutate({ filename, body })}
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

const importErrorStyle: React.CSSProperties = {
  marginBottom: 8,
  padding: "6px 10px",
  borderRadius: 4,
  background: "#fef2f2",
  border: "1px solid #fca5a5",
  color: "#991b1b",
  fontSize: 12,
};

const browseButtonStyle: React.CSSProperties = {
  background: "#f5f5f5",
  color: "#1a1a1a",
  border: "1px solid #ccc",
  padding: "4px 10px",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  whiteSpace: "nowrap",
};
