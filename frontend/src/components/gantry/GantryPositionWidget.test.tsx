import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import GantryPositionWidget from "./GantryPositionWidget";
import type { GantryPosition, WorkingVolume } from "../../types";

function position(overrides: Partial<GantryPosition> = {}): GantryPosition {
  return {
    x: 0,
    y: 0,
    z: 0,
    work_x: 0,
    work_y: 0,
    work_z: 0,
    status: "Idle",
    connected: true,
    ...overrides,
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
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it("stops held jog requests once the predicted target reaches the working volume edge", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GantryPositionWidget
        position={position({ z: 79.4, work_z: 79.4 })}
        workingVolume={workingVolume}
        gantryFile="cubos.yaml"
        gantry={null}
        onSaveCalibrated={async () => undefined}
      />,
    );

    fireEvent.mouseDown(screen.getByTitle("Z+"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(450);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.mouseUp(screen.getByTitle("Z+"));
  });

  it("still sends a jog when the current work position is not finite", () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GantryPositionWidget
        position={position({ x: Number.NaN, work_x: null })}
        workingVolume={workingVolume}
        gantryFile="cubos.yaml"
        gantry={null}
        onSaveCalibrated={async () => undefined}
      />,
    );

    fireEvent.mouseDown(screen.getByTitle("X+"));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/gantry/jog",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ x: 0.5, y: 0, z: 0 }) }),
    );
  });

  it("shows connection failures and disconnect success through the bottom controls", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
      if (url.pathname === "/api/gantry/connect") {
        return new Response("port unavailable", { status: 500 });
      }
      return new Response(JSON.stringify(position()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <GantryPositionWidget
        position={position({ connected: false })}
        workingVolume={workingVolume}
        gantryFile="cubos.yaml"
        gantry={null}
        onSaveCalibrated={async () => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText(/Connection failed/)).toHaveTextContent("500: port unavailable");

    rerender(
      <GantryPositionWidget
        position={position({ connected: true })}
        workingVolume={workingVolume}
        gantryFile="cubos.yaml"
        gantry={null}
        onSaveCalibrated={async () => undefined}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/gantry/disconnect",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("homes only after confirmation and sends valid manual moves", async () => {
    const user = userEvent.setup();
    const confirmMock = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const alertMock = vi.fn();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(position({ x: 1, y: 2, z: 3 })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("confirm", confirmMock);
    vi.stubGlobal("alert", alertMock);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GantryPositionWidget
        position={position({ x: 10, y: 20, z: 30, work_x: null, work_y: null, work_z: null })}
        workingVolume={workingVolume}
        gantryFile="cubos.yaml"
        gantry={null}
        onSaveCalibrated={async () => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Home" }));
    expect(fetchMock).not.toHaveBeenCalledWith("/api/gantry/home", expect.anything());
    await user.click(screen.getByRole("button", { name: "Home" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/gantry/home", expect.objectContaining({ method: "POST" }));

    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(alertMock).toHaveBeenCalledWith("Enter valid X, Y, and Z coordinates");
    await user.type(screen.getAllByPlaceholderText("0")[0], "-1");
    await user.type(screen.getAllByPlaceholderText("0")[1], "1");
    await user.type(screen.getAllByPlaceholderText("0")[2], "1");
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(alertMock).toHaveBeenCalledWith("Coordinates must be positive (user space)");

    await user.clear(screen.getAllByPlaceholderText("0")[0]);
    await user.type(screen.getAllByPlaceholderText("0")[0], "10");
    await user.clear(screen.getAllByPlaceholderText("0")[1]);
    await user.type(screen.getAllByPlaceholderText("0")[1], "20");
    await user.clear(screen.getAllByPlaceholderText("0")[2]);
    await user.type(screen.getAllByPlaceholderText("0")[2], "30");
    await user.click(screen.getByRole("button", { name: "Go" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/gantry/move-to",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ x: 10, y: 20, z: 30 }),
      }),
    );
  });

  it("handles alarm unlock and advanced GRBL actions", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
      if (url.pathname === "/api/gantry/grbl-settings" && init?.method !== "POST") {
        return new Response(JSON.stringify({ settings: { "$20": "1", "$132": "90" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.pathname === "/api/gantry/grbl-settings" && init?.method === "POST") {
        return new Response(JSON.stringify({ settings: { "$20": "0", "$132": "90" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.pathname === "/api/gantry/feed-hold") {
        return new Response("feed hold failed", { status: 500 });
      }
      return new Response(JSON.stringify(position()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GantryPositionWidget
        position={position({ status: "ALARM:1", calibration_warning: "Soft limits disabled" })}
        workingVolume={workingVolume}
        gantryFile="cubos.yaml"
        gantry={null}
        onSaveCalibrated={async () => undefined}
      />,
    );

    expect(screen.getByText("ALARM")).toBeInTheDocument();
    expect(screen.getByText("CALIBRATION NEEDED")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Unlock ($X)" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/gantry/unlock", expect.objectContaining({ method: "POST" }));

    await user.click(screen.getByRole("button", { name: "Advanced" }));
    await user.click(screen.getByRole("button", { name: "Read GRBL Settings" }));
    expect(await screen.findByText("$132")).toBeInTheDocument();
    expect(screen.getByText("90")).toBeInTheDocument();

    const settingKey = screen.getByPlaceholderText("$20");
    await user.clear(settingKey);
    await user.type(settingKey, "$21");
    const settingValue = screen.getAllByPlaceholderText("0").at(-1)!;
    await user.clear(settingValue);
    await user.type(settingValue, "0");
    await user.click(screen.getByRole("button", { name: "Send Setting" }));
    expect(await screen.findByText("Sent $21=0.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset + Unlock" }));
    expect(await screen.findByText("Reset and unlock sent.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear Alarm" }));
    expect(await screen.findByText("Unlock sent.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel Jog" }));
    expect(await screen.findByText("Jog cancel sent.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Feed Hold" }));
    expect(await screen.findByText("500: feed hold failed")).toBeInTheDocument();
  });

  it("uses keyboard jog shortcuts while ignoring focused inputs", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
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

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/gantry/jog",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ x: 0.5, y: 0, z: 0 }) }),
    );
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(window, { key: "ArrowRight" });

    const stepInput = screen.getAllByDisplayValue("0.5")[0];
    stepInput.focus();
    fireEvent.keyDown(stepInput, { key: "ArrowLeft" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);
  });

  it("handles step warnings, touch jogs, repeated starts, and all keyboard jog axes", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => new Response("jog failed", { status: 500 }));
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

    fireEvent.change(screen.getByLabelText("XY mm"), { target: { value: "0.0005" } });
    fireEvent.change(screen.getByLabelText("Z mm"), { target: { value: "0.0005" } });
    expect(screen.getByText("min 0.001mm")).toBeInTheDocument();

    fireEvent.touchStart(screen.getByTitle("X+"));
    fireEvent.touchEnd(screen.getByTitle("X+"));
    fireEvent.mouseDown(screen.getByTitle("X+"));
    fireEvent.mouseDown(screen.getByTitle("X+"));
    fireEvent.mouseUp(screen.getByTitle("X+"));

    for (const key of ["ArrowLeft", "ArrowUp", "ArrowDown", "x", "Z"]) {
      fireEvent.keyDown(window, { key });
      fireEvent.keyUp(window, { key });
    }

    await waitFor(() => expect(consoleError).toHaveBeenCalledWith("Jog failed:", expect.any(Error)));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/gantry/jog",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ x: 0.001, y: 0, z: 0 }) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/gantry/jog",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ x: -0.001, y: 0, z: 0 }) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/gantry/jog",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ x: 0, y: 0.001, z: 0 }) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/gantry/jog",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ x: 0, y: -0.001, z: 0 }) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/gantry/jog",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ x: 0, y: 0, z: 0.001 }) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/gantry/jog",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ x: 0, y: 0, z: -0.001 }) }),
    );
    consoleError.mockRestore();
  });

  it("reports failed unlock, home, move, and disconnect actions", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const alertMock = vi.fn();
    const confirmMock = vi.fn(() => true);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
      if (url.pathname === "/api/gantry/unlock") {
        return new Response("unlock failed", { status: 500 });
      }
      if (url.pathname === "/api/gantry/home") {
        return new Response("home failed", { status: 500 });
      }
      if (url.pathname === "/api/gantry/move-to") {
        return new Response("move failed", { status: 500 });
      }
      if (url.pathname === "/api/gantry/disconnect") {
        return new Response("disconnect failed", { status: 500 });
      }
      return new Response(JSON.stringify(position()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("alert", alertMock);
    vi.stubGlobal("confirm", confirmMock);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GantryPositionWidget
        position={position({ status: "ALARM:2" })}
        workingVolume={workingVolume}
        gantryFile="cubos.yaml"
        gantry={null}
        onSaveCalibrated={async () => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Unlock ($X)" }));
    await waitFor(() => expect(consoleError).toHaveBeenCalledWith("Unlock failed:", expect.any(Error)));
    await user.click(screen.getByRole("button", { name: "Home" }));
    await waitFor(() => expect(consoleError).toHaveBeenCalledWith("Homing failed:", expect.any(Error)));

    await user.type(screen.getAllByPlaceholderText("0")[0], "10");
    await user.type(screen.getAllByPlaceholderText("0")[1], "20");
    await user.type(screen.getAllByPlaceholderText("0")[2], "30");
    await user.click(screen.getByRole("button", { name: "Go" }));
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith("Move failed: Error: 500: move failed"));

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByText(/Disconnect failed/)).toHaveTextContent("500: disconnect failed");
    consoleError.mockRestore();
  });
});
