import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GantryPositionWidget from "./GantryPositionWidget";

describe("GantryPositionWidget X jog controls", () => {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the corrected X jog deltas for the X buttons", () => {
    render(
      <GantryPositionWidget
        configSelected
        workingVolume={null}
        position={{
          connected: true,
          status: "Idle",
          x: 0,
          y: 0,
          z: 0,
          work_x: 0,
          work_y: 0,
          work_z: 0,
        }}
      />,
    );

    fireEvent.mouseDown(screen.getByTitle("X+"));
    fireEvent.mouseUp(screen.getByTitle("X+"));
    fireEvent.mouseDown(screen.getByTitle("X-"));
    fireEvent.mouseUp(screen.getByTitle("X-"));

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/gantry/jog",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ x: -0.5, y: 0, z: 0 }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/gantry/jog",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ x: 0.5, y: 0, z: 0 }),
      }),
    );
  });

  it("maps keyboard left and right arrows to the corrected X jog deltas", () => {
    render(
      <GantryPositionWidget
        configSelected
        workingVolume={null}
        position={{
          connected: true,
          status: "Idle",
          x: 0,
          y: 0,
          z: 0,
          work_x: 0,
          work_y: 0,
          work_z: 0,
        }}
      />,
    );

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyUp(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyUp(window, { key: "ArrowLeft" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/gantry/jog",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ x: -0.5, y: 0, z: 0 }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/gantry/jog",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ x: 0.5, y: 0, z: 0 }),
      }),
    );
  });
});
