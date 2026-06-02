import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalibrationWizard from "./CalibrationWizard";
import type { GantryConfig, GantryPosition } from "../../types";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function multiGantryConfig(): GantryConfig {
  return {
    serial_port: "/dev/ttyUSB0",
    gantry_type: "cub_xl",
    cnc: {
      homing_strategy: "standard",
      factory_z_travel_mm: 110,
      calibration_block_height_mm: 35,
      y_axis_motion: "head",
      safe_z: 90,
    },
    working_volume: {
      x_min: 0,
      x_max: 300,
      y_min: 0,
      y_max: 200,
      z_min: 0,
      z_max: 90,
    },
    grbl_settings: {
      homing_pull_off: 10,
    },
    instruments: {
      reference: {
        type: "asmi",
        vendor: "vernier",
        offset_x: 0,
        offset_y: 0,
        depth: 0,
      },
      probe: {
        type: "asmi",
        vendor: "vernier",
        offset_x: 0,
        offset_y: 0,
        depth: 0,
      },
    },
  };
}

function position(overrides: Partial<GantryPosition> = {}): GantryPosition {
  return {
    x: 0,
    y: 0,
    z: 90,
    work_x: 0,
    work_y: 0,
    work_z: 90,
    status: "Idle",
    connected: true,
    ...overrides,
  };
}

function renderWizard({
  config = multiGantryConfig(),
  pos = position(),
  onClose = vi.fn(),
  onSaveCalibrated = vi.fn(async () => undefined),
}: {
  config?: GantryConfig;
  pos?: GantryPosition;
  onClose?: () => void;
  onSaveCalibrated?: (filename: string, config: GantryConfig) => Promise<void>;
} = {}) {
  render(
    <CalibrationWizard
      open
      onClose={onClose}
      gantry={{ filename: "multi.yaml", config }}
      position={pos}
      onSaveCalibrated={onSaveCalibrated}
    />,
  );
  return { onClose, onSaveCalibrated };
}

describe("CalibrationWizard multi-instrument calibration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("homes, records instruments, programs soft limits, and saves calibrated offsets", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSaveCalibrated = vi.fn(async (filename: string, config: GantryConfig) => {
      void filename;
      void config;
    });
    const getPositionResults = [
      position({ work_x: 100, work_y: 100, work_z: 40 }),
      position({ work_x: 98.5, work_y: 101.25, work_z: 39 }),
    ];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
        "http://localhost",
      );
      if (url.pathname === "/api/gantry/calibration/prepare-origin" && init?.method === "POST") {
        return jsonResponse(position({ work_x: 0, work_y: 0, work_z: 90 }));
      }
      if (url.pathname === "/api/gantry/work-coordinates" && init?.method === "POST") {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        return jsonResponse(position({
          work_x: Number(body.x ?? 100),
          work_y: Number(body.y ?? 100),
          work_z: Number(body.z ?? 35),
        }));
      }
      if (url.pathname === "/api/gantry/calibration/home-and-center" && init?.method === "POST") {
        return jsonResponse({
          xy_bounds: { x: 300, y: 200, z: 90 },
          position: { x: 150, y: 100, z: 90 },
        });
      }
      if (url.pathname === "/api/gantry/position") {
        return jsonResponse(getPositionResults.shift() ?? position({ work_x: 98.5, work_y: 101.25, work_z: 39 }));
      }
      if (url.pathname === "/api/gantry/jog-blocking" && init?.method === "POST") {
        return jsonResponse(position({ work_z: 55 }));
      }
      if (url.pathname === "/api/gantry/home" && init?.method === "POST") {
        return jsonResponse(position({ work_x: 300, work_y: 200, work_z: 91 }));
      }
      if (url.pathname === "/api/gantry/soft-limits" && init?.method === "POST") {
        return jsonResponse({ status: "ok" });
      }
      return jsonResponse(position());
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWizard({ onClose, onSaveCalibrated });

    expect(screen.getByText(/multi-instrument board/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Home gantry" }));
    await user.click(await screen.findByRole("button", { name: "Set XY origin and continue" }));
    expect(await screen.findByText(/XY origin set/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Set Z reference with reference and retract" }));
    expect(await screen.findByText(/Recorded reference and retracted Z/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Record probe and retract" }));
    expect(await screen.findByText(/Recorded probe and retracted Z/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSaveCalibrated).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/gantry/soft-limits",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          max_travel_x: 310,
          max_travel_y: 210,
          max_travel_z: 101,
          status_report: 0,
          homing_pull_off: 10,
        }),
      }),
    );
    const [filename, savedConfig] = onSaveCalibrated.mock.calls[0];
    expect(filename).toBe("multi.yaml");
    expect(savedConfig.working_volume).toEqual({
      x_min: 0,
      x_max: 300,
      y_min: 0,
      y_max: 200,
      z_min: 0,
      z_max: 91,
    });
    expect(savedConfig.grbl_settings).toMatchObject({
      homing_pull_off: 10,
      max_travel_x: 310,
      max_travel_y: 210,
      max_travel_z: 101,
      soft_limits: true,
      status_report: 0,
    });
    expect(savedConfig.instruments.probe).toMatchObject({
      offset_x: 1.5,
      offset_y: -1.25,
      depth: 4,
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("requires homing pull-off before entering multi-instrument calibration", async () => {
    const user = userEvent.setup();
    const config = multiGantryConfig();
    config.grbl_settings = {};
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(position())));

    renderWizard({ config });
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/Multi-instrument calibration requires grbl_settings.homing_pull_off/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Home gantry" })).not.toBeInTheDocument();
  });

  it("updates multi-instrument output and instrument choices and resets them", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(position())));

    renderWizard();

    const output = screen.getByLabelText("Output YAML");
    await user.clear(output);
    await user.type(output, "calibrated_multi.yaml");
    await user.selectOptions(screen.getByLabelText("Reference instrument"), "probe");
    await user.selectOptions(screen.getByLabelText("Lowest instrument"), "probe");

    expect(output).toHaveValue("multi.yamlcalibrated_multi.yaml");
    expect(screen.getByLabelText("Reference instrument")).toHaveValue("probe");
    expect(screen.getByLabelText("Lowest instrument")).toHaveValue("probe");

    await user.click(screen.getByRole("button", { name: "Reset wizard" }));

    expect(screen.getByLabelText("Output YAML")).toHaveValue("multi.yaml");
    expect(screen.getByLabelText("Reference instrument")).toHaveValue("reference");
    expect(screen.getByLabelText("Lowest instrument")).toHaveValue("reference");
  });

  it("recovers when a blocking Z retract hits a limit after setting the reference", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
        "http://localhost",
      );
      if (url.pathname === "/api/gantry/calibration/prepare-origin" && init?.method === "POST") {
        return jsonResponse(position({ work_x: 0, work_y: 0, work_z: 90 }));
      }
      if (url.pathname === "/api/gantry/work-coordinates" && init?.method === "POST") {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        return jsonResponse(position({
          work_x: Number(body.x ?? 100),
          work_y: Number(body.y ?? 100),
          work_z: Number(body.z ?? 35),
        }));
      }
      if (url.pathname === "/api/gantry/calibration/home-and-center" && init?.method === "POST") {
        return jsonResponse({
          xy_bounds: { x: 300, y: 200, z: 90 },
          position: { x: 150, y: 100, z: 90 },
        });
      }
      if (url.pathname === "/api/gantry/position") {
        return jsonResponse(position({ work_x: 100, work_y: 100, work_z: 40 }));
      }
      if (url.pathname === "/api/gantry/jog-blocking" && init?.method === "POST") {
        return new Response("ALARM:1 hard limit", { status: 409 });
      }
      if (url.pathname === "/api/gantry/calibration/recover-limit" && init?.method === "POST") {
        return jsonResponse({
          status: "recovered",
          attempts: 1,
          pull_off: { x: 0, y: 0, z: 5 },
          messages: ["recovered"],
        });
      }
      return jsonResponse(position());
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWizard();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Home gantry" }));
    await user.click(await screen.findByRole("button", { name: "Set XY origin and continue" }));
    await user.click(await screen.findByRole("button", { name: "Set Z reference with reference and retract" }));

    expect(await screen.findByText(/recovered from a limit during Z retract/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/gantry/calibration/recover-limit",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ x: 0, y: 0, z: 15 }),
      }),
    );
  });

  it("reports missing work coordinates from a home response", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
        "http://localhost",
      );
      if (url.pathname === "/api/gantry/calibration/prepare-origin" && init?.method === "POST") {
        return jsonResponse({
          x: 0,
          y: 0,
          z: 90,
          status: "Idle",
          connected: true,
        });
      }
      return jsonResponse(position());
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWizard();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Home gantry" }));

    expect(await screen.findByText(/Work coordinate position is not available/)).toBeInTheDocument();
  });

  it("reports a disconnected home response", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
        "http://localhost",
      );
      if (url.pathname === "/api/gantry/calibration/prepare-origin" && init?.method === "POST") {
        return jsonResponse(position({ connected: false }));
      }
      return jsonResponse(position());
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWizard();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Home gantry" }));

    expect(await screen.findByText("Gantry is not connected.")).toBeInTheDocument();
  });

  it("requires finite homed Z bounds before setting the Z reference", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
        "http://localhost",
      );
      if (url.pathname === "/api/gantry/calibration/prepare-origin" && init?.method === "POST") {
        return jsonResponse(position({ work_x: 0, work_y: 0, work_z: 90 }));
      }
      if (url.pathname === "/api/gantry/work-coordinates" && init?.method === "POST") {
        return jsonResponse(position({ work_x: 0, work_y: 0, work_z: 35 }));
      }
      if (url.pathname === "/api/gantry/calibration/home-and-center" && init?.method === "POST") {
        return jsonResponse({
          xy_bounds: { x: 300, y: 200 },
          position: { x: 150, y: 100, z: 90 },
        });
      }
      if (url.pathname === "/api/gantry/position") {
        return jsonResponse(position({ work_x: 100, work_y: 100, work_z: 40 }));
      }
      return jsonResponse(position());
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWizard();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Home gantry" }));
    await user.click(await screen.findByRole("button", { name: "Set XY origin and continue" }));
    await user.click(await screen.findByRole("button", { name: "Set Z reference with reference and retract" }));

    expect(await screen.findByText(/Homed XY bounds is not available/)).toBeInTheDocument();
  });

  it("reports non-alarm blocking retract failures without starting recovery", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
        "http://localhost",
      );
      if (url.pathname === "/api/gantry/calibration/prepare-origin" && init?.method === "POST") {
        return jsonResponse(position({ work_x: 0, work_y: 0, work_z: 90 }));
      }
      if (url.pathname === "/api/gantry/work-coordinates" && init?.method === "POST") {
        return jsonResponse(position({ work_x: 0, work_y: 0, work_z: 35 }));
      }
      if (url.pathname === "/api/gantry/calibration/home-and-center" && init?.method === "POST") {
        return jsonResponse({
          xy_bounds: { x: 300, y: 200, z: 90 },
          position: { x: 150, y: 100, z: 90 },
        });
      }
      if (url.pathname === "/api/gantry/position") {
        return jsonResponse(position({ work_x: 100, work_y: 100, work_z: 40 }));
      }
      if (url.pathname === "/api/gantry/jog-blocking" && init?.method === "POST") {
        return new Response("motor stalled", { status: 500 });
      }
      return jsonResponse(position());
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWizard();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Home gantry" }));
    await user.click(await screen.findByRole("button", { name: "Set XY origin and continue" }));
    await user.click(await screen.findByRole("button", { name: "Set Z reference with reference and retract" }));

    expect(await screen.findByText("500: motor stalled")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/gantry/calibration/recover-limit",
      expect.anything(),
    );
  });

  it("reports non-positive measured travel before saving multi-instrument calibration", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSaveCalibrated = vi.fn(async () => undefined);
    const getPositionResults = [
      position({ work_x: 100, work_y: 100, work_z: 40 }),
      position({ work_x: 99, work_y: 100, work_z: 39 }),
    ];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
        "http://localhost",
      );
      if (url.pathname === "/api/gantry/calibration/prepare-origin" && init?.method === "POST") {
        return jsonResponse(position({ work_x: 0, work_y: 0, work_z: 90 }));
      }
      if (url.pathname === "/api/gantry/work-coordinates" && init?.method === "POST") {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        return jsonResponse(position({
          work_x: Number(body.x ?? 100),
          work_y: Number(body.y ?? 100),
          work_z: Number(body.z ?? 35),
        }));
      }
      if (url.pathname === "/api/gantry/calibration/home-and-center" && init?.method === "POST") {
        return jsonResponse({
          xy_bounds: { x: 300, y: 200, z: 90 },
          position: { x: 150, y: 100, z: 90 },
        });
      }
      if (url.pathname === "/api/gantry/position") {
        return jsonResponse(getPositionResults.shift() ?? position({ work_x: 99, work_y: 100, work_z: 39 }));
      }
      if (url.pathname === "/api/gantry/jog-blocking" && init?.method === "POST") {
        return jsonResponse(position({ work_z: 55 }));
      }
      if (url.pathname === "/api/gantry/home" && init?.method === "POST") {
        return jsonResponse(position({ work_x: -10, work_y: 200, work_z: 91 }));
      }
      return jsonResponse(position());
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWizard({ onClose, onSaveCalibrated });

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Home gantry" }));
    await user.click(await screen.findByRole("button", { name: "Set XY origin and continue" }));
    await user.click(await screen.findByRole("button", { name: "Set Z reference with reference and retract" }));
    await user.click(await screen.findByRole("button", { name: "Record probe and retract" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Measured travel spans must be positive.")).toBeInTheDocument();
    expect(onSaveCalibrated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("restores soft limits before closing and reports restore failures", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url, "http://localhost");
      if (url.pathname === "/api/gantry/calibration/restore-soft-limits") {
        return new Response("controller busy", { status: 500 });
      }
      return jsonResponse(position());
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWizard({ onClose });
    await user.click(screen.getByRole("button", { name: "Close calibration" }));

    expect(await screen.findByText(/Failed to restore soft limits: 500: controller busy/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("restores soft limits before closing a connected wizard", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const fetchMock = vi.fn(async () => jsonResponse(position()));
    vi.stubGlobal("fetch", fetchMock);

    renderWizard({ onClose });
    await user.click(screen.getByRole("button", { name: "Close calibration" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/gantry/calibration/restore-soft-limits",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("closes immediately when the gantry is not connected", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const fetchMock = vi.fn(async () => jsonResponse(position()));
    vi.stubGlobal("fetch", fetchMock);

    renderWizard({ onClose, pos: position({ connected: false }) });
    await user.click(screen.getByRole("button", { name: "Close calibration" }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
