import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import GantryPositionWidget from "./GantryPositionWidget";
import type { GantryPosition, WorkingVolume } from "../../types";

function position(): GantryPosition {
  return {
    x: 0,
    y: 0,
    z: 0,
    work_x: 0,
    work_y: 0,
    work_z: 0,
    status: "Idle",
    connected: true,
  };
}

const workingVolume: WorkingVolume = {
  x_min: 0,
  x_max: 300,
  y_min: 0,
  y_max: 200,
  z_min: 0,
  z_max: 80,
};

describe("GantryPositionWidget manual move safety", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the move when workingVolume is absent (backend is the guard)", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ x: 0, y: 0, z: 0, status: "Idle", connected: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GantryPositionWidget
        position={position()}
        workingVolume={null}
        gantryFile="cubos.yaml"
        gantry={null}
        onSaveCalibrated={async () => undefined}
      />,
    );

    await user.type(screen.getByLabelText("X"), "999");
    await user.type(screen.getByLabelText("Y"), "999");
    await user.type(screen.getByLabelText("Z"), "999");
    await user.click(screen.getByRole("button", { name: "Go" }));

    expect(fetchMock).toHaveBeenCalled();
  });

  it("does not send a manual move outside the working volume", async () => {
    const user = userEvent.setup();
    const alertMock = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("alert", alertMock);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GantryPositionWidget
        position={position()}
        workingVolume={workingVolume}
        gantryFile="cubos.yaml"
        gantry={null}
        onSaveCalibrated={async () => undefined}
      />,
    );

    await user.type(screen.getByLabelText("X"), "301");
    await user.type(screen.getByLabelText("Y"), "100");
    await user.type(screen.getByLabelText("Z"), "40");
    await user.click(screen.getByRole("button", { name: "Go" }));

    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining("outside working volume"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
