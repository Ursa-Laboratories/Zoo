import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { protocolApi } from "../api/client";
import type { ProtocolConfig } from "../types";

type SaveProtocolArgs = {
  filename: string;
  body: ProtocolConfig;
};

export function useProtocolCommands() {
  return useQuery({
    queryKey: ["protocol", "commands"],
    queryFn: protocolApi.listCommands,
    staleTime: Infinity,
  });
}

export function useProtocolConfigs() {
  return useQuery({
    queryKey: ["protocol", "configs"],
    queryFn: protocolApi.listConfigs,
  });
}

export function useProtocol(filename: string | null) {
  return useQuery({
    queryKey: ["protocol", filename],
    queryFn: () => protocolApi.get(filename!),
    enabled: !!filename,
  });
}

export function useSaveProtocol() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ filename, body }: SaveProtocolArgs) => protocolApi.put(filename, body),
    onSuccess: (_data, { filename }) => {
      qc.invalidateQueries({ queryKey: ["protocol", filename] });
      qc.invalidateQueries({ queryKey: ["protocol", "configs"] });
    },
  });
}

export function useValidateProtocol() {
  return useMutation({
    mutationFn: (body: ProtocolConfig) => protocolApi.validate(body),
  });
}
