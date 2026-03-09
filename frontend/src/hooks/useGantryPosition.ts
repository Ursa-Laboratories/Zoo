import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gantryApi } from "../api/client";
import type { GantryConfig } from "../types";

export function useGantryPosition(enabled = true) {
  return useQuery({
    queryKey: ["gantry", "position"],
    queryFn: gantryApi.getPosition,
    refetchInterval: enabled ? 200 : false,
    enabled,
  });
}

export function useGantryConfigs() {
  return useQuery({ queryKey: ["gantry", "configs"], queryFn: gantryApi.listConfigs });
}

export function useGantry(filename: string | null) {
  return useQuery({
    queryKey: ["gantry", filename],
    queryFn: () => gantryApi.get(filename!),
    enabled: !!filename,
  });
}

export function useSaveGantry(filename: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GantryConfig) => gantryApi.put(filename, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gantry", filename] });
    },
  });
}
