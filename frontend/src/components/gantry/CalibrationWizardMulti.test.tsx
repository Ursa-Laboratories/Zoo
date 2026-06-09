import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalibrationWizard from "./CalibrationWizard";
import type { GantryConfig, GantryPosition } from "../../types";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function multiConfig(): GantryConfig {
  return {
    serial_port: "/dev/ttyUSB0",
    gantry_type: "cub_xl",
    cnc: {
      homing_strategy: "standard",
      factory_z_travel_mm: 110,
      calibration_block_height_mm: 35,
      y_axis_motion: "head",
      safe_z: 110,
    },
    working_volume: { x_min: 0, x_max: 400, y_min: 0, y_max: 300, z_min: 0, z_max: 110 },
    // No homing_pull_off seeded — calibration should still proceed (defaulted).
    grbl_settings: {},
    instruments: {
      asmi: { type: "asmi", vendor: "vernier", offset_x: 0, offset_y: 0, depth: 0 },
      pipette: { type: "pipette", vendor: "opentrons", offset_x: 0, offset_y: 0, depth: 0 },
    },
  };
}

function position(): GantryPosition {
  return { x: 0, y: 0, z: 20, work_x: 0, work_y: 0, work_z: 20, status: "Idle", connected: true };
}

function installFetch() {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
      "http://localhost",
    );
    if (url.pathname === "/api/gantry/calibration/home-and-center" && init?.method === "POST") {
      return jsonResponse({ xy_bounds: { x: 400, y: 300, z: 110 }, position: { x: 200, y: 150, z: 110 } });
    }
    return jsonResponse(position());
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function advanceToBlockHeightStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Continue" })); // Prepare -> Home
  await user.click(await screen.findByRole("button", { name: "Home gantry" })); // -> XY origin
  await user.click(await screen.findByRole("button", { name: "Set XY origin and continue" })); // -> Block height
}

describe("CalibrationWizard multi-instrument block height step", () => {
  afterEach(() => vi.unstubAllGlobals());

  function renderWizard() {
    render(
      <CalibrationWizard
        open
        onClose={() => undefined}
        gantry={{ filename: "multi.yaml", config: multiConfig() }}
        position={position()}
        onSaveCalibrated={async () => undefined}
      />,
    );
  }

  it("starts calibration even when the YAML omits homing_pull_off", async () => {
    const user = userEvent.setup();
    installFetch();
    renderWizard();

    await user.click(screen.getByRole("button", { name: "Continue" })); // Prepare -> Home
    // No "requires grbl_settings.homing_pull_off" block — we reach the Home step.
    expect(await screen.findByRole("button", { name: "Home gantry" })).toBeInTheDocument();
    expect(screen.queryByText(/homing_pull_off/i)).not.toBeInTheDocument();
  });

  it("lists Block height as its own step between XY origin and Z reference", () => {
    installFetch();
    renderWizard();
    const steps = screen.getByLabelText("Gantry calibration").querySelectorAll("aside > div");
    expect(Array.from(steps).map((s) => s.textContent)).toEqual([
      "1Prepare",
      "2Home",
      "3XY origin",
      "4Block height",
      "5Z reference",
      "6Instruments",
      "7Save",
    ]);
  });

  it("lets the operator edit the block height and carries it into Z reference", async () => {
    const user = userEvent.setup();
    installFetch();
    renderWizard();

    await advanceToBlockHeightStep(user);

    // The block height field is editable (not locked at the config's 35).
    const blockHeight = await screen.findByLabelText("Block height (mm)");
    expect(blockHeight).toBeEnabled();
    expect(blockHeight).toHaveValue("35");
    await user.clear(blockHeight);
    await user.type(blockHeight, "42");

    await user.click(screen.getByRole("button", { name: "Continue" })); // -> Z reference

    expect(await screen.findByText("Set Z Reference")).toBeInTheDocument();
    expect(screen.getByText("42 mm")).toBeInTheDocument();
  });

  it("blocks advancing from the block height step when the value is invalid", async () => {
    const user = userEvent.setup();
    installFetch();
    renderWizard();

    await advanceToBlockHeightStep(user);
    const blockHeight = await screen.findByLabelText("Block height (mm)");
    await user.clear(blockHeight);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/Enter a calibration block height/i)).toBeInTheDocument();
    expect(screen.queryByText("Set Z Reference")).not.toBeInTheDocument();
  });
});
