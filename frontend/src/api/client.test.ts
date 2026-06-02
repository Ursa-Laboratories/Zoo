import { afterEach, describe, expect, it, vi } from "vitest";
import { deckApi, gantryApi, protocolApi, rawApi, settingsApi } from "./client";

function jsonResponse(body: unknown = { status: "ok" }): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("gantryApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the hard limit mode when configuring soft limits", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
    fetchMock.mockResolvedValue(jsonResponse());
    vi.stubGlobal("fetch", fetchMock);

    await gantryApi.configureSoftLimits({
      max_travel_x: 300,
      max_travel_y: 200,
      max_travel_z: 80,
      status_report: 0,
      homing_pull_off: 10,
      hard_limits: true,
      tolerance_mm: 0.1,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/gantry/soft-limits",
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      max_travel_x: 300,
      max_travel_y: 200,
      max_travel_z: 80,
      status_report: 0,
      homing_pull_off: 10,
      hard_limits: true,
      tolerance_mm: 0.1,
    });
  });

  it("maps gantry endpoints to the thin backend API contract", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
    fetchMock.mockImplementation(async () => jsonResponse());
    vi.stubGlobal("fetch", fetchMock);

    await gantryApi.listConfigs();
    await gantryApi.listInstrumentTypes();
    await gantryApi.listPipetteModels();
    await gantryApi.getInstrumentSchemas();
    await gantryApi.get("cubos.yaml");
    await gantryApi.put("cubos.yaml", {
      serial_port: "",
      gantry_type: "cub_xl",
      cnc: {
        homing_strategy: "standard",
        factory_z_travel_mm: 80,
        calibration_block_height_mm: 35,
        y_axis_motion: "head",
      },
      working_volume: { x_min: 0, x_max: 300, y_min: 0, y_max: 200, z_min: 0, z_max: 80 },
      instruments: {},
    });
    await gantryApi.getPosition();
    await gantryApi.connect("cubos.yaml");
    await gantryApi.disconnect();
    await gantryApi.jog(1, 2, 3);
    await gantryApi.home();
    await gantryApi.moveTo(4, 5, 6);
    await gantryApi.moveToBlocking(7, 8, 9);
    await gantryApi.jogBlocking(1, 0, 0, 12);
    await gantryApi.setWorkCoordinates({ x: 1, z: 3 });
    await gantryApi.prepareCalibrationOrigin();
    await gantryApi.homeAndCenterForCalibration();
    await gantryApi.restoreCalibrationSoftLimits();
    await gantryApi.finalizeCalibrationOrigin({
      home_z: 80,
      block_touch_z: 35,
      block_height: 10,
      factory_z_travel: 90,
      tolerance_mm: 0.2,
    });
    await gantryApi.recoverCalibrationLimit({ x: 0, y: 0, z: 1, pull_off_mm: 2, feed_rate: 3 });
    await gantryApi.unlock();
    await gantryApi.resetUnlock();
    await gantryApi.feedHold();
    await gantryApi.jogCancel();
    await gantryApi.readGrblSettings();
    await gantryApi.setGrblSetting({ setting: "$20", value: "1" });

    const calls = fetchMock.mock.calls.map(([input, init]) => ({
      path: new URL(String(input), "http://localhost").pathname,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }));

    expect(calls).toEqual([
      { path: "/api/gantry/configs", method: "GET", body: undefined },
      { path: "/api/gantry/instrument-types", method: "GET", body: undefined },
      { path: "/api/gantry/pipette-models", method: "GET", body: undefined },
      { path: "/api/gantry/instrument-schemas", method: "GET", body: undefined },
      { path: "/api/gantry/cubos.yaml", method: "GET", body: undefined },
      {
        path: "/api/gantry/cubos.yaml",
        method: "PUT",
        body: expect.objectContaining({ gantry_type: "cub_xl" }),
      },
      { path: "/api/gantry/position", method: "GET", body: undefined },
      { path: "/api/gantry/connect", method: "POST", body: { filename: "cubos.yaml" } },
      { path: "/api/gantry/disconnect", method: "POST", body: undefined },
      { path: "/api/gantry/jog", method: "POST", body: { x: 1, y: 2, z: 3 } },
      { path: "/api/gantry/home", method: "POST", body: undefined },
      { path: "/api/gantry/move-to", method: "POST", body: { x: 4, y: 5, z: 6 } },
      { path: "/api/gantry/move-to-blocking", method: "POST", body: { x: 7, y: 8, z: 9 } },
      { path: "/api/gantry/jog-blocking", method: "POST", body: { x: 1, y: 0, z: 0, timeout_s: 12 } },
      { path: "/api/gantry/work-coordinates", method: "POST", body: { x: 1, z: 3 } },
      { path: "/api/gantry/calibration/prepare-origin", method: "POST", body: undefined },
      { path: "/api/gantry/calibration/home-and-center", method: "POST", body: undefined },
      { path: "/api/gantry/calibration/restore-soft-limits", method: "POST", body: undefined },
      {
        path: "/api/gantry/calibration/finalize-origin",
        method: "POST",
        body: {
          home_z: 80,
          block_touch_z: 35,
          block_height: 10,
          factory_z_travel: 90,
          tolerance_mm: 0.2,
        },
      },
      {
        path: "/api/gantry/calibration/recover-limit",
        method: "POST",
        body: { x: 0, y: 0, z: 1, pull_off_mm: 2, feed_rate: 3 },
      },
      { path: "/api/gantry/unlock", method: "POST", body: undefined },
      { path: "/api/gantry/reset-unlock", method: "POST", body: undefined },
      { path: "/api/gantry/feed-hold", method: "POST", body: undefined },
      { path: "/api/gantry/jog-cancel", method: "POST", body: undefined },
      { path: "/api/gantry/grbl-settings", method: "GET", body: undefined },
      { path: "/api/gantry/grbl-settings", method: "POST", body: { setting: "$20", value: "1" } },
    ]);
  });
});

describe("API clients", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws backend status text for failed requests", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad config", { status: 422 })));

    await expect(deckApi.listConfigs()).rejects.toThrow("422: bad config");
  });

  it("maps deck, protocol, settings, and raw YAML endpoints", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
    fetchMock.mockImplementation(async () => jsonResponse());
    vi.stubGlobal("fetch", fetchMock);

    await deckApi.listConfigs();
    await deckApi.get("deck.yaml");
    await deckApi.put("deck.yaml", { labware: {} });
    await deckApi.previewWells({
      type: "well_plate",
      name: "plate",
      model_name: "model",
      rows: 1,
      columns: 1,
      length: 1,
      width: 1,
      height: 1,
      a1: null,
      calibration: { a1: { x: 0, y: 0, z: 0 }, a2: { x: 1, y: 0, z: 0 } },
      x_offset: 1,
      y_offset: 1,
      capacity_ul: 1,
      working_volume_ul: 1,
    });
    await protocolApi.listCommands();
    await protocolApi.listConfigs();
    await protocolApi.get("protocol.yaml");
    await protocolApi.put("protocol.yaml", { protocol: [] });
    await protocolApi.validate({ protocol: [] });
    await protocolApi.validateSetup({
      gantry_file: "gantry.yaml",
      deck_file: "deck.yaml",
      protocol_file: "protocol.yaml",
    });
    await protocolApi.run({
      gantry_file: "gantry.yaml",
      deck_file: "deck.yaml",
      protocol_file: "protocol.yaml",
    });
    await settingsApi.get();
    await settingsApi.update("/tmp/configs");
    await settingsApi.browse();
    await rawApi.get("raw.yaml");
    await rawApi.put("raw.yaml", "serial_port: ''");

    const calls = fetchMock.mock.calls.map(([input, init]) => ({
      path: new URL(String(input), "http://localhost").pathname,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }));

    expect(calls).toEqual([
      { path: "/api/deck/configs", method: "GET", body: undefined },
      { path: "/api/deck/deck.yaml", method: "GET", body: undefined },
      { path: "/api/deck/deck.yaml", method: "PUT", body: { labware: {} } },
      { path: "/api/deck/preview-wells", method: "POST", body: expect.objectContaining({ type: "well_plate" }) },
      { path: "/api/protocol/commands", method: "GET", body: undefined },
      { path: "/api/protocol/configs", method: "GET", body: undefined },
      { path: "/api/protocol/protocol.yaml", method: "GET", body: undefined },
      { path: "/api/protocol/protocol.yaml", method: "PUT", body: { protocol: [] } },
      { path: "/api/protocol/validate", method: "POST", body: { protocol: [] } },
      {
        path: "/api/protocol/validate-setup",
        method: "POST",
        body: { gantry_file: "gantry.yaml", deck_file: "deck.yaml", protocol_file: "protocol.yaml" },
      },
      {
        path: "/api/protocol/run",
        method: "POST",
        body: { gantry_file: "gantry.yaml", deck_file: "deck.yaml", protocol_file: "protocol.yaml" },
      },
      { path: "/api/settings", method: "GET", body: undefined },
      { path: "/api/settings", method: "PUT", body: { config_dir: "/tmp/configs" } },
      { path: "/api/settings/browse", method: "POST", body: undefined },
      { path: "/api/raw/raw.yaml", method: "GET", body: undefined },
      { path: "/api/raw/raw.yaml", method: "PUT", body: { content: "serial_port: ''" } },
    ]);
  });
});
