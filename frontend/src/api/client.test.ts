import { afterEach, describe, expect, it, vi } from "vitest";
import { gantryApi } from "./client";

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
});
