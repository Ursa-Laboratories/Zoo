import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePipetteModels } from "../../src/hooks/useGantryPosition";
import { useSaveProtocol, useValidateProtocol, useValidateProtocolSetup } from "../../src/hooks/useProtocol";
import type { ProtocolConfig, ProtocolSetupValidationRequest } from "../../src/types";

const apiMocks = vi.hoisted(() => ({
  gantryApi: {
    listPipetteModels: vi.fn(),
  },
  protocolApi: {
    put: vi.fn(),
    validate: vi.fn(),
    validateSetup: vi.fn(),
  },
}));

vi.mock("../../src/api/client", () => ({
  gantryApi: apiMocks.gantryApi,
  protocolApi: apiMocks.protocolApi,
}));

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("frontend data hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads pipette model metadata", async () => {
    apiMocks.gantryApi.listPipetteModels.mockResolvedValue([
      { name: "p300_single", family: "p300", channels: 1, min_volume: 30, max_volume: 300 },
    ]);
    const client = createClient();

    const { result } = renderHook(() => usePipetteModels(), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiMocks.gantryApi.listPipetteModels).toHaveBeenCalledOnce();
    expect(result.current.data).toEqual([
      { name: "p300_single", family: "p300", channels: 1, min_volume: 30, max_volume: 300 },
    ]);
  });

  it("invalidates protocol cache entries after saving", async () => {
    apiMocks.protocolApi.put.mockResolvedValue({ status: "ok", filename: "protocol.yaml" });
    const client = createClient();
    const invalidateQueries = vi.spyOn(client, "invalidateQueries");
    const body: ProtocolConfig = { protocol: [{ command: "wait", args: { seconds: 1 } }] };
    const { result } = renderHook(() => useSaveProtocol(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync({ filename: "protocol.yaml", body });
    });

    expect(apiMocks.protocolApi.put).toHaveBeenCalledWith("protocol.yaml", body);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["protocol", "protocol.yaml"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["protocol", "configs"] });
  });

  it("validates the selected protocol setup files", async () => {
    apiMocks.protocolApi.validateSetup.mockResolvedValue({
      valid: true,
      errors: [],
      output: "RESULT: PASS",
    });
    const client = createClient();
    const body: ProtocolSetupValidationRequest = {
      gantry_file: "gantry.yaml",
      deck_file: "deck.yaml",
      protocol_file: "protocol.yaml",
    };
    const { result } = renderHook(() => useValidateProtocolSetup(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync(body);
    });

    expect(apiMocks.protocolApi.validateSetup).toHaveBeenCalledWith(body);
  });

  it("validates an unsaved protocol body", async () => {
    apiMocks.protocolApi.validate.mockResolvedValue({
      valid: false,
      errors: ["Step 0: missing position"],
      output: "RESULT: FAIL",
    });
    const client = createClient();
    const body: ProtocolConfig = {
      positions: { park: [1, 2, 3] },
      protocol: [{ command: "move", args: { position: "missing" } }],
    };
    const { result } = renderHook(() => useValidateProtocol(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync(body);
    });

    expect(apiMocks.protocolApi.validate).toHaveBeenCalledWith(body);
  });
});
