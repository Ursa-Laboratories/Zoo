import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type {
  BoardConfig,
  BoardResponse,
  DeckConfig,
  DeckResponse,
  GantryConfig,
  GantryResponse,
  ProtocolConfig,
  ProtocolResponse,
} from "./types";

type ApiState = {
  decks: Record<string, DeckResponse>;
  boards: Record<string, BoardResponse>;
  gantries: Record<string, GantryResponse>;
  protocols: Record<string, ProtocolResponse>;
};

function createState(): ApiState {
  return {
    decks: {
      "deck.yaml": {
        filename: "deck.yaml",
        labware: [
          {
            key: "plate_1",
            config: {
              type: "well_plate",
              name: "Deck Plate",
              model_name: "plate-model",
              rows: 8,
              columns: 12,
              length_mm: 127.76,
              width_mm: 85.47,
              height_mm: 14.22,
              a1: null,
              calibration: {
                a1: { x: 10, y: 20, z: 30 },
                a2: { x: 20, y: 20, z: 30 },
              },
              x_offset_mm: 9,
              y_offset_mm: -9,
              capacity_ul: 200,
              working_volume_ul: 150,
            },
            wells: null,
          },
        ],
      },
    },
    boards: {
      "board.yaml": {
        filename: "board.yaml",
        instruments: {
          pipette_1: {
            type: "pipette",
            offset_x: 1,
            offset_y: 2,
            port: "/dev/ttyUSB0",
          },
        },
      },
    },
    gantries: {
      "cubos.yaml": {
        filename: "cubos.yaml",
        config: {
          serial_port: "",
          cnc: { homing_strategy: "xy_hard_limits", y_axis_motion: "head" },
          working_volume: { x_min: 0, x_max: 300, y_min: 0, y_max: 200, z_min: 0, z_max: 80 },
        },
      },
    },
    protocols: {
      "move.yaml": {
        filename: "move.yaml",
        steps: [
          {
            command: "move",
            args: { x: 1, y: 2, z: 3 },
          },
        ],
      },
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function toDeckResponse(filename: string, body: DeckConfig): DeckResponse {
  return {
    filename,
    labware: Object.entries(body.labware).map(([key, config]) => ({
      key,
      config,
      wells: null,
    })),
  };
}

function toBoardResponse(filename: string, body: BoardConfig): BoardResponse {
  return {
    filename,
    instruments: body.instruments,
  };
}

function toGantryResponse(filename: string, body: GantryConfig): GantryResponse {
  return {
    filename,
    config: body,
  };
}

function toProtocolResponse(filename: string, body: ProtocolConfig): ProtocolResponse {
  return {
    filename,
    steps: body.protocol,
  };
}

function installFetchMock(state: ApiState) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
      "http://localhost",
    );
    const path = url.pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;

    if (path === "/api/settings" && method === "GET") {
      return jsonResponse({ cubos_path: "/mock/CubOS" });
    }
    if (path === "/api/deck/configs") {
      return jsonResponse(Object.keys(state.decks));
    }
    if (path === "/api/board/configs") {
      return jsonResponse(Object.keys(state.boards));
    }
    if (path === "/api/gantry/configs") {
      return jsonResponse(Object.keys(state.gantries));
    }
    if (path === "/api/protocol/configs") {
      return jsonResponse(Object.keys(state.protocols));
    }
    if (path === "/api/board/instrument-types") {
      return jsonResponse([{ type: "pipette", is_mock: false }]);
    }
    if (path === "/api/board/instrument-schemas") {
      return jsonResponse({
        pipette: [
          { name: "port", type: "str", required: true, default: "/dev/ttyUSB0", choices: null },
        ],
      });
    }
    if (path === "/api/protocol/commands") {
      return jsonResponse([
        {
          name: "move",
          args: [
            { name: "x", type: "float", required: true, default: 0 },
            { name: "y", type: "float", required: true, default: 0 },
            { name: "z", type: "float", required: true, default: 0 },
          ],
          description: "Move gantry",
        },
      ]);
    }
    if (path === "/api/gantry/position") {
      return jsonResponse({
        x: 0,
        y: 0,
        z: 0,
        work_x: 0,
        work_y: 0,
        work_z: 0,
        status: "Idle",
        connected: false,
      });
    }
    if (path === "/api/deck/preview-wells" && method === "POST") {
      return jsonResponse({});
    }

    const [, api, kind, filename] = path.split("/");
    if (api !== "api" || !filename) {
      return new Response("Not found", { status: 404 });
    }

    if (kind === "deck") {
      if (method === "GET") return jsonResponse(state.decks[filename]);
      if (method === "PUT") {
        state.decks[filename] = toDeckResponse(filename, body as DeckConfig);
        return jsonResponse(state.decks[filename]);
      }
    }
    if (kind === "board") {
      if (method === "GET") return jsonResponse(state.boards[filename]);
      if (method === "PUT") {
        state.boards[filename] = toBoardResponse(filename, body as BoardConfig);
        return jsonResponse(state.boards[filename]);
      }
    }
    if (kind === "gantry") {
      if (method === "GET") return jsonResponse(state.gantries[filename]);
      if (method === "PUT") {
        state.gantries[filename] = toGantryResponse(filename, body as GantryConfig);
        return jsonResponse(state.gantries[filename]);
      }
    }
    if (kind === "protocol") {
      if (method === "GET") return jsonResponse(state.protocols[filename]);
      if (method === "PUT") {
        state.protocols[filename] = toProtocolResponse(filename, body as ProtocolConfig);
        return jsonResponse({ status: "ok", filename });
      }
    }

    return new Response("Not found", { status: 404 });
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderApp() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });

  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

async function importConfig(user: ReturnType<typeof userEvent.setup>, label: string, filename: string) {
  await user.click(screen.getByRole("button", { name: label }));
  await user.selectOptions(screen.getByRole("combobox", { name: label }), filename);
}

async function waitForSettingsLoad() {
  await screen.findByDisplayValue("/mock/CubOS");
}

async function loadRequiredProtocolDependencies(user: ReturnType<typeof userEvent.setup>) {
  await importConfig(user, "Import gantry config", "cubos.yaml");
  await user.click(screen.getByRole("button", { name: "Deck" }));
  await importConfig(user, "Import deck config", "deck.yaml");
  await user.click(screen.getByRole("button", { name: "Board" }));
  await importConfig(user, "Import board config", "board.yaml");
}

describe("Zoo editor interactions", () => {
  beforeEach(() => {
    installFetchMock(createState());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads and saves a gantry config across tab switches", async () => {
    const user = userEvent.setup();
    renderApp();
    await waitForSettingsLoad();

    await importConfig(user, "Import gantry config", "cubos.yaml");
    const serialPort = await screen.findByLabelText("Serial port");
    expect(serialPort).toHaveValue("");

    await user.type(serialPort, "/dev/ttyUSB9");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Deck" }));
    await user.click(screen.getByRole("button", { name: "Gantry" }));

    await waitFor(() => expect(screen.getByLabelText("Serial port")).toHaveValue("/dev/ttyUSB9"));
  });

  it("loads and saves a deck config across tab switches", async () => {
    const user = userEvent.setup();
    renderApp();
    await waitForSettingsLoad();

    await user.click(screen.getByRole("button", { name: "Deck" }));
    await importConfig(user, "Import deck config", "deck.yaml");
    const nameField = await screen.findByDisplayValue("Deck Plate");
    expect(nameField).toHaveValue("Deck Plate");

    await user.clear(nameField);
    await user.type(nameField, "Renamed Plate");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Gantry" }));
    await user.click(screen.getByRole("button", { name: "Deck" }));

    await waitFor(() => expect(screen.getByDisplayValue("Renamed Plate")).toBeInTheDocument());
  });

  it("loads and saves a board config across tab switches", async () => {
    const user = userEvent.setup();
    renderApp();
    await waitForSettingsLoad();

    await user.click(screen.getByRole("button", { name: "Board" }));
    await importConfig(user, "Import board config", "board.yaml");
    const portField = await screen.findByLabelText("Port *");
    expect(portField).toHaveValue("/dev/ttyUSB0");

    await user.clear(portField);
    await user.type(portField, "/dev/ttyUSB4");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Gantry" }));
    await user.click(screen.getByRole("button", { name: "Board" }));

    await waitFor(() => expect(screen.getByLabelText("Port *")).toHaveValue("/dev/ttyUSB4"));
  });

  it("loads and saves a protocol config across tab switches", async () => {
    const user = userEvent.setup();
    renderApp();
    await waitForSettingsLoad();
    await loadRequiredProtocolDependencies(user);

    await user.click(screen.getByRole("button", { name: "Protocol" }));
    await importConfig(user, "Import protocol config", "move.yaml");
    const xField = await screen.findByDisplayValue("1");
    expect(xField).toHaveValue("1");

    await user.clear(xField);
    await user.type(xField, "42");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Gantry" }));
    await user.click(screen.getByRole("button", { name: "Protocol" }));

    await waitFor(() => expect(screen.getByDisplayValue("42")).toBeInTheDocument());
  });
});
