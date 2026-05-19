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

function gantryConfig(): GantryConfig {
  return {
    serial_port: "/dev/ttyUSB0",
    gantry_type: "cub_xl",
    cnc: {
      homing_strategy: "standard",
      total_z_range: 110,
      y_axis_motion: "head",
      safe_z: 110,
    },
    working_volume: {
      x_min: 0,
      x_max: 400,
      y_min: 0,
      y_max: 300,
      z_min: 0,
      z_max: 110,
    },
    grbl_settings: {},
    instruments: {
      asmi: {
        type: "asmi",
        vendor: "vernier",
        offset_x: 0,
        offset_y: 0,
        depth: 0,
      },
    },
  };
}

function position(status = "Idle"): GantryPosition {
  return {
    x: 0,
    y: 0,
    z: 20,
    work_x: 0,
    work_y: 0,
    work_z: 20,
    status,
    connected: true,
  };
}

describe("CalibrationWizard alarm recovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prompts for unlock and stops calibration jogs when Z jog alarms", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
        "http://localhost",
      );
      if (url.pathname === "/api/gantry/calibration/prepare-origin" && init?.method === "POST") {
        return jsonResponse(position());
      }
      if (url.pathname === "/api/gantry/jog" && init?.method === "POST") {
        return new Response("ALARM:1 hard limit", { status: 409 });
      }
      if (url.pathname === "/api/gantry/unlock" && init?.method === "POST") {
        return jsonResponse(position());
      }
      return jsonResponse(position());
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CalibrationWizard
        open
        onClose={() => undefined}
        gantry={{ filename: "cubos.yaml", config: gantryConfig() }}
        position={position()}
        onSaveCalibrated={async () => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Home gantry" }));
    const zDown = await screen.findByRole("button", { name: "Z-" });

    await user.click(zDown);

    expect(await screen.findByText("GANTRY ALARM")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock alarm" })).toBeInTheDocument();
    expect(zDown).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Unlock alarm" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/gantry/unlock",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByText(/Unlock command sent/)).toBeInTheDocument();
  });
});
