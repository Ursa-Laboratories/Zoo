import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function csvResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/csv" },
  });
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

function installFetchMock() {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
      "http://localhost",
    );
    const path = url.pathname;

    if (path === "/api/settings") {
      return jsonResponse({ config_dir: "/mock/Zoo/configs" });
    }
    if (path === "/api/deck/configs" || path === "/api/gantry/configs" || path === "/api/protocol/configs") {
      return jsonResponse([]);
    }
    if (path === "/api/gantry/instrument-types") {
      return jsonResponse([]);
    }
    if (path === "/api/gantry/instrument-schemas") {
      return jsonResponse({});
    }
    if (path === "/api/protocol/commands") {
      return jsonResponse([]);
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
    if (path === "/api/data/experiments") {
      return jsonResponse([
        {
          experiment_id: 7,
          campaign_id: 1,
          campaign_description: "ASMI sample campaign",
          labware_name: "asmi_96_well_deck_origin",
          well_id: "E5",
          created_at: "2025-10-30 12:21:07",
          latest_measurement_at: "2025-10-30 12:21:07",
          asmi_measurement_count: 1,
        },
      ]);
    }
    if (path === "/api/data/experiments/7/asmi.csv") {
      return csvResponse(
        [
          "Test_Time,2025-10-30 12:21:07",
          "Well,E5",
          "Timestamp(s),Z_Position(mm),Raw_Force(N),Corrected_Force(N),Direction",
          "1761841220.199,-74.010,0.463,0.004,down",
        ].join("\n"),
      );
    }

    return new Response("Not found", { status: 404 });
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Results view", () => {
  beforeEach(() => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:zoo-asmi-csv"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows experiment output and exports ASMI CSV", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetchMock();

    renderApp();

    await screen.findByDisplayValue("/mock/Zoo/configs");
    await user.click(screen.getByRole("button", { name: "Results" }));

    expect(await screen.findByText("Experiment #7")).toBeInTheDocument();
    expect(screen.getByText("2025-10-30 12:21:07")).toBeInTheDocument();
    expect(screen.getByText("E5")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/data/experiments/7/asmi.csv"));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:zoo-asmi-csv");
  });
});
